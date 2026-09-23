// Import NOAA NCEI Paleoclimatology studies as LiPD datasets, entirely in the
// browser. Modeled on PyleoTUPS (https://github.com/LinkedEarth/PyleoTUPS):
// same study-search endpoint and the same "standard parser" strategy for
// NOAA-templated text files (# metadata, ## variable lines, delimited data).
import type { LipdFile, LipdMetadata, LipdPub, LipdTable, LipdColumn, LipdPaleoData, NoaaSourceFile } from '../types/lipd'
import { makeTSid } from './newDataset'
import { normalizeArchiveType, normalizeUnits, normalizeVariableName, normalizeProxy, proxyGeneralFor, normalizeSeasonality } from './synonyms'
import { stripCommas } from './tabular'

const SEARCH_URL = 'https://www.ncei.noaa.gov/access/paleo-search/study/search.json'

// NCEI's search.json has no total-count field and no pagination, so we cap
// results at this many. A full page (exactly this many hits) means there are
// likely more matches that aren't shown — the UI flags that so the user knows
// to narrow their search rather than assume this is the complete set.
export const NOAA_SEARCH_LIMIT = 25

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
  earliestYearCE?: number
  mostRecentYearCE?: number
  reconstruction?: string        // "Y" | "N"
  studyNotes?: string
  contributionDate?: string
  scienceKeywords?: string[]
  funding?: Array<Record<string, unknown>>
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
      timeUnit?: string
      species?: string
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

export type AndOr = 'and' | 'or'

// The 7 multi-value NOAA search fields (in UI order). Each accepts several
// values joined with '|'; when ≥2 values are given, an "AndOr" param controls
// whether they're combined with AND or OR (NCEI default: or). Mirrors PyleoTUPS'
// query_builder MULTI_SPECS.  key = NoaaSearchFilters key; param = NCEI param.
export const NOAA_MULTI_FIELDS = [
  { key: 'investigators',   param: 'investigators',   andOrParam: 'investigatorsAndOr' },
  { key: 'variableName',    param: 'cvWhats',         andOrParam: 'cvWhatsAndOr' },
  { key: 'cvMaterials',     param: 'cvMaterials',     andOrParam: 'cvMaterialsAndOr' },
  { key: 'cvSeasonalities', param: 'cvSeasonalities', andOrParam: 'cvSeasonalitiesAndOr' },
  { key: 'species',         param: 'species',         andOrParam: 'speciesAndOr' },
  { key: 'locations',       param: 'locations',       andOrParam: 'locationsAndOr' },
  { key: 'keywords',        param: 'keywords',        andOrParam: 'keywordsAndOr' },
] as const
export type NoaaMultiKey = typeof NOAA_MULTI_FIELDS[number]['key']

// Advanced NOAA search filters. Field names mirror the PyleoTUPS
// search_studies() parameters; each maps to the NCEI paleo-search API param
// noted in searchNoaaStudies (kept in sync with pyleotups' query_builder).
export interface NoaaSearchFilters {
  investigators?: string[]
  variableName?: string[]      // → cvWhats
  cvMaterials?: string[]       // → cvMaterials
  cvSeasonalities?: string[]   // → cvSeasonalities
  species?: string[]           // → species (4-letter codes)
  locations?: string[]         // → locations (hierarchical, e.g. "Continent>Africa")
  keywords?: string[]          // → keywords (NCEI controlled keyword hierarchy)
  andOr?: Partial<Record<NoaaMultiKey, AndOr>>  // per-field AND/OR when ≥2 values
  dataTypeId?: string          // archive type (single-select)
  minLat?: number; maxLat?: number
  minLon?: number; maxLon?: number
  minElevation?: number; maxElevation?: number
  earliestYear?: number; latestYear?: number // years, interpreted per timeFormat
  timeFormat?: 'CE' | 'BP'   // how to read the year bounds; NCEI defaults to CE
  timeMethod?: string        // '' → overAny (overlap, NCEI default); 'entireOver' (spans range); 'overEntire' (within range)
  recent?: boolean           // recently-added studies, newest first
  reconstructionOnly?: boolean
}

const hasFilters = (f: NoaaSearchFilters): boolean => {
  if (NOAA_MULTI_FIELDS.some(({ key }) => (f[key]?.length ?? 0) > 0)) return true
  if (f.dataTypeId) return true
  const nums = [f.minLat, f.maxLat, f.minLon, f.maxLon, f.minElevation, f.maxElevation, f.earliestYear, f.latestYear]
  if (nums.some(v => v !== undefined && !Number.isNaN(v))) return true
  return Boolean(f.recent || f.reconstructionOnly)
}

