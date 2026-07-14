// Import NOAA NCEI Paleoclimatology studies as LiPD datasets, entirely in the
// browser. Modeled on PyleoTUPS (https://github.com/LinkedEarth/PyleoTUPS):
// same study-search endpoint and the same "standard parser" strategy for
// NOAA-templated text files (# metadata, ## variable lines, delimited data).
import type { LipdFile, LipdMetadata, LipdPub, LipdTable, LipdPaleoData } from '../types/lipd'
import { makeTSid } from './newDataset'
import { normalizeArchiveType, normalizeUnits } from './synonyms'

const SEARCH_URL = 'https://www.ncei.noaa.gov/access/paleo-search/study/search.json'

// ---- Study search -----------------------------------------------------------

export interface NoaaDataFile {
  fileUrl: string
  urlDescription?: string
  variables?: Array<Record<string, string | null>>
}

export interface NoaaStudy {
  NOAAStudyId: string
  xmlId?: string
  studyName: string
  dataType?: string
  investigators?: string
  doi?: string
  onlineResourceLink?: string
  earliestYearBP?: number
  mostRecentYearBP?: number
  publication?: Array<Record<string, unknown>>
  site?: Array<{
    siteName?: string
    locationName?: string
    geo?: {
      geometry?: { type?: string; coordinates?: Array<string | number> }
      properties?: Record<string, unknown>
    }
    paleoData?: Array<{
      dataTableName?: string
      dataFile?: NoaaDataFile[]
    }>
  }>
}

// NOAA dataType codes for the archive-type filter (from the NCEI
// study/params.json facet; the search API's dataType param is numeric).
export const NOAA_DATA_TYPES: Array<{ name: string; id: string }> = [
  { name: 'Borehole', id: '1' },
  { name: 'Climate forcing', id: '2' },
  { name: 'Climate reconstructions', id: '3' },
  { name: 'Corals and sclerosponges', id: '4' },
  { name: 'Fire history', id: '12' },
  { name: 'Historical', id: '6' },
  { name: 'Ice cores', id: '7' },
  { name: 'Insect', id: '8' },
  { name: 'Lake levels', id: '9' },
  { name: 'Loess and paleosol', id: '10' },
  { name: 'Paleoceanography', id: '14' },
  { name: 'Paleoclimatic modeling', id: '11' },
  { name: 'Paleolimnology', id: '13' },
  { name: 'Plant macrofossils', id: '15' },
  { name: 'Pollen', id: '16' },
  { name: 'Speleothems', id: '17' },
  { name: 'Tree ring', id: '18' },
]

// Advanced NOAA search filters. Field names mirror the PyleoTUPS
// search_studies() parameters; each maps to the NCEI paleo-search API param
// noted in searchNoaaStudies (kept in sync with pyleotups' query_builder).
export interface NoaaSearchFilters {
  investigators?: string
  dataTypeId?: string
  variableName?: string      // → cvWhats
  cvMaterials?: string       // → cvMaterials
  cvSeasonalities?: string   // → cvSeasonalities
  species?: string           // → species (4-letter tree codes)
  locations?: string         // → locations (hierarchical, e.g. "Continent>Africa")
  minLat?: number; maxLat?: number
  minLon?: number; maxLon?: number
  minElevation?: number; maxElevation?: number
  earliestYear?: number; latestYear?: number // years CE
  reconstructionOnly?: boolean
}

const hasFilters = (f: NoaaSearchFilters) =>
  Object.values(f).some(v => v !== undefined && v !== '' && v !== false && !Number.isNaN(v))

