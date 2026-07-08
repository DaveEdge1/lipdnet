import JSZip from 'jszip'
import SparkMD5 from 'spark-md5'
import type { LipdFile, LipdMetadata, LipdColumn, LipdTable } from '../types/lipd'
import { makeTSid } from './newDataset'
import type { ParsedTabular } from './tabular'

// ---- Parse ----------------------------------------------------------------

export async function parseLipd(file: File): Promise<LipdFile> {
  const zip = await JSZip.loadAsync(file)

  // Find metadata.jsonld (may be at different depths)
  const jsonldEntry = Object.values(zip.files).find(
    f => !f.dir && f.name.endsWith('.jsonld')
  )
  if (!jsonldEntry) throw new Error('No .jsonld file found in archive')

  const metadataText = await jsonldEntry.async('text')
  const metadata: LipdMetadata = JSON.parse(metadataText)

  // Collect all CSV files
  const csvData: Record<string, string> = {}
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir && name.endsWith('.csv')) {
      const basename = name.split('/').pop()!
      csvData[basename] = await entry.async('text')
    }
  }

  // Inject values into column objects
  loadCsvValues(metadata, csvData)

  return { metadata, filename: file.name, csvData }
}

function loadCsvValues(metadata: LipdMetadata, csvData: Record<string, string>) {
  const sections = [
    ...(metadata.paleoData ?? []),
    ...(metadata.chronData ?? []),
  ]
  for (const section of sections) {
    for (const table of section.measurementTable ?? []) {
      injectValues(table, csvData)
    }
    for (const model of section.model ?? []) {
      for (const t of [
        ...(model.summaryTable ?? []),
        ...(model.ensembleTable ?? []),
        ...(model.distributionTable ?? []),
      ]) {
        injectValues(t, csvData)
      }
    }
  }
}

function injectValues(table: LipdTable, csvData: Record<string, string>) {
  const filename = table.filename ? table.filename.split('/').pop()! : undefined
  if (!filename || !csvData[filename]) return

  const cols = table.columns ?? []
  if (!cols.length) return

  // Expand array-numbered columns (e.g. ensemble tables store all member indices
  // as a single column object with number=[2,3,...,N]).
  // Iterate backwards so splicing doesn't shift indices.
  for (let i = cols.length - 1; i >= 0; i--) {
    const col = cols[i]
    if (Array.isArray(col.number)) {
      const nums = col.number as number[]
      col._origNumber = nums          // preserve for round-trip
      col.number = nums[0]            // scalar for the original slot
      for (let j = 1; j < nums.length; j++) {
        table.columns.splice(i + j, 0, {
          number: nums[j],
          variableName: col.variableName,
          TSid: `_auto_${filename}_${nums[j]}`,
          units: col.units,
          _synthetic: true,
        } as LipdColumn)
      }
    }
  }

  const rows = csvData[filename]
    .trim()
    .split('\n')
    .map(line => line.split(',').map(v => v.trim()))

  // Synthesize column objects for any extra CSV columns beyond defined columns
  const csvColCount = rows.length ? Math.max(...rows.map(r => r.length)) : 0
  const maxDefinedNum = Math.max(0, ...table.columns.map(c => (typeof c.number === 'number' ? c.number : 0)))
  if (csvColCount > maxDefinedNum) {
    const lastCol = table.columns[table.columns.length - 1]
    for (let n = maxDefinedNum + 1; n <= csvColCount; n++) {
      table.columns.push({
        number: n,
        variableName: lastCol?.variableName ?? 'value',
        TSid: `_auto_${filename}_${n}`,
        units: lastCol?.units,
        _synthetic: true,
      } as LipdColumn)
    }
  }

  table.columns.forEach((col, fallbackIdx) => {
    // Use col.number (1-based) when present and in range; fall back to array index
    const idx = (typeof col.number === 'number' && col.number >= 1)
      ? col.number - 1
      : fallbackIdx
    col.values = rows.map(row => {
      const v = row[idx]
      if (v === undefined || v === '' || v?.toLowerCase() === 'nan') return null
      const n = Number(v)
      return isNaN(n) ? v : n
    })
  })
}

// ---- Serialize ------------------------------------------------------------