// Accepts a NOAA study ID, a study URL (…/paleo-search/study/12345), or
// free-text search terms, optionally combined with structured filters.
export async function searchNoaaStudies(
  query: string,
  filters: NoaaSearchFilters = {},
  limit: number = NOAA_SEARCH_LIMIT,
): Promise<NoaaStudy[]> {
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
    // Multi-value fields: join with '|' (URLSearchParams encodes it as %7C) and
    // send the AndOr flag only when ≥2 values are present (NCEI default: or).
    for (const { key, param, andOrParam } of NOAA_MULTI_FIELDS) {
      const vals = (filters[key] ?? []).map(s => s.trim()).filter(Boolean)
      if (!vals.length) continue
      params.set(param, vals.join('|'))
      if (vals.length >= 2) params.set(andOrParam, filters.andOr?.[key] ?? 'or')
    }
    if (filters.dataTypeId?.trim()) params.set('dataTypeId', filters.dataTypeId.trim())
    const num = (k: string, v?: number) => { if (v !== undefined && !Number.isNaN(v)) params.set(k, String(v)) }
    num('minLat', filters.minLat); num('maxLat', filters.maxLat)
    num('minLon', filters.minLon); num('maxLon', filters.maxLon)
    num('minElev', filters.minElevation); num('maxElev', filters.maxElevation)
    if (filters.earliestYear !== undefined && !Number.isNaN(filters.earliestYear)) params.set('earliestYear', String(filters.earliestYear))
    if (filters.latestYear !== undefined && !Number.isNaN(filters.latestYear)) params.set('latestYear', String(filters.latestYear))
    if (params.has('earliestYear') || params.has('latestYear')) {
      params.set('timeFormat', filters.timeFormat ?? 'CE')
      if (filters.timeMethod) params.set('timeMethod', filters.timeMethod)
    }
    if (filters.recent) params.set('recent', 'true')
    if (filters.reconstructionOnly) params.set('reconstructionsOnly', 'Y')
    params.set('limit', String(Math.max(1, Math.min(NOAA_SEARCH_LIMIT, limit))))
  }

  const res = await fetch(`${SEARCH_URL}?${params.toString()}`)
  if (res.status === 204) return [] // NOAA returns 204 + empty body for no matches
  if (!res.ok) throw new Error(`NOAA search failed (HTTP ${res.status})`)
  const text = await res.text()
  if (!text.trim()) return []
  const json = JSON.parse(text)
  return (json.study ?? []) as NoaaStudy[]
}

// ---- Cross-field boolean search --------------------------------------------
//
// At most this many NCEI requests per search. An OR costs one request per
// group, and with fifteen filters an expression could compile to fifteen --
// more load than a search box should ever put on someone else's server for one
// click. Groups past this are not searched, and the UI says so rather than
// quietly returning a wrong answer.
export const NOAA_MAX_BRANCHES = 6
// How many of those requests may be in flight at once.
const NOAA_BRANCH_CONCURRENCY = 3