// Accepts a NOAA study ID, a study URL (…/paleo-search/study/12345), or
// free-text search terms, optionally combined with structured filters.
export async function searchNoaaStudies(query: string, filters: NoaaSearchFilters = {}): Promise<NoaaStudy[]> {
  const q = query.trim()
  if (!q && !hasFilters(filters)) return []
  const params = new URLSearchParams()

  const urlMatch = q.match(/paleo-search\/study\/(\d+)/)
  // A bare ID / study URL is an exact lookup; ignore other filters in that case.
  if (urlMatch) {
    params.set('NOAAStudyId', urlMatch[1])
  } else if (/^\d+$/.test(q)) {
    params.set('NOAAStudyId', q)
  } else {
    params.set('dataPublisher', 'NOAA')
    if (q) params.set('searchText', q)
    const str = (k: string, v?: string) => { if (v?.trim()) params.set(k, v.trim()) }
    str('investigators', filters.investigators)
    str('dataTypeId', filters.dataTypeId)
    str('cvWhats', filters.variableName)
    str('cvMaterials', filters.cvMaterials)
    str('cvSeasonalities', filters.cvSeasonalities)
    str('species', filters.species)
    str('locations', filters.locations)
    const num = (k: string, v?: number) => { if (v !== undefined && !Number.isNaN(v)) params.set(k, String(v)) }
    num('minLat', filters.minLat); num('maxLat', filters.maxLat)
    num('minLon', filters.minLon); num('maxLon', filters.maxLon)
    num('minElev', filters.minElevation); num('maxElev', filters.maxElevation)
    if (filters.earliestYear !== undefined && !Number.isNaN(filters.earliestYear)) params.set('earliestYear', String(filters.earliestYear))
    if (filters.latestYear !== undefined && !Number.isNaN(filters.latestYear)) params.set('latestYear', String(filters.latestYear))
    if (params.has('earliestYear') || params.has('latestYear')) params.set('timeFormat', 'CE')
    if (filters.reconstructionOnly) params.set('reconstructionsOnly', 'Y')
    params.set('limit', '25')
  }

  const res = await fetch(`${SEARCH_URL}?${params.toString()}`)
  if (res.status === 204) return [] // NOAA returns 204 + empty body for no matches
  if (!res.ok) throw new Error(`NOAA search failed (HTTP ${res.status})`)
  const text = await res.text()
  if (!text.trim()) return []
  const json = JSON.parse(text)
  return (json.study ?? []) as NoaaStudy[]
}

// ---- NOAA-template text file parser -----------------------------------------
// Port of PyleoTUPS StandardParser: metadata block = leading '#' lines,
// variables from the '# Variables' block's '##' lines (shortname + 9
// comma-separated components: what,material,error,units,seasonality,archive,
// detail,method,format), data = delimited matrix after the metadata block.

export interface NoaaVariable {
  name: string
  what?: string
  units?: string
  detail?: string
}

export interface ParsedNoaaFile {
  variables: NoaaVariable[]
  rows: string[][]
  missingValue?: string
}

// Pick the delimiter that splits the sample line into the most fields:
// tab > comma > 2+ spaces > any whitespace
function makeSplitter(sample: string): (l: string) => string[] {
  const candidates: Array<(l: string) => string[]> = [
    l => l.split('\t'),
    l => l.split(','),
    l => l.trim().split(/\s{2,}/),
    l => l.trim().split(/\s+/),
  ]
  let best = candidates[3]
  let bestCount = 1
  for (const c of candidates) {
    const n = c(sample).length
    if (n > bestCount) { best = c; bestCount = n }
  }
  return (l: string) => best(l).map(t => t.trim())
}

// Does this row look like a column-header row rather than data?
function looksLikeHeader(cells: string[]): boolean {
  const nonEmpty = cells.filter(c => c !== '')
  if (!nonEmpty.length) return false
  const nonNumeric = nonEmpty.filter(c => isNaN(Number(c))).length
  return nonNumeric >= Math.max(1, nonEmpty.length / 2)
}

// Reject prose/non-tabular content masquerading as a table: real data tables
// have a consistent column count and are mostly numeric. A description
// paragraph split on whitespace has neither.
function assertTabular(rows: string[][]): void {
  if (rows.length < 2) throw new Error('Not a data table (too few rows)')
  const counts = new Map<number, number>()
  for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)
  const modalShare = Math.max(...counts.values()) / rows.length
  if (modalShare < 0.6) throw new Error('Not a data table (irregular column counts)')
  let numeric = 0, cells = 0
  for (const r of rows) for (const c of r) {
    if (c.trim() === '') continue
    cells++
    if (!isNaN(Number(c))) numeric++
  }
  if (cells === 0 || numeric / cells < 0.25) {
    throw new Error('Not a data table (mostly non-numeric content)')
  }
}

