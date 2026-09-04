// Query the LiPDverse GraphDB SPARQL endpoint for datasets. This replaces the
// legacy /query flow (Node → PythonAnywhere → wiki.linked.earth, all defunct).
// The endpoint sends CORS headers, so the browser queries it directly.

const ENDPOINT = 'https://linkedearth.graphdb.mint.isi.edu/repositories/LiPDVerse-dynamic'
const LE = 'http://linked.earth/ontology#'
const ARCHIVE_NS = 'http://linked.earth/ontology/archive#'

export interface QueryFilters {
  name?: string
  archiveTypes?: string[] // ontology local names, e.g. "LakeSediment"
  variableName?: string
  latMin?: number; latMax?: number
  lonMin?: number; lonMax?: number
  elevMin?: number; elevMax?: number
  yearMin?: number; yearMax?: number // years CE
  limit?: number
}

export interface DatasetResult {
  name: string
  archiveType?: string
  siteName?: string
  lat?: number
  lon?: number
  lipdverseLink?: string
  downloadUrl?: string
  minYear?: number
  maxYear?: number
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export function buildDatasetQuery(f: QueryFilters): string {
  const parts: string[] = [
    `?ds a le:Dataset ; le:hasName ?name .`,
    `OPTIONAL { ?ds le:hasArchiveType ?archive }`,
    `OPTIONAL { ?ds le:lipdverseLink ?link }`,
    `OPTIONAL { ?ds le:minYear ?minYear }`,
    `OPTIONAL { ?ds le:maxYear ?maxYear }`,
    `OPTIONAL { ?ds le:hasLocation ?loc .
       OPTIONAL { ?loc wgs84:lat|le:hasLatitude ?lat }
       OPTIONAL { ?loc wgs84:long|le:hasLongitude ?lon }
       OPTIONAL { ?loc wgs84:alt|le:hasElevation ?elev }
       OPTIONAL { ?loc le:hasSiteName ?siteName } }`,
  ]

  if (f.name?.trim()) {
    parts.push(`FILTER(CONTAINS(LCASE(?name), "${esc(f.name.trim().toLowerCase())}"))`)
  }
  if (f.archiveTypes?.length) {
    const values = f.archiveTypes.map(a => `<${ARCHIVE_NS}${a}>`).join(' ')
    parts.push(`VALUES ?archive { ${values} }`)
  }
  if (f.variableName?.trim()) {
    parts.push(
      `?ds le:hasPaleoData/le:hasMeasurementTable/le:hasVariable ?v .`,
      `?v le:hasName ?vn .`,
      `FILTER(CONTAINS(LCASE(?vn), "${esc(f.variableName.trim().toLowerCase())}"))`
    )
  }
  const numFilter = (variable: string, min?: number, max?: number) => {
    if (min !== undefined) parts.push(`FILTER(xsd:decimal(?${variable}) >= ${min})`)
    if (max !== undefined) parts.push(`FILTER(xsd:decimal(?${variable}) <= ${max})`)
  }
  numFilter('lat', f.latMin, f.latMax)
  numFilter('lon', f.lonMin, f.lonMax)
  numFilter('elev', f.elevMin, f.elevMax)
  // Year range: dataset's [minYear, maxYear] must overlap the requested range
  if (f.yearMin !== undefined) parts.push(`FILTER(xsd:decimal(?maxYear) >= ${f.yearMin})`)
  if (f.yearMax !== undefined) parts.push(`FILTER(xsd:decimal(?minYear) <= ${f.yearMax})`)

  return `PREFIX le: <${LE}>
PREFIX wgs84: <http://www.w3.org/2003/01/geo/wgs84_pos#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?name ?archive ?siteName ?lat ?lon ?link ?minYear ?maxYear WHERE {
  ${parts.join('\n  ')}
}
ORDER BY ?name
LIMIT ${f.limit ?? 200}`
}

interface SparqlBinding {
  [key: string]: { value: string } | undefined
}

export async function queryDatasets(f: QueryFilters): Promise<DatasetResult[]> {
  const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(buildDatasetQuery(f))}`, {
    headers: { Accept: 'application/sparql-results+json' },
  })
  if (!res.ok) throw new Error(`SPARQL query failed (HTTP ${res.status})`)
  const json = await res.json()
  const bindings: SparqlBinding[] = json.results?.bindings ?? []

  // DISTINCT can still yield one row per (site, variable) combination — dedupe by name
  const byName = new Map<string, DatasetResult>()
  for (const b of bindings) {
    const name = b.name?.value
    if (!name || byName.has(name)) continue
    const num = (k: string) => {
      const v = b[k]?.value
      const n = v !== undefined ? Number(v) : NaN
      return isNaN(n) ? undefined : n
    }
    const link = b.link?.value
    // Two lipdverseLink shapes exist: ".../data/<id>/<ver>" (a directory) and
    // ".../<compilation>/<ver>/<name>.html" (a page next to the .lpd)
    const downloadUrl = link
      ? /\.html$/i.test(link)
        ? link.replace(/\.html$/i, '.lpd')
        : `${link.replace(/\/$/, '')}/${encodeURIComponent(name)}.lpd`
      : undefined
    byName.set(name, {
      name,
      archiveType: b.archive?.value?.split('#').pop(),
      siteName: b.siteName?.value,
      lat: num('lat'),
      lon: num('lon'),
      lipdverseLink: link,
      downloadUrl,
      minYear: num('minYear'),
      maxYear: num('maxYear'),
    })
  }
  return [...byName.values()]
}