// Run `fn` over `items` with at most `limit` in flight, settling rather than
// rejecting so one bad branch can't lose the others.
async function mapLimit<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out = new Array<PromiseSettledResult<R>>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try { out[i] = { status: 'fulfilled', value: await fn(items[i]) } }
      catch (reason) { out[i] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// NCEI combines its query params with AND and offers no way to OR two different
// filters, so "Variable=d18O OR Location=Greenland" cannot be expressed in one
// request. Every filled-in filter therefore becomes a *term*; `joins` says how
// each term combines with the one before it; the chain is compiled to
// disjunctive normal form (OR binds loosest) and each AND-segment becomes one
// NCEI request whose results are unioned. A single segment is exactly one
// request, identical to a plain search. See issue #17.

export type NoaaTermId =
  | NoaaMultiKey
  | 'searchText' | 'archiveType'
  | 'latitude' | 'longitude' | 'elevation'
  | 'years' | 'recent' | 'reconstructionOnly'

// Every filter that can take part in the expression, in the order the search
// form presents them, so the combiner reads like the form does.
export const NOAA_TERM_ORDER: NoaaTermId[] = [
  'searchText', 'archiveType',
  'variableName', 'cvMaterials', 'cvSeasonalities', 'species',
  'locations', 'latitude', 'longitude', 'elevation',
  'years',
  'investigators', 'keywords', 'recent', 'reconstructionOnly',
]

// Where a term sits in the expression.
//   'chain'  - part of the AND/OR chain, so it belongs to one branch
//   'always' - merged into EVERY branch, which is the only way to say
//              "(A OR B) AND C"; a linear chain alone cannot express it
export type NoaaTermScope = 'chain' | 'always'

export interface NoaaTerm {
  id: NoaaTermId
  label: string            // e.g. "Latitude"
  detail: string           // e.g. "at least 20", "all of (a, b)"; '' for a flag
  scope: NoaaTermScope
  joinToPrevious: AndOr    // ignored on the first chain term and when scope is 'always'
  patch: NoaaSearchFilters // what this term contributes to a branch's request
  query?: string           // free text travels as searchNoaaStudies' `query`
}

// The seven controlled-vocabulary fields are what people actually want to OR,
// so they default into the chain. Everything else defaults to constraining
// every branch, which is how these filters behaved before they were selectable
// — so the default query is unchanged and only an explicit move alters it.
export function defaultScope(id: NoaaTermId): NoaaTermScope {
  return (NOAA_MULTI_FIELDS as readonly { key: string }[]).some(f => f.key === id) ? 'chain' : 'always'
}

// A snapshot of the search form. Only the fields that are set become terms.
export interface NoaaFilterInput {
  searchText?: string
  archiveTypeName?: string     // what the user typed / picked
  dataTypeId?: string          // resolved NCEI numeric id
  multi?: Partial<Record<NoaaMultiKey, string[]>>
  within?: Partial<Record<NoaaMultiKey, AndOr>>   // per-field any/all
  minLat?: number; maxLat?: number
  minLon?: number; maxLon?: number
  minElevation?: number; maxElevation?: number
  earliestYear?: number; latestYear?: number
  timeFormat?: 'CE' | 'BP'
  timeMethod?: string
  recent?: boolean
  reconstructionOnly?: boolean
}

const MULTI_LABEL: Record<NoaaMultiKey, string> = {
  investigators: 'Investigator',
  variableName: 'Variable',
  cvMaterials: 'Material',
  cvSeasonalities: 'Seasonality',
  species: 'Species',
  locations: 'Location',
  keywords: 'Keyword category',
}

const num = (v?: number): boolean => v !== undefined && !Number.isNaN(v)

// "at least 20" / "at most 40" / "20 to 40". `suffix` is appended verbatim, so
// callers control spacing: degrees attach to the number, metres take a space.
function rangeDetail(min?: number, max?: number, suffix = ''): string {
  if (num(min) && num(max)) return `${min} to ${max}${suffix}`
  if (num(min)) return `at least ${min}${suffix}`
  return `at most ${max}${suffix}`
}

const TIME_MATCH_DETAIL: Record<string, string> = {
  entireOver: 'spanning the whole range',
  overAny: 'overlapping the range',
  overEntire: 'falling within the range',
}

// The filled-in filters as an ordered boolean expression.
export function buildTerms(
  input: NoaaFilterInput,
  joins: Partial<Record<NoaaTermId, AndOr>> = {},
  scopes: Partial<Record<NoaaTermId, NoaaTermScope>> = {},
): NoaaTerm[] {
  const terms: NoaaTerm[] = []
  const add = (id: NoaaTermId, label: string, detail: string, patch: NoaaSearchFilters, query?: string) => {
    terms.push({
      id, label, detail,
      scope: scopes[id] ?? defaultScope(id),
      joinToPrevious: joins[id] ?? 'and',
      patch, ...(query ? { query } : {}),
    })
  }

  for (const id of NOAA_TERM_ORDER) {
    switch (id) {
      case 'searchText': {
        const t = input.searchText?.trim()
        if (t) add(id, 'Keywords', t, {}, t)
        break
      }
      case 'archiveType': {
        if (input.dataTypeId) {
          add(id, 'Archive type', input.archiveTypeName?.trim() || input.dataTypeId, { dataTypeId: input.dataTypeId })
        }
        break
      }
      case 'latitude': {
        if (num(input.minLat) || num(input.maxLat)) {
          add(id, 'Latitude', rangeDetail(input.minLat, input.maxLat, '\u00b0'), { minLat: input.minLat, maxLat: input.maxLat })
        }
        break
      }
      case 'longitude': {
        if (num(input.minLon) || num(input.maxLon)) {
          add(id, 'Longitude', rangeDetail(input.minLon, input.maxLon, '\u00b0'), { minLon: input.minLon, maxLon: input.maxLon })
        }
        break
      }
      case 'elevation': {
        if (num(input.minElevation) || num(input.maxElevation)) {
          add(id, 'Elevation', rangeDetail(input.minElevation, input.maxElevation, ' m'), { minElevation: input.minElevation, maxElevation: input.maxElevation })
        }
        break
      }
      case 'years': {
        if (num(input.earliestYear) || num(input.latestYear)) {
          const basis = input.timeFormat ?? 'CE'
          const match = TIME_MATCH_DETAIL[input.timeMethod ?? ''] ?? ''
          const detail = `${rangeDetail(input.earliestYear, input.latestYear)} ${basis}${match ? `, ${match}` : ''}`
          add(id, 'Year', detail, {
            earliestYear: input.earliestYear, latestYear: input.latestYear,
            timeFormat: basis, ...(input.timeMethod ? { timeMethod: input.timeMethod } : {}),
          })
        }
        break
      }
      case 'recent': {
        if (input.recent) add(id, 'Recently added', '', { recent: true })
        break
      }
      case 'reconstructionOnly': {
        if (input.reconstructionOnly) add(id, 'Reconstructions only', '', { reconstructionOnly: true })
        break
      }
      default: {
        // One of the seven controlled-vocabulary chip fields.
        const key = id as NoaaMultiKey
        const values = (input.multi?.[key] ?? []).map(v => v.trim()).filter(Boolean)
        if (!values.length) break
        const within = input.within?.[key] ?? 'or'
        const detail = values.length === 1
          ? values[0]
          : `${within === 'and' ? 'all' : 'any'} of (${values.join(', ')})`
        add(id, MULTI_LABEL[key], detail, { [key]: values, andOr: { [key]: within } } as NoaaSearchFilters)
      }
    }
  }
  return terms
}

export const chainTerms = (terms: NoaaTerm[]) => terms.filter(t => t.scope === 'chain')
export const alwaysTerms = (terms: NoaaTerm[]) => terms.filter(t => t.scope === 'always')

// Split the chain into AND-segments at every OR join (the first term always
// starts a segment). Terms scoped 'always' take no part; they are merged into
// every segment later. [] when the chain is empty.
export function toAndSegments(terms: NoaaTerm[]): NoaaTerm[][] {
  const segments: NoaaTerm[][] = []
  chainTerms(terms).forEach((term, i) => {
    if (i === 0 || term.joinToPrevious === 'or') segments.push([term])
    else segments[segments.length - 1].push(term)
  })
  return segments
}

export interface NoaaBooleanSearchResult {
  studies: NoaaStudy[]
  // How many NCEI requests were actually sent. >1 means the result is a union,
  // drawn from the branches in turn and capped at NOAA_SEARCH_LIMIT in total --
  // the cap is on what you get back, not on each branch.
  branches: number
  // Groups the expression asked for beyond NOAA_MAX_BRANCHES, which were not
  // searched. Non-zero means the results are incomplete and must say so.
  skippedGroups: number
}

// Merge one AND-segment's terms into the request it becomes.
function segmentRequest(seg: NoaaTerm[]): { query: string; filters: NoaaSearchFilters } {
  const filters: NoaaSearchFilters = {}
  let query = ''
  for (const term of seg) {
    const { andOr, ...rest } = term.patch
    Object.assign(filters, rest)
    if (andOr) filters.andOr = { ...filters.andOr, ...andOr }
    if (term.query) query = term.query
  }
  return { query, filters }
}

// Run a boolean expression against NCEI, unioning the branches. `exactLookup`
// is the study id / study URL box, which bypasses the expression entirely.
export async function searchNoaaStudiesBoolean(
  exactLookup: string,
  terms: NoaaTerm[],
): Promise<NoaaBooleanSearchResult> {
  // A bare study id or URL is an exact lookup that ignores filters anyway --
  // fanning it out would just fetch the same study several times.
  const q = exactLookup.trim()
  if (/^\d+$/.test(q) || /paleo-search\/study\/(\d+)/.test(q)) {
    return { studies: await searchNoaaStudies(q, {}), branches: 1, skippedGroups: 0 }
  }

  // Terms scoped 'always' constrain every branch, so they are prepended to each
  // segment. With no chain at all they are the whole query, as one request.
  const always = alwaysTerms(terms)
  const segments = toAndSegments(terms)
  const wanted = segments.length ? segments.map(seg => [...always, ...seg]) : (always.length ? [always] : [])
  if (!wanted.length) return { studies: [], branches: 0, skippedGroups: 0 }

  // Two budgets, both about being a good citizen of someone else's API.
  // Requests: never more than NOAA_MAX_BRANCHES, a few at a time.
  const branches = wanted.slice(0, NOAA_MAX_BRANCHES)
  const skippedGroups = wanted.length - branches.length
  // Rows: ask each branch only for its share of the 25 we can show, so the
  // bytes pulled stay flat as groups are added instead of growing 25 per
  // group. One branch is unchanged -- it still asks for the full 25.
  const perBranch = Math.ceil(NOAA_SEARCH_LIMIT / branches.length)

  const settled = await mapLimit(branches, NOAA_BRANCH_CONCURRENCY, seg => {
    const { query, filters } = segmentRequest(seg)
    return searchNoaaStudies(query, filters, perBranch)
  })
  // One failing branch shouldn't lose the others; only an all-failure rethrows.
  const ok = settled.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<NoaaStudy[]>[]
  if (!ok.length) {
    const first = settled[0]
    throw first.status === 'rejected' ? first.reason : new Error('NOAA search failed')
  }

  // Union under ONE cap of NOAA_SEARCH_LIMIT, not one cap per branch -- an OR
  // shouldn't quietly return four times as many rows as a plain search. Taking
  // from the branches in turn rather than draining each in order is what makes
  // that cap fair: a broad alternative would otherwise fill the whole budget
  // and the alternative you added it for would never appear. Within a branch
  // NCEI's own ranking is preserved.
  const lists = ok.map(r => r.value)
  const deepest = lists.reduce((m, l) => Math.max(m, l.length), 0)
  const seen = new Set<string>()
  const studies: NoaaStudy[] = []
  outer: for (let i = 0; i < deepest; i++) {
    for (const list of lists) {
      const study = list[i]
      if (!study || seen.has(study.NOAAStudyId)) continue
      seen.add(study.NOAAStudyId)
      studies.push(study)
      if (studies.length >= NOAA_SEARCH_LIMIT) break outer
    }
  }
  return { studies, branches: branches.length, skippedGroups }
}


// List the data files attached to a NOAA study, by id — used by the editor's
// NOAA view to show a dataset's original source text after a reload (when the
// text wasn't captured in memory at import). Returns {name, url} entries; the
// view fetches each file's text lazily via fetchNoaaFileText.
export async function listNoaaStudyFiles(studyId: string): Promise<NoaaSourceFile[]> {
  const studies = await searchNoaaStudies(studyId)
  const study = studies.find(s => s.NOAAStudyId === studyId) ?? studies[0]
  if (!study) return []
  const files: NoaaSourceFile[] = []
  const seen = new Set<string>()
  for (const site of study.site ?? []) {
    for (const pd of site.paleoData ?? []) {
      for (const df of pd.dataFile ?? []) {
        if (!df.fileUrl || seen.has(df.fileUrl)) continue
        seen.add(df.fileUrl)
        files.push({ name: df.urlDescription || df.fileUrl.split('/').pop() || df.fileUrl, url: df.fileUrl })
      }
    }
  }
  return files
}

// Fetch a NOAA data file's raw text in the browser. NCEI data files are
// CORS-fetchable (the browser import path relies on it); a blocked fetch throws
// so the NOAA view can fall back to a link-out.
export async function fetchNoaaFileText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
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
    // Strip commas before anything else: LiPD CSVs are unquoted, so a comma in
    // an imported value would shift every later column (issue #2). This also
    // recovers thousands-separated numbers as real numbers.
    const t = stripCommas(v)
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
  const noaaFiles: NoaaSourceFile[] = []  // raw source text, for the NOAA view

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
          const rawText = await res.text()
          noaaFiles.push({ name: df.urlDescription || df.fileUrl.split('/').pop() || df.fileUrl, url: df.fileUrl, text: rawText })
          const parsed = parseNoaaTemplate(rawText)
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
    lipd: { metadata, filename: `${dataSetName || 'noaa-import'}.lpd`, csvData, ...(noaaFiles.length ? { noaaFiles } : {}) },
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

  return {
    metadata,
    filename: `${dataSetName || base}.lpd`,
    csvData: {},
    noaaFiles: [{ name: filename, text }],
  }
}