// hasKnownVars: variable names were already parsed from the '##' block, so the
// detected header row (if any) is only used to decide whether to drop it, not
// to name columns.
//
// Header detection: drop row 0 when it looks like a header AND row 1 looks like
// data. This drops a real header row (e.g. "Depth  age  ...") whose casing
// differs from the '##' shortnames, while keeping legitimate text-first-column
// data (e.g. site codes "846B") where every row is equally header-ish.
function finishRows(
  dataLines: string[],
  hasKnownVars = false,
): { variables: NoaaVariable[] | null; rows: string[][] } {
  const split = makeSplitter(dataLines[0])
  let rows = dataLines.map(split)
  let variables: NoaaVariable[] | null = null

  const headerRow = looksLikeHeader(rows[0]) && (rows.length < 2 || !looksLikeHeader(rows[1]))
  if (headerRow) {
    if (!hasKnownVars) {
      variables = rows[0].map((name, i) => ({ name: name || `column${i + 1}` }))
    }
    rows = rows.slice(1)
  }

  if (!rows.length) throw new Error('No data rows found')
  assertTabular(rows)
  const width = Math.max(...rows.map(r => r.length))
  rows = rows.map(r => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r))
  return { variables, rows }
}

export function parseNoaaTemplate(text: string): ParsedNoaaFile {
  const lines = text.split(/\r\n|\n|\r/)
  const metaIdx = lines
    .map((l, i) => (l.trimStart().startsWith('#') ? i : -1))
    .filter(i => i >= 0)

  // No '#' metadata: either a clean delimited table, or an old-style NOAA file
  // with a prose preamble and possibly multiple data sections. The browser
  // parser only handles the clean case; the messy old format is left to the
  // PyleoTUPS service (which has a dedicated NonStandardParser). Detect a prose
  // preamble by checking whether the file starts with tabular content.
  if (!metaIdx.length) {
    const dataLines = lines.filter(l => l.trim())
    if (dataLines.length < 2) throw new Error('No data rows found')
    // How many of the first several non-empty lines look like a header or data
    // row (2+ delimited fields)? A clean table scores high; a prose preamble
    // scores low.
    const sample = dataLines.slice(0, 8)
    const tabularish = sample.filter(l => {
      const tabs = l.split('\t')
      const cells = tabs.length > 1 ? tabs : l.trim().split(/\s{2,}|,/)
      return cells.length >= 2
    }).length
    if (tabularish < sample.length * 0.75) {
      throw new Error(
        'This looks like an older non-standard NOAA file. ' +
        'It needs the PyleoTUPS import service, which is not available here.'
      )
    }
    const { variables, rows } = finishRows(dataLines)
    return {
      variables: variables ?? rows[0].map((_, i) => ({ name: `column${i + 1}` })),
      rows,
    }
  }

  // Declared missing value, e.g. "# Missing Value: -999"
  let missingValue: string | undefined
  for (const i of metaIdx) {
    const m = lines[i].match(/^#\s*Missing[_ ]Values?\s*:\s*(\S.*)$/i)
    if (m) { missingValue = m[1].trim(); break }
  }

  // Variables from the '##' lines following the '# Variables' marker
  let variables: NoaaVariable[] = []
  const varMarker = metaIdx.find(i => /^#\s*variables/i.test(lines[i]))
  if (varMarker !== undefined) {
    for (let i = varMarker + 1; i <= metaIdx[metaIdx.length - 1]; i++) {
      const line = lines[i]
      if (!line.trimStart().startsWith('##')) continue
      const body = line.replace(/^\s*#+\s*/, '')
      // shortname separated from components by a tab or 2+ spaces
      const m = body.match(/^(.*?)(?:\t|\s{2,})(.*)$/)
      const name = (m ? m[1] : body.split(/[\s,]+/)[0] ?? '').trim()
      if (!name) continue
      const comps = (m ? m[2] : '').split(',').map(c => c.trim())
      variables.push({
        name,
        what: comps[0] || undefined,
        units: comps[3] || undefined,
        detail: comps[6] || undefined,
      })
    }
  }
  const varsFromMetadata = variables.length > 0

  // Data block: everything after the last '#' line. If that leaves nothing
  // (some files put '#' footnotes AFTER the data), fall back to everything
  // after the first '#' block, dropping interspersed comment lines.
  const metaEnd = metaIdx[metaIdx.length - 1]
  let dataLines = lines.slice(metaEnd + 1).filter(l => l.trim())
  if (!dataLines.length) {
    const firstNonHash = lines.findIndex(
      (l, i) => i > metaIdx[0] && l.trim() !== '' && !l.trimStart().startsWith('#')
    )
    if (firstNonHash === -1) throw new Error('No data rows found')
    dataLines = lines.slice(firstNonHash).filter(l => l.trim() && !l.trimStart().startsWith('#'))
  }
  if (!dataLines.length) throw new Error('No data rows found')

  const { variables: headerVars, rows } = finishRows(dataLines, varsFromMetadata)
  if (!varsFromMetadata) {
    // No '##' block: use the detected header row, or generic names
    variables = headerVars ?? rows[0].map((_, i) => ({ name: `column${i + 1}` }))
  }

  return { variables, rows, missingValue }
}

// ---- LiPD assembly -----------------------------------------------------------

// NOAA dataType → LiPD archiveType (only unambiguous mappings)
const ARCHIVE_MAP: Record<string, string> = {
  'PALEOCEANOGRAPHY': 'Marine sediment',
  'PALEOLIMNOLOGY': 'Lake sediment',
  'TREE RING': 'Wood',
  'ICE CORES': 'Glacier ice',
  'CORALS AND SCLEROSPONGES': 'Coral',
  'SPELEOTHEMS': 'Speleothem',
  'BOREHOLE': 'Borehole',
  'LOESS': 'Terrestrial sediment',
  'PEAT': 'Peat',
}

const MISSING_TOKENS = new Set(['', 'na', 'nan', 'null'])
// Standard NOAA missing-value sentinels, compared numerically so that
// "-999", "-999.9", and "-999.90" all match
const MISSING_NUMBERS = new Set([-999, -999.9, -999.99, -9999])

function toValues(raw: string[], missingValue?: string): (number | string | null)[] {
  const declared = missingValue?.toLowerCase()
  const declaredNum = missingValue !== undefined ? Number(missingValue) : NaN
  return raw.map(v => {
    const t = v.trim()
    const lower = t.toLowerCase()
    if (MISSING_TOKENS.has(lower) || (declared && lower === declared)) return null
    const n = Number(t)
    if (isNaN(n)) return t
    if (MISSING_NUMBERS.has(n) || (!isNaN(declaredNum) && n === declaredNum)) return null
    return n
  })
}

function mapPublications(pubs: Array<Record<string, unknown>> = []): LipdPub[] {
  return pubs.map(p => {
    const authorRaw = p.author as Record<string, unknown> | string | undefined
    const authorStr =
      typeof authorRaw === 'string' ? authorRaw :
      typeof authorRaw?.name === 'string' ? (authorRaw.name as string) : undefined
    const ident = p.identifier as Record<string, unknown> | undefined
    const doi =
      typeof ident?.id === 'string' && (ident.type === 'doi' || ident.type === 'DOI')
        ? (ident.id as string)
        : undefined
    return {
      author: authorStr ? authorStr.split(/;\s*/).map(name => ({ name })) : undefined,
      title: p.title as string | undefined,
      journal: p.journal as string | undefined,
      year: (p.pubYear ?? p.year) as number | string | undefined,
      volume: p.volume as string | undefined,
      pages: p.pages as string | undefined,
      doi,
    } as LipdPub
  })
}

export interface NoaaImportResult {
  lipd: LipdFile
  skippedFiles: string[] // files we couldn't convert
  metadataOnly: boolean  // true when no data file could be parsed (starter table added)
}

export async function noaaStudyToLipd(study: NoaaStudy): Promise<NoaaImportResult> {
  const skippedFiles: string[] = []
  const paleoData: LipdPaleoData[] = []
  const csvData: Record<string, string> = {}

  const sites = study.site ?? []
  for (const site of sites) {
    const tables: LipdTable[] = []
    for (const pd of site.paleoData ?? []) {
      for (const df of pd.dataFile ?? []) {
        // Attempt only generic delimited-text extensions. Prose .txt files are
        // caught by assertTabular; specialized formats (.fhx fire-scar,
        // .rwl/.crn tree-ring, .xls, images/PDFs) have no generic parser and
        // are skipped, triggering the metadata-only fallback.
        if (!df.fileUrl || !/\.(txt|csv|tsv|dat)$/i.test(df.fileUrl)) {
          if (df.fileUrl) skippedFiles.push(df.fileUrl)
          continue
        }
        try {
          const res = await fetch(df.fileUrl)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const parsed = parseNoaaTemplate(await res.text())
          const pi = paleoData.length
          const ti = tables.length
          const filename = `paleo${pi}measurement${ti}.csv`
          tables.push({
            tableName: pd.dataTableName || df.fileUrl.split('/').pop(),
            filename,
            missingValue: 'NaN',
            columns: parsed.variables.map((v, ci) => ({
              number: ci + 1,
              variableName: v.name,
              TSid: makeTSid(),
              units: v.units,
              description: v.detail,
              values: toValues(parsed.rows.map(r => r[ci] ?? ''), parsed.missingValue),
            })),
          })
        } catch {
          skippedFiles.push(df.fileUrl)
        }
      }
    }
    if (tables.length) paleoData.push({ measurementTable: tables })
  }

  // Nothing auto-convertible (e.g. .fhx/.crn/.xls files): import the study's
  // metadata with an empty starter table — data can be added in the editor
  // via CSV upload or spreadsheet paste.
  const metadataOnly = !paleoData.length
  if (metadataOnly) {
    paleoData.push({
      measurementTable: [{
        tableName: 'measurementTable0',
        filename: 'paleo0measurement0.csv',
        missingValue: 'NaN',
        columns: [1, 2, 3].map((n, i) => ({
          number: n,
          variableName: ['depth', 'age', 'value'][i],
          TSid: makeTSid(),
          values: Array(5).fill(null),
        })),
      }],
    })
  }

  // Geo from the first site with coordinates. NOAA stores [lat, lon];
  // LiPD geometry is GeoJSON [lon, lat, elev].
  let geo: LipdMetadata['geo'] = undefined
  for (const site of sites) {
    const coords = site.geo?.geometry?.coordinates
    if (coords && coords.length >= 2) {
      const lat = Number(coords[0])
      const lon = Number(coords[1])
      if (!isNaN(lat) && !isNaN(lon)) {
        const props = site.geo?.properties ?? {}
        const elev = Number(props.minElevationMeters ?? props.elevation)
        geo = {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat, isNaN(elev) ? 0 : elev] },
          properties: { siteName: site.siteName ?? site.locationName ?? '' },
        }
        break
      }
    }
  }

  const dataSetName = (study.studyName || `NOAA-${study.NOAAStudyId}`)
    .replace(/[^\w.\- ]+/g, '')
    .trim()

  const metadata: LipdMetadata = {
    lipdVersion: 1.3,
    createdBy: 'lipd.net playground (NOAA import)',
    dataSetName,
    datasetVersion: '1.0.0',
    archiveType: normalizeArchiveType(study.dataType) ?? (study.dataType ? ARCHIVE_MAP[study.dataType.toUpperCase()] : undefined),
    investigators: study.investigators,
    originalDataUrl: study.onlineResourceLink,
    NOAAStudyId: study.NOAAStudyId,
    geo,
    pub: mapPublications(study.publication),
    paleoData,
  }

  return {
    lipd: { metadata, filename: `${dataSetName || 'noaa-import'}.lpd`, csvData },
    skippedFiles,
    metadataOnly,
  }
}

// ---- Load a local NOAA-template .txt file directly --------------------------

// Pull a "# Key: value" style field out of the metadata block
function metaField(text: string, keys: string[]): string | undefined {
  const lines = text.split(/\r\n|\n|\r/)
  for (const line of lines) {
    if (!line.trimStart().startsWith('#')) continue
    const m = line.replace(/^\s*#+\s*/, '').match(/^([^:]+):\s*(\S.*)$/)
    if (m && keys.some(k => m[1].trim().toLowerCase() === k.toLowerCase())) {
      return m[2].trim()
    }
  }
  return undefined
}

// Build a LiPD dataset from a single NOAA-templated text file the user opened
// locally (as opposed to importing a study by ID).
export function noaaFileToLipd(text: string, filename: string): LipdFile {
  const parsed = parseNoaaTemplate(text) // throws on non-tabular files

  const base = (filename.replace(/\.[^.]+$/, '') || 'noaa-dataset')
  const dataSetName = (metaField(text, ['Study_Name', 'Dataset_Name', 'Site_Name']) || base)
    .replace(/[^\w.\- ]+/g, '').trim() || base

  const num = (v?: string) => { const n = v ? Number(v) : NaN; return isNaN(n) ? undefined : n }
  const lat = num(metaField(text, ['Northernmost_Latitude', 'Southernmost_Latitude', 'Latitude']))
  const lon = num(metaField(text, ['Easternmost_Longitude', 'Westernmost_Longitude', 'Longitude']))
  const elev = num(metaField(text, ['Elevation', 'Elevation_m']))
  const siteName = metaField(text, ['Site_Name', 'Location'])

  const geo: LipdMetadata['geo'] = (lat != null && lon != null)
    ? {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat, elev ?? 0] },
        properties: { siteName: siteName ?? '' },
      }
    : undefined

  const metadata: LipdMetadata = {
    lipdVersion: 1.3,
    createdBy: 'lipd.net playground (NOAA file)',
    dataSetName,
    datasetVersion: '1.0.0',
    archiveType: undefined,
    geo,
    pub: [],
    paleoData: [{
      measurementTable: [{
        tableName: 'measurementTable0',
        filename: 'paleo0measurement0.csv',
        missingValue: 'NaN',
        columns: parsed.variables.map((v, ci) => ({
          number: ci + 1,
          variableName: v.name,
          TSid: makeTSid(),
          units: normalizeUnits(v.units) ?? v.units,
          description: v.detail,
          values: toValues(parsed.rows.map(r => r[ci] ?? ''), parsed.missingValue),
        })),
      }],
    }],
  }

  return { metadata, filename: `${dataSetName || base}.lpd`, csvData: {} }
}

