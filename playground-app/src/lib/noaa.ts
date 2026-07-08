// Import NOAA NCEI Paleoclimatology studies as LiPD datasets, entirely in the
// browser. Modeled on PyleoTUPS (https://github.com/LinkedEarth/PyleoTUPS):
// same study-search endpoint and the same "standard parser" strategy for
// NOAA-templated text files (# metadata, ## variable lines, delimited data).
import type { LipdFile, LipdMetadata, LipdPub, LipdTable, LipdPaleoData } from '../types/lipd'
import { makeTSid } from './newDataset'

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

// Accepts a NOAA study ID, a study URL (…/paleo-search/study/12345), or
// free-text search terms.
export async function searchNoaaStudies(query: string): Promise<NoaaStudy[]> {
  const q = query.trim()
  if (!q) return []
  const params = new URLSearchParams()
  const urlMatch = q.match(/paleo-search\/study\/(\d+)/)
  if (urlMatch) {
    params.set('NOAAStudyId', urlMatch[1])
  } else if (/^\d+$/.test(q)) {
    params.set('NOAAStudyId', q)
  } else {
    params.set('searchText', q)
    params.set('limit', '15')
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

export function parseNoaaTemplate(text: string): ParsedNoaaFile {
  const lines = text.split(/\r\n|\n|\r/)
  const metaIdx = lines
    .map((l, i) => (l.trimStart().startsWith('#') ? i : -1))
    .filter(i => i >= 0)
  if (!metaIdx.length) throw new Error('Not a NOAA-templated file (no metadata block)')
  const metaEnd = metaIdx[metaIdx.length - 1]

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
    for (let i = varMarker + 1; i <= metaEnd; i++) {
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

  // Data block: skip blank lines after metadata, then (if variables came from
  // metadata) skip the repeated header row
  let idx = metaEnd + 1
  while (idx < lines.length && !lines[idx].trim()) idx++
  const dataLines = lines.slice(idx).filter(l => l.trim())
  if (!dataLines.length) throw new Error('No data rows found')

  const splitRow = (l: string) => {
    const tabs = l.split('\t')
    return tabs.length > 1 ? tabs.map(t => t.trim()) : l.trim().split(/\s{2,}|\t/).map(t => t.trim())
  }

  let rows = dataLines.map(splitRow)
  if (varsFromMetadata) {
    rows = rows.slice(1) // header row repeats the shortnames
  } else {
    // No Variables block: first row is the header
    variables = rows[0].map((name, i) => ({ name: name || `column${i + 1}` }))
    rows = rows.slice(1)
  }
  if (!rows.length) throw new Error('No data rows found')

  // Pad ragged rows to a uniform width
  const width = Math.max(...rows.map(r => r.length))
  rows = rows.map(r => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r))

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
  skippedFiles: string[] // non-template files we couldn't convert
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
        if (!df.fileUrl || !/\.txt$/i.test(df.fileUrl)) {
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

  if (!paleoData.length) {
    throw new Error(
      'No NOAA-templated .txt data files could be parsed in this study' +
      (skippedFiles.length ? ` (${skippedFiles.length} file(s) skipped)` : '')
    )
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
    archiveType: study.dataType ? ARCHIVE_MAP[study.dataType.toUpperCase()] : undefined,
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
  }
}