// ---- PyleoTUPS service path -------------------------------------------------
// When the optional NOAA import service is deployed (Express proxies it at
// /api/noaa/:id), use its PyleoTUPS-parsed output — more robust than the
// browser parser above. Returns null when the service isn't available so the
// caller can fall back.

interface ServiceColumn {
  variableName: string
  units?: string | null
  proxy?: string | null        // from cvWhat leaf
  material?: string | null     // from cvMaterial leaf
  method?: string | null       // from cvMethod
  seasonality?: string | null  // from cvSeasonality
  description?: string | null  // from cvDetail
  values: Array<number | string | null>
}
// One NOAA site within a study. A study can span many (a compilation, a
// transect, a drilling campaign); the service reports the site each data table
// belongs to so the structure survives import. See issue #14.
export interface ServiceSite {
  key: string
  siteName?: string | null
  latitude?: number | null
  longitude?: number | null
  elevation?: number | null
}
interface ServiceTable {
  tableName?: string | null; fileUrl?: string | null; review?: boolean
  kind?: 'chron' | 'paleo'; columns: ServiceColumn[]
  site?: Omit<ServiceSite, 'key'> | null
  siteKey?: string | null
}
export interface ServicePayload {
  studyId: string
  dataSetName?: string | null
  archiveType?: string | null
  investigators?: string | null
  studyNotes?: string | null
  funding?: Array<Record<string, unknown>>
  datasetDOI?: string | null
  originalDataUrl?: string | null
  geo?: { latitude?: number | null; longitude?: number | null; elevation?: number | null; siteName?: string | null }
  pub?: Array<{ author?: string | null; title?: string | null; journal?: string | null; year?: number | string | null; volume?: string | null; pages?: string | null; doi?: string | null }>
  // Every distinct site in the study, first-seen order (NOAA path only).
  sites?: ServiceSite[]
  tables: ServiceTable[]
  skippedFiles: string[]
  metadataOnly: boolean
  // Present when the PANGAEA id is a collection (no direct data of its own)
  collection?: boolean
  members?: Array<{ id: string; name?: string }>
}