// ---- PyleoTUPS service path -------------------------------------------------
// When the optional NOAA import service is deployed (Express proxies it at
// /api/noaa/:id), use its PyleoTUPS-parsed output — more robust than the
// browser parser above. Returns null when the service isn't available so the
// caller can fall back.

interface ServiceColumn { variableName: string; units?: string | null; values: Array<number | string | null> }
interface ServiceTable { tableName?: string | null; fileUrl?: string | null; columns: ServiceColumn[] }
interface ServicePayload {
  studyId: string
  dataSetName?: string | null
  archiveType?: string | null
  investigators?: string | null
  originalDataUrl?: string | null
  geo?: { latitude?: number | null; longitude?: number | null; elevation?: number | null; siteName?: string | null }
  pub?: Array<{ author?: string | null; title?: string | null; journal?: string | null; year?: number | string | null; volume?: string | null; pages?: string | null; doi?: string | null }>
  tables: ServiceTable[]
  skippedFiles: string[]
  metadataOnly: boolean
}

function serviceToLipd(p: ServicePayload): NoaaImportResult {
  const paleoData: LipdPaleoData[] = []
  const tables: LipdTable[] = p.tables.map((t, ti) => ({
    tableName: t.tableName || t.fileUrl?.split('/').pop() || `measurementTable${ti}`,
    filename: `paleo0measurement${ti}.csv`,
    missingValue: 'NaN',
    columns: t.columns.map((c, ci) => ({
      number: ci + 1,
      variableName: c.variableName,
      TSid: makeTSid(),
      // Normalize the source units onto the LiPD vocabulary where a synonym is
      // known (e.g. "deg C" → degC); otherwise keep the original string.
      units: normalizeUnits(c.units) ?? c.units ?? undefined,
      values: toValues(c.values.map(v => (v === null || v === undefined ? '' : String(v)))),
    })),
  }))
  const metadataOnly = tables.length === 0
  paleoData.push({
    measurementTable: metadataOnly
      ? [{
          tableName: 'measurementTable0',
          filename: 'paleo0measurement0.csv',
          missingValue: 'NaN',
          columns: ['depth', 'age', 'value'].map((name, i) => ({
            number: i + 1, variableName: name, TSid: makeTSid(), values: Array(5).fill(null),
          })),
        }]
      : tables,
  })

  const lat = p.geo?.latitude
  const lon = p.geo?.longitude
  const geo: LipdMetadata['geo'] = (lat != null && lon != null)
    ? {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat, p.geo?.elevation ?? 0] },
        properties: { siteName: p.geo?.siteName ?? '' },
      }
    : undefined

  const dataSetName = (p.dataSetName || `NOAA-${p.studyId}`).replace(/[^\w.\- ]+/g, '').trim()
  const metadata: LipdMetadata = {
    lipdVersion: 1.3,
    createdBy: 'lipd.net playground (NOAA import via PyleoTUPS)',
    dataSetName,
    datasetVersion: '1.0.0',
    // Prefer the synonyms map (e.g. "Marine" → MarineSediment); fall back to the
    // NOAA data-type map (e.g. PALEOCEANOGRAPHY → MarineSediment).
    archiveType: normalizeArchiveType(p.archiveType) ?? (p.archiveType ? ARCHIVE_MAP[p.archiveType.toUpperCase()] : undefined),
    investigators: p.investigators ?? undefined,
    originalDataUrl: p.originalDataUrl ?? undefined,
    NOAAStudyId: p.studyId,
    geo,
    pub: (p.pub ?? []).map(pub => ({
      author: pub.author ? pub.author.split(/;\s*|,\s(?=[A-Z]\.)/).filter(Boolean).map(name => ({ name })) : undefined,
      title: pub.title ?? undefined,
      journal: pub.journal ?? undefined,
      year: pub.year ?? undefined,
      volume: pub.volume ?? undefined,
      pages: pub.pages ?? undefined,
      doi: pub.doi ?? undefined,
    })),
    paleoData,
  }

  return {
    lipd: { metadata, filename: `${dataSetName || 'noaa-import'}.lpd`, csvData: {} },
    skippedFiles: p.skippedFiles ?? [],
    metadataOnly,
  }
}