export async function serializeLipd(lipd: LipdFile): Promise<Blob> {
  const zip = new JSZip()
  const bag = zip.folder('bag')!
  const data = bag.folder('data')!

  // Strip values from columns before serializing metadata
  const metaClean = stripValues(lipd.metadata)
  const metaText = JSON.stringify(metaClean, null, 2)
  data.file('metadata.jsonld', metaText)

  // Rebuild CSVs from column values
  const regeneratedCsvs = buildCsvFiles(lipd.metadata)
  for (const [fname, content] of Object.entries(regeneratedCsvs)) {
    data.file(fname, content)
  }
  // Also include any CSVs not regenerated (e.g. ensemble tables)
  for (const [fname, content] of Object.entries(lipd.csvData)) {
    if (!regeneratedCsvs[fname]) {
      data.file(fname, content)
    }
  }

  // BagIt tag files
  bag.file('bagit.txt', 'BagIt-Version: 0.97\nTag-File-Character-Encoding: UTF-8\n')
  bag.file('bag-info.txt', `Bag-Software-Agent: lipd.net playground (lipd-studio)\nBagging-Date: ${new Date().toISOString().slice(0, 10)}\nName: LiPD Project\nReference: www.lipd.net\n`)

  // Compute manifest-md5.txt
  const dataFiles: Record<string, Uint8Array> = {}
  for (const [name, file] of Object.entries(data.files)) {
    if (!file.dir) {
      dataFiles[name] = await file.async('uint8array')
    }
  }
  const manifestLines: string[] = []
  for (const [name, bytes] of Object.entries(dataFiles).sort()) {
    const md5 = SparkMD5.ArrayBuffer.hash(bytes.buffer as ArrayBuffer)
    const shortName = name.replace('bag/data/', 'data/')
    manifestLines.push(`${md5}  ${shortName}`)
  }
  bag.file('manifest-md5.txt', manifestLines.join('\n') + '\n')

  // Compute tagmanifest-md5.txt
  const tagFiles = ['bag-info.txt', 'bagit.txt', 'manifest-md5.txt']
  const tagLines: string[] = []
  for (const tf of tagFiles) {
    const entry = bag.file(tf)
    if (entry) {
      const bytes = await entry.async('uint8array')
      const md5 = SparkMD5.ArrayBuffer.hash(bytes.buffer as ArrayBuffer)
      tagLines.push(`${md5}  ${tf}`)
    }
  }
  bag.file('tagmanifest-md5.txt', tagLines.join('\n') + '\n')

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

// Iterate every table in a section (measurement + all model sub-tables)
function* allSectionTables(section: { measurementTable?: LipdTable[]; model?: Array<{ summaryTable?: LipdTable[]; ensembleTable?: LipdTable[]; distributionTable?: LipdTable[] }> }): Generator<LipdTable> {
  for (const t of section.measurementTable ?? []) yield t
  for (const model of section.model ?? []) {
    for (const t of [...(model.summaryTable ?? []), ...(model.ensembleTable ?? []), ...(model.distributionTable ?? [])]) yield t
  }
}

function stripValues(metadata: LipdMetadata): LipdMetadata {
  const clone = JSON.parse(JSON.stringify(metadata)) as LipdMetadata
  const sections = [...(clone.paleoData ?? []), ...(clone.chronData ?? [])]
  for (const section of sections) {
    for (const table of allSectionTables(section)) {
      // Remove synthetic columns, restore original array-number form, strip values
      table.columns = (table.columns ?? []).filter(col => !col._synthetic)
      for (const col of table.columns) {
        delete col.values
        if (col._origNumber !== undefined) {
          col.number = col._origNumber as number
          delete col._origNumber
        }
      }
    }
  }
  return clone
}

function buildCsvFiles(metadata: LipdMetadata): Record<string, string> {
  const out: Record<string, string> = {}
  const sections = [...(metadata.paleoData ?? []), ...(metadata.chronData ?? [])]
  for (const section of sections) {
    for (const table of allSectionTables(section)) {
      if (!table.filename || !(table.columns ?? []).length) continue
      const fname = table.filename.split('/').pop()!
      const cols = [...(table.columns ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      const rowCount = Math.max(0, ...cols.map(c => c.values?.length ?? 0))
      if (rowCount === 0) continue
      const lines: string[] = []
      for (let i = 0; i < rowCount; i++) {
        lines.push(cols.map(c => {
          const v = c.values?.[i]
          return v === null || v === undefined ? 'NaN' : String(v)
        }).join(','))
      }
      out[fname] = lines.join('\n') + '\n'
    }
  }
  return out
}

// Re-attach all col.values from source into target (after a JSON clone stripped them)
function reattachAllValues(source: LipdMetadata, target: LipdMetadata): void {
  const srcSections = [...(source.paleoData ?? []), ...(source.chronData ?? [])]
  const tgtSections = [...(target.paleoData ?? []), ...(target.chronData ?? [])]
  srcSections.forEach((sec, si) => {
    ;(sec.measurementTable ?? []).forEach((tbl, ti) => {
      tbl.columns.forEach((col, ci) => {
        if (col.values) tgtSections[si].measurementTable![ti].columns[ci].values = [...col.values]
      })
    })
    ;(sec.model ?? []).forEach((model, mi) => {
      const tgtModel = tgtSections[si].model?.[mi]
      if (!tgtModel) return
      const keys = ['summaryTable', 'ensembleTable', 'distributionTable'] as const
      for (const key of keys) {
        ;(model[key] ?? []).forEach((tbl, ti) => {
          ;(tbl.columns ?? []).forEach((col, ci) => {
            if (col.values) (tgtModel[key] ??= [])[ti].columns[ci].values = [...col.values]
          })
        })
      }
    })
  })
}

// Resolve a table by path string (handles measurement and all model sub-tables)
function resolveTableFromPath(metadata: LipdMetadata, tablePath: string): LipdTable | undefined {
  const secMatch = tablePath.match(/^(paleoData|chronData)\[(\d+)\]/)
  if (!secMatch) return undefined
  const sections = (metadata[secMatch[1] as 'paleoData' | 'chronData'] ?? [])
  const section = sections[Number(secMatch[2])]
  if (!section) return undefined

  const measMatch = tablePath.match(/\.measurementTable\[(\d+)\]$/)
  if (measMatch) return (section.measurementTable ?? [])[Number(measMatch[1])]

  const modelMatch = tablePath.match(/\.model\[(\d+)\]\.(summaryTable|ensembleTable|distributionTable)\[(\d+)\]$/)
  if (modelMatch) {
    const tKey = modelMatch[2] as 'summaryTable' | 'ensembleTable' | 'distributionTable'
    return (section.model ?? [])[Number(modelMatch[1])]?.[tKey]?.[Number(modelMatch[3])]
  }
  return undefined
}

// ---- Helpers --------------------------------------------------------------

export function getColumns(metadata: LipdMetadata): Array<{ path: string; col: LipdColumn }> {
  const result: Array<{ path: string; col: LipdColumn }> = []
  const sections = [
    { key: 'paleoData', data: metadata.paleoData ?? [] },
    { key: 'chronData', data: metadata.chronData ?? [] },
  ]
  for (const { key, data } of sections) {
    data.forEach((section, pi) => {
      ;(section.measurementTable ?? []).forEach((table, ti) => {
        table.columns.forEach(col => {
          result.push({ path: `${key}[${pi}].measurementTable[${ti}]`, col })
        })
      })
    })
  }
  return result
}

export interface TableEntry {
  path: string       // e.g. "paleoData[0].measurementTable[0]"
  label: string      // e.g. "paleo0 · measurement0"
  table: LipdTable
}

export function getTables(metadata: LipdMetadata): TableEntry[] {
  const result: TableEntry[] = []
  const defs = [
    { key: 'paleoData', data: metadata.paleoData ?? [], prefix: 'paleo' },
    { key: 'chronData', data: metadata.chronData ?? [], prefix: 'chron' },
  ] as const
  for (const { key, data, prefix } of defs) {
    data.forEach((section, pi) => {
      ;(section.measurementTable ?? []).forEach((table, ti) => {
        result.push({
          path: `${key}[${pi}].measurementTable[${ti}]`,
          label: `${prefix}${pi} · measurement${ti}${table.tableName ? ` (${table.tableName})` : ''}`,
          table,
        })
      })
      ;(section.model ?? []).forEach((model, mi) => {
        const modelDefs = [
          { tKey: 'summaryTable',      tLabel: 'summary'      },
          { tKey: 'ensembleTable',     tLabel: 'ensemble'     },
          { tKey: 'distributionTable', tLabel: 'distribution' },
        ] as const
        for (const { tKey, tLabel } of modelDefs) {
          ;(model[tKey] ?? []).forEach((table, ti) => {
            result.push({
              path: `${key}[${pi}].model[${mi}].${tKey}[${ti}]`,
              label: `${prefix}${pi} · model${mi} · ${tLabel}${ti}${table.tableName ? ` (${table.tableName})` : ''}`,
              table,
            })
          })
        }
      })
    })
  }
  return result
}

export function updateCellValue(
  metadata: LipdMetadata,
  tablePath: string,
  colNumber: number,
  rowIndex: number,
  value: number | string | null
): LipdMetadata {
  const clone = JSON.parse(JSON.stringify(metadata)) as LipdMetadata
  reattachAllValues(metadata, clone)
  const table = resolveTableFromPath(clone, tablePath)
  if (!table) return metadata
  const col = (table.columns ?? []).find(c => c.number === colNumber)
  if (col?.values) col.values[rowIndex] = value
  return clone
}

export function deleteTableRow(
  metadata: LipdMetadata,
  tablePath: string,
  rowIndex: number,
): LipdMetadata {
  const clone = JSON.parse(JSON.stringify(metadata)) as LipdMetadata
  reattachAllValues(metadata, clone)
  const table = resolveTableFromPath(clone, tablePath)
  if (!table) return metadata
  for (const col of table.columns ?? []) {
    if (col.values) col.values.splice(rowIndex, 1)
  }
  return clone
}

export function addTableRow(
  metadata: LipdMetadata,
  tablePath: string,
): LipdMetadata {
  const clone = JSON.parse(JSON.stringify(metadata)) as LipdMetadata
  reattachAllValues(metadata, clone)
  const table = resolveTableFromPath(clone, tablePath)
  if (!table) return metadata
  for (const col of table.columns ?? []) {
    if (!col.values) col.values = []
    col.values.push(null)
  }
  return clone
}

// Replace a table's data with uploaded tabular content. With a header row,
// columns are matched to existing ones by variableName (case-insensitive) so
// their metadata (units, TSid, interpretations) is kept; unmatched headers
// become new columns and existing columns absent from the upload are dropped.
// Without a header row, values are applied positionally.
export function replaceTableData(
  metadata: LipdMetadata,
  tablePath: string,
  parsed: ParsedTabular,
): LipdMetadata {
  const clone = JSON.parse(JSON.stringify(metadata)) as LipdMetadata
  reattachAllValues(metadata, clone)
  const table = resolveTableFromPath(clone, tablePath)
  if (!table) return metadata

  const width = Math.max(0, ...parsed.rows.map(r => r.length))
  const colValues = (i: number) => parsed.rows.map(r => r[i] ?? null)

  if (parsed.headers) {
    const existing = table.columns ?? []
    table.columns = parsed.headers.map((header, i) => {
      const match = existing.find(c => c.variableName?.toLowerCase() === header.toLowerCase())
      const col: LipdColumn = match
        ? { ...match }
        : { number: 0, variableName: header, TSid: makeTSid() }
      col.number = i + 1
      col.values = colValues(i)
      return col
    })
  } else {
    const existing = [...(table.columns ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    const columns: LipdColumn[] = []
    for (let i = 0; i < width; i++) {
      const col: LipdColumn = existing[i]
        ? { ...existing[i] }
        : { number: 0, variableName: `column${i + 1}`, TSid: makeTSid() }
      col.number = i + 1
      col.values = colValues(i)
      columns.push(col)
    }
    table.columns = columns
  }
  return clone
}

// ---- Changelog helpers ----------------------------------------------------

export function bumpVersion(version?: string): string {
  if (!version) return '1.0.0'
  const parts = version.split('.').map(Number)
  if (parts.length === 3 && parts.every(n => !isNaN(n))) {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  }
  return version
}

export function appendChangelog(metadata: LipdMetadata, notes: string): LipdMetadata {
  const existing = metadata.changelog ?? []
  const lastVersion = existing.length > 0
    ? existing[existing.length - 1].version
    : (metadata.datasetVersion ?? '1.0.0')
  const newVersion = bumpVersion(lastVersion)
  const today = new Date().toISOString().slice(0, 10)
  return {
    ...metadata,
    datasetVersion: newVersion,
    changelog: [...existing, { name: 'lipd.net playground', date: today, version: newVersion, notes }],
  }
}

export function getSiteName(metadata: LipdMetadata): string {
  return (
    metadata.geo?.properties?.siteName ??
    metadata.geo?.siteName ??
    metadata.dataSetName ??
    'Unknown site'
  )
}

// ---- JSON editor helpers --------------------------------------------------

// Return metadata with all runtime values stripped (safe to display / edit as JSON)
export function getCleanMetadata(metadata: LipdMetadata): LipdMetadata {
  return stripValues(metadata)
}

// Apply a user-edited metadata JSON, preserving runtime col.values from the original
export function applyJsonEdit(edited: LipdMetadata, original: LipdMetadata): LipdMetadata {
  reattachAllValues(original, edited)
  return edited
}

export function getCoordinates(metadata: LipdMetadata): [number, number] | null {
  const geo = metadata.geo
  if (!geo) return null
  const coords = geo.geometry?.coordinates
  if (coords) return [coords[1], coords[0]] // [lat, lng]
  if (geo.latitude != null && geo.longitude != null) return [geo.latitude, geo.longitude]
  return null
}