// The sites a payload actually has data for, in the order the service reports
// them. A single-site study (the common case) yields one entry.
export function payloadSites(p: ServicePayload): ServiceSite[] {
  return (p.sites ?? []).filter(site => p.tables.some(t => t.siteKey === site.key))
}

// ---- Multi-site geometry ----------------------------------------------------

// Convex hull (monotone chain) of the site points, in GeoJSON [lon, lat] order.
function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  const uniq = Array.from(new Map(pts.map(pt => [`${pt[0]},${pt[1]}`, pt])).values())
  if (uniq.length < 3) return uniq
  uniq.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (src: Array<[number, number]>) => {
    const out: Array<[number, number]> = []
    for (const pt of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], pt) <= 0) out.pop()
      out.push(pt)
    }
    out.pop()
    return out
  }
  return [...half(uniq), ...half([...uniq].reverse())]
}

// The geographic footprint of a set of sites.
//   one site (or all sites coincident) → Point, exactly as a single-site import
//   sites that enclose an area        → Polygon (convex hull of the points)
//   collinear sites                   → Polygon (their bounding box), since a
//                                       GeoJSON ring needs real extent
// A degenerate bounding box falls back to a Point rather than emitting an
// invalid ring.
export function geoForSites(sites: ServiceSite[], siteName?: string | null): LipdMetadata['geo'] {
  const located = sites.filter(s => s.latitude != null && s.longitude != null)
  if (!located.length) return undefined

  const pts = located.map(s => [Number(s.longitude), Number(s.latitude)] as [number, number])
  const elevs = located.map(s => s.elevation).filter((e): e is number => e != null)
  // Rounded: a mean of integer site elevations otherwise surfaces as
  // -617.2857142857143 in the metadata editor.
  const meanElev = elevs.length ? Math.round((elevs.reduce((a, b) => a + b, 0) / elevs.length) * 10) / 10 : 0
  const names = located.map(s => s.siteName).filter(Boolean)
  const label = siteName ?? (names.length === 1 ? names[0] : `${located.length} sites`)

  const point = (lon: number, lat: number, elev: number): LipdMetadata['geo'] => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat, elev] },
    properties: { siteName: label ?? '' },
  })

  const distinct = new Set(pts.map(pt => `${pt[0]},${pt[1]}`))
  if (distinct.size === 1) return point(pts[0][0], pts[0][1], located[0].elevation ?? 0)

  let ring = convexHull(pts)
  if (ring.length < 3) {
    // Collinear (or two) sites: use the bounding box so the ring has area.
    const lons = pts.map(pt => pt[0]); const lats = pts.map(pt => pt[1])
    const [w, e] = [Math.min(...lons), Math.max(...lons)]
    const [s2, n] = [Math.min(...lats), Math.max(...lats)]
    if (w === e || s2 === n) {
      // A true line has no area — a centroid point is more honest than a
      // zero-width polygon that downstream tools would reject.
      return point((w + e) / 2, (s2 + n) / 2, meanElev)
    }
    ring = [[w, s2], [e, s2], [e, n], [w, n]]
  }
  return {
    type: 'Feature',
    geometry: {
      // GeoJSON polygon rings are closed: repeat the first position last.
      type: 'Polygon',
      coordinates: [[...ring, ring[0]].map(([lon, lat]) => [lon, lat, meanElev])],
    },
    properties: { siteName: label ?? '' },
  }
}