// Try the PyleoTUPS service for a study id; null if it's not configured/down.
export async function noaaStudyViaService(studyId: string): Promise<NoaaImportResult | null> {
  if (!/^\d+$/.test(studyId)) return null
  let res: Response
  try {
    res = await fetch(`/api/noaa/${studyId}`)
  } catch {
    return null
  }
  if (res.status === 503 || res.status === 404) return null // not configured / unavailable
  if (!res.ok) return null
  try {
    return serviceToLipd(await res.json() as ServicePayload)
  } catch {
    return null
  }
}

// Result of trying to parse a local NOAA file through the service.
export type ServiceParseResult =
  | { status: 'ok'; result: NoaaImportResult }
  | { status: 'unavailable' }              // service not configured/reachable → caller may fall back
  | { status: 'error'; message: string }   // service ran but rejected the file

// Parse a local NOAA file's text via the PyleoTUPS service (Express proxies
// POST /api/noaa-parse). Distinguishes "service down" (fall back) from
// "service says this file is unparseable" (report honestly).
export async function noaaFileViaService(text: string, filename: string): Promise<ServiceParseResult> {
  let res: Response
  try {
    res = await fetch('/api/noaa-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    })
  } catch {
    return { status: 'unavailable' }
  }
  if (res.status === 503) return { status: 'unavailable' }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { detail = (await res.json())?.detail ?? detail } catch { /* keep default */ }
    return { status: 'error', message: String(detail) }
  }
  try {
    const payload = await res.json() as ServicePayload
    const base = filename.replace(/\.[^.]+$/, '') || 'noaa-dataset'
    if (!payload.dataSetName) payload.dataSetName = base
    const result = serviceToLipd(payload)
    result.lipd.filename = `${(payload.dataSetName || base).replace(/[^\w.\-]+/g, '_')}.lpd`
    return { status: 'ok', result }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Bad service response' }
  }
}