// How a study's sites become LiPD datasets (issue #14).
//   'collapse' - one dataset; each site becomes its own PaleoData object, the
//                geo is the footprint of all of them, and every table gains
//                constant latitude/longitude/elevation columns so a row can
//                still be traced back to its site.
//   'single'   - one dataset for the site named by `siteKey`, shaped exactly
//                like an ordinary single-site import.
export type SiteMode = 'collapse' | 'single'
export interface BuildOpts { mode?: SiteMode; siteKey?: string }

// A constant column carrying one of a site's coordinates, repeated down the
// table. This is how per-site location survives collapsing: without it, a row
// in a merged multi-site dataset has no way back to the place it came from.
function siteColumn(name: string, units: string, value: number, rows: number, number: number): LipdColumn {
  return {
    number,
    variableName: name,
    TSid: makeTSid(),
    units,
    description: `Site ${name}, constant for this table`,
    values: Array(rows).fill(value),
  }
}

function addSiteColumns(table: LipdTable, site: ServiceSite): void {
  const rows = Math.max(0, ...(table.columns ?? []).map(c => c.values?.length ?? 0))
  if (!rows) return
  const present = new Set((table.columns ?? []).map(c => c.variableName.toLowerCase()))
  let next = Math.max(0, ...(table.columns ?? []).map(c => c.number ?? 0))
  const add = (name: string, units: string, value: number | null | undefined) => {
    if (value == null || present.has(name.toLowerCase())) return
    table.columns.push(siteColumn(name, units, value, rows, ++next))
  }
  add('latitude', 'degrees north', site.latitude)
  add('longitude', 'degrees east', site.longitude)
  add('elevation', 'm', site.elevation)
}