// ---- PANGAEA (service-only; PyleoTUPS PangaeaDataset) ------------------------

export interface PangaeaHit { id: string; name: string }
export type PangaeaSearchResult =
  | { status: 'ok'; hits: PangaeaHit[] }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

// Extract a numeric PANGAEA id from a raw id, DOI, or URL.
export function pangaeaId(input: string): string | null {
  const m = input.trim().match(/(?:PANGAEA\.)?(\d{3,})\s*$/i)
  return m ? m[1] : null
}

// Advanced PANGAEA search filters — mirror the PyleoTUPS search_studies params.
export interface PangaeaSearchFilters {
  investigators?: string
  variableName?: string
  topic?: string
  minLat?: number; maxLat?: number
  minLon?: number; maxLon?: number
}

// PANGAEA topic classifications PyleoTUPS accepts (for the UI dropdown).
export const PANGAEA_TOPICS = [
  'agriculture', 'atmosphere', 'biological classification', 'biosphere', 'chemistry',
  'cryosphere', 'ecology', 'fisheries', 'geophysics', 'human dimensions',
  'lakes & rivers', 'land surface', 'lithosphere', 'oceans', 'paleontology',
]

export async function pangaeaSearch(q: string, filters: PangaeaSearchFilters = {}): Promise<PangaeaSearchResult> {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  if (filters.investigators?.trim()) params.set('investigators', filters.investigators.trim())
  if (filters.variableName?.trim()) params.set('variable_name', filters.variableName.trim())
  if (filters.topic?.trim()) params.set('topic', filters.topic.trim())
  const num = (k: string, v?: number) => { if (v !== undefined && !Number.isNaN(v)) params.set(k, String(v)) }
  // PANGAEA needs a full bounding box or none
  if ([filters.minLat, filters.maxLat, filters.minLon, filters.maxLon].every(v => v !== undefined && !Number.isNaN(v as number))) {
    num('min_lat', filters.minLat); num('max_lat', filters.maxLat)
    num('min_lon', filters.minLon); num('max_lon', filters.maxLon)
  }
  let res: Response
  try {
    res = await fetch(`/api/pangaea-search?${params.toString()}`)
  } catch {
    return { status: 'unavailable' }
  }
  if (res.status === 503) return { status: 'unavailable' }
  if (!res.ok) return { status: 'error', message: `Search failed (HTTP ${res.status})` }
  try {
    const json = await res.json()
    return { status: 'ok', hits: (json.results ?? []) as PangaeaHit[] }
  } catch {
    return { status: 'error', message: 'Bad service response' }
  }
}

export async function pangaeaImport(id: string): Promise<ServiceParseResult> {
  let res: Response
  try {
    res = await fetch(`/api/pangaea/${id}`)
  } catch {
    return { status: 'unavailable' }
  }
  if (res.status === 503) return { status: 'unavailable' }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { detail = (await res.json())?.detail ?? detail } catch { /* keep default */ }
    return { status: 'error', message: String(detail) }
  }
  try {
    const payload = await res.json() as ServicePayload
    if (payload.metadataOnly || !payload.tables.length) {
      return { status: 'error', message: 'No importable data table found in this PANGAEA dataset.' }
    }
    return { status: 'ok', result: serviceToLipd(payload) }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Bad service response' }
  }
}