function serviceToLipd(p: ServicePayload, source: 'NOAA' | 'PANGAEA' = 'NOAA', opts: BuildOpts = {}): NoaaImportResult {
  const mode: SiteMode = opts.mode ?? 'collapse'
  const sourceTables = opts.siteKey
    ? p.tables.filter(t => t.siteKey === opts.siteKey)
    : p.tables
  const paleoData: LipdPaleoData[] = []
  const built = sourceTables.map((t, ti) => {
    // Track variableNames already used in this table so normalization never
    // collapses two distinct columns onto the same name (e.g. "age" + "ageMedian").
    const usedNames = new Set(t.columns.map(c => c.variableName))
    const table: LipdTable = {
      tableName: t.tableName || t.fileUrl?.split('/').pop() || `measurementTable${ti}`,
      filename: '',  // assigned per paleo/chron group below
      missingValue: 'NaN',
      // Heuristically-named fallback tables are flagged so the import flow can
      // ask the user to confirm/edit the column names first.
      ...(t.review ? { reviewNeeded: true, sourceUrl: t.fileUrl ?? undefined } : {}),
      columns: t.columns.map((c, ci) => {
        const mapped = normalizeVariableName(c.variableName)
        // Only apply the mapping if it doesn't clash with another column's name.
        const variableName = (mapped && mapped !== c.variableName && !usedNames.has(mapped))
          ? (usedNames.delete(c.variableName), usedNames.add(mapped), mapped)
          : c.variableName
        // Proxy from NOAA's cvWhat, normalized onto LiPD vocabulary where known;
        // proxyGeneral is auto-derived from it (never shown as an editable field).
        const proxy = c.proxy ? (normalizeProxy(c.proxy) ?? c.proxy) : undefined
        const proxyGeneral = proxy ? proxyGeneralFor(proxy) : undefined
        const material = c.material?.trim() || undefined
        const method = c.method?.trim() || undefined
        const description = c.description?.trim() || undefined
        // NOAA seasonality → a LiPD column interpretation block (its natural home
        // in the model). Canonicalize onto the LiPD vocabulary casing where known
        // (annual → Annual); otherwise keep the leaf verbatim.
        const seasonality = c.seasonality?.trim()
          ? (normalizeSeasonality(c.seasonality) ?? c.seasonality.trim())
          : undefined
        return {
          number: ci + 1,
          variableName,
          TSid: makeTSid(),
          // Normalize the source units onto the LiPD vocabulary where a synonym
          // is known (e.g. "deg C" → degC); otherwise keep the original string.
          units: normalizeUnits(c.units) ?? c.units ?? undefined,
          ...(proxy ? { proxy } : {}),
          ...(proxyGeneral ? { proxyGeneral } : {}),
          ...(description ? { description } : {}),
          ...(material ? { measurementMaterial: material } : {}),
          ...(method ? { method } : {}),
          ...(seasonality ? { interpretation: [{ seasonality }] } : {}),
          values: toValues(c.values.map(v => (v === null || v === undefined ? '' : String(v)))),
        }
      }),
    }
    // Chronology/age-model tables (kind === 'chron') go to chronData, not paleoData.
    return { table, chron: t.kind === 'chron', siteKey: t.siteKey ?? '' }
  })

  // The sites actually represented by the tables being built, in the order the
  // service reported them. Empty for a PANGAEA payload or an older service
  // with no per-table site, which then follows the original single-geo path.
  const keysPresent = new Set(built.map(b => b.siteKey))
  const sites: ServiceSite[] = payloadSites(p).filter(site => keysPresent.has(site.key))
  const grouped = mode === 'collapse' && sites.length > 1

  // Only a genuinely multi-site dataset needs location columns; on a single
  // site they would be three constant columns of noise.
  if (grouped) {
    for (const b of built) {
      const site = sites.find(x => x.key === b.siteKey)
      if (site) addSiteColumns(b.table, site)
    }
  }

  // Order the site groups, then number filenames by each group's index so they
  // stay contiguous per section (paleo0..., paleo1...) as LiPD readers expect.
  const groups = grouped ? sites.map(site => site.key) : ['']
  const tablesFor = (key: string, chron: boolean) =>
    built.filter(b => b.chron === chron && (!grouped || b.siteKey === key)).map(b => b.table)

  const metadataOnly = built.length === 0
  if (metadataOnly) {
    paleoData.push({
      measurementTable: [{
        tableName: 'measurementTable0',
        filename: 'paleo0measurement0.csv',
        missingValue: 'NaN',
        columns: ['depth', 'age', 'value'].map((name, i) => ({
          number: i + 1, variableName: name, TSid: makeTSid(), values: Array(5).fill(null),
        })),
      }],
    })
  } else {
    for (const key of groups) {
      const tables = tablesFor(key, false)
      if (!tables.length) continue
      const si = paleoData.length
      paleoData.push({
        measurementTable: tables.map((t, i) => ({ ...t, filename: `paleo${si}measurement${i}.csv` })),
      })
    }
    // A study whose only tables are chronologies still needs a paleoData slot.
    if (!paleoData.length) paleoData.push({ measurementTable: [] })
  }

  const chronData: LipdPaleoData[] = []
  for (const key of groups) {
    const tables = tablesFor(key, true)
    if (!tables.length) continue
    const si = chronData.length
    chronData.push({
      measurementTable: tables.map((t, i) => ({ ...t, filename: `chron${si}measurement${i}.csv` })),
    })
  }

  // Geo: the footprint of the sites in this dataset. One site, or 'single'
  // mode, yields the same Point as before; several yield a Polygon hull.
  const single = mode === 'single' ? sites[0] : undefined
  const geo: LipdMetadata['geo'] = sites.length
    ? geoForSites(single ? [single] : sites, single?.siteName ?? (sites.length === 1 ? sites[0].siteName : undefined))
    : (p.geo?.latitude != null && p.geo?.longitude != null
        ? {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.geo.longitude, p.geo.latitude, p.geo.elevation ?? 0] },
            properties: { siteName: p.geo?.siteName ?? '' },
          }
        : undefined)

  // A per-site dataset is named for its site, so N datasets from one study stay
  // distinguishable in the library and on disk.
  const clean = (v: string) => v.replace(/[^\w.\- ]+/g, '').trim()
  const studyName = clean(p.dataSetName || `${source}-${p.studyId}`)
  const siteSuffix = single?.siteName ? ` - ${clean(single.siteName)}` : ''
  const dataSetName = `${studyName}${siteSuffix}`
  const metadata: LipdMetadata = {
    lipdVersion: 1.3,
    createdBy: `lipd.net playground (${source} import via PyleoTUPS)`,
    dataSetName,
    datasetVersion: '1.0.0',
    // Prefer the synonyms map (e.g. "Marine" → MarineSediment); fall back to the
    // NOAA data-type map (e.g. PALEOCEANOGRAPHY → MarineSediment).
    archiveType: normalizeArchiveType(p.archiveType) ?? (p.archiveType ? ARCHIVE_MAP[p.archiveType.toUpperCase()] : undefined),
    investigators: p.investigators ?? undefined,
    originalDataUrl: p.originalDataUrl ?? undefined,
    // NOAAStudyId identifies an NCEI study; don't stamp it on PANGAEA imports
    // (p.studyId is a PANGAEA id there) — it drives the NOAA source-text view.
    ...(source === 'NOAA' ? { NOAAStudyId: p.studyId } : {}),
    // Study-level metadata NOAA carries but PyleoTUPS drops. notes → the NOAA
    // "Description_Notes_and_Keywords" the exporter round-trips; funding + the
    // dataset DOI feed the existing MetadataPanel editors and NOAA validation.
    ...(p.studyNotes ? { notes: p.studyNotes } : {}),
    ...(p.funding?.length ? { funding: p.funding } : {}),
    ...(p.datasetDOI ? { datasetDOI: p.datasetDOI } : {}),
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
    ...(chronData.length ? { chronData } : {}),
  }

  return {
    lipd: { metadata, filename: `${dataSetName || 'noaa-import'}.lpd`, csvData: {} },
    skippedFiles: p.skippedFiles ?? [],
    metadataOnly,
  }
}

// Fetch a study's parsed payload from the PyleoTUPS service. Null when the
// service isn't configured or is down, so the caller can fall back to the
// browser parser. Kept separate from the build step because a multi-site study
// asks the user how to split it, and the fetch is far too slow to repeat.
export async function noaaPayloadViaService(studyId: string): Promise<ServicePayload | null> {
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
    return await res.json() as ServicePayload
  } catch {
    return null
  }
}

/** Build one dataset from a payload, collapsing every site into it. */
export function buildCollapsed(p: ServicePayload, source: 'NOAA' | 'PANGAEA' = 'NOAA'): NoaaImportResult {
  return serviceToLipd(p, source, { mode: 'collapse' })
}

/** Build one dataset per site, in the order the service reported them. */
export function buildPerSite(p: ServicePayload, source: 'NOAA' | 'PANGAEA' = 'NOAA'): NoaaImportResult[] {
  return payloadSites(p).map(site => serviceToLipd(p, source, { mode: 'single', siteKey: site.key }))
}

// Try the PyleoTUPS service for a study id; null if it's not configured/down.
// Collapses a multi-site study into one dataset -- callers that want to offer
// the per-site choice use noaaPayloadViaService + buildPerSite instead.
export async function noaaStudyViaService(studyId: string): Promise<NoaaImportResult | null> {
  const p = await noaaPayloadViaService(studyId)
  if (!p) return null
  try {
    return buildCollapsed(p)
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

// A PANGAEA id can be a collection with no data of its own; the service then
// returns its member datasets to choose from (unless expand merges them).
export type PangaeaImportResult =
  | ServiceParseResult
  | { status: 'collection'; id: string; name?: string; members: PangaeaHit[] }

export async function pangaeaImport(id: string, expand = false): Promise<PangaeaImportResult> {
  let res: Response
  try {
    res = await fetch(`/api/pangaea/${id}${expand ? '?expand=1' : ''}`)
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
    if (payload.collection && payload.members?.length) {
      return {
        status: 'collection',
        id: payload.studyId,
        name: payload.dataSetName ?? undefined,
        members: payload.members.map(m => ({ id: m.id, name: m.name ?? `PANGAEA ${m.id}` })),
      }
    }
    if (payload.metadataOnly || !payload.tables.length) {
      return { status: 'error', message: 'No importable data table found in this PANGAEA dataset.' }
    }
    return { status: 'ok', result: serviceToLipd(payload, 'PANGAEA') }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Bad service response' }
  }
}
