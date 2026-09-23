// Regression test: import each PyleoTUPS-tutorial example dataset through the
// running noaa-service and check it against the tutorial's stated expectation.
// Run the service first (uvicorn app:app --port 8000), then:  node test_tutorial_examples.mjs
//
// Example IDs + expectations are from the PyleoTUPS tutorials
// (https://linked.earth/pyleotupsTutorials/). Search-result counts there are
// live-data dependent, so this only fetches concrete studies by ID.

const BASE = process.env.NOAA_SERVICE_URL || 'http://localhost:8000'

const results = []
const rec = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`) }

async function get(path, timeoutMs = 120000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal })
    const body = await res.json().catch(() => null)
    return { status: res.status, body }
  } catch (e) {
    return { status: 0, body: null, error: String(e) }
  } finally { clearTimeout(t) }
}

const colNames = (payload) => (payload?.tables ?? []).flatMap(t => (t.columns ?? []).map(c => c.variableName))

// ---- NOAA ----
async function noaa(id, check) {
  const { status, body, error } = await get(`/noaa/${id}`)
  if (status !== 200 || !body) { rec(`NOAA ${id}`, false, error || `HTTP ${status}`); return }
  check(body)
}

await noaa(13156, b => rec('NOAA 13156 imports (metadata-only expected)', true,
  `${b.tables?.length ?? 0} tables, metadataOnly=${b.metadataOnly}`))

await noaa(33213, b => {
  const names = colNames(b)
  rec('NOAA 33213 → 8 tables w/ TEX86H+SST', b.tables?.length === 8 && names.some(n => /TEX86/i.test(n)) && names.some(n => /SST|temperature/i.test(n)),
    `${b.tables?.length} tables; cols e.g. ${names.slice(0, 4).join(', ')}`)
})

await noaa(27490, b => {
  const names = colNames(b)
  rec('NOAA 27490 coral: age + d18O', /coral/i.test(b.archiveType ?? '') && names.some(n => /age|year/i.test(n)) && names.some(n => /d18O/i.test(n)),
    `archive=${b.archiveType}; cols ${names.join(', ')}`)
})

// Multi-site study (issue #14): the payload must report every site and tag each
// table with the one it belongs to, so the client can split or collapse it.
await noaa(10420, b => {
  const sites = b.sites ?? []
  const tables = b.tables ?? []
  const keys = new Set(sites.map(s => s.key))
  const tagged = tables.every(t => t.siteKey && keys.has(t.siteKey))
  const located = sites.every(s => s.latitude != null && s.longitude != null)
  const spread = new Set(tables.map(t => t.siteKey)).size
  rec('NOAA 10420 → 7 sites, every table tagged with its own',
    sites.length === 7 && tables.length === 13 && tagged && located && spread === 7,
    `sites=${sites.length} tables=${tables.length} tagged=${tagged} located=${located} distinct=${spread}`)
})

// A single-site study still reports exactly one site, so the client never
// prompts for a split it doesn't need.
await noaa(2429, b => {
  const sites = b.sites ?? []
  rec('NOAA 2429 → exactly one site (no split prompt)',
    sites.length === 1 && sites[0]?.siteName != null && (b.tables ?? []).every(t => t.siteKey === sites[0].key),
    `sites=${sites.length} name=${sites[0]?.siteName}`)
})

await noaa(36778, b => rec('NOAA 36778 imports', b.studyId != null, `${b.tables?.length ?? 0} tables`))

// Legacy WDC file PyleoTUPS returns nothing for; our fallback parser recovers it
// (column names come from the file's "Column N:" legend).
await noaa(2493, b => {
  const t0 = b.tables?.[0]
  const names = colNames(b)
  rec('NOAA 2493 → fallback recovers GICC05 (was metadata-only)',
    !b.metadataOnly && t0?.parser === 'fallback' && (t0?.columns?.length ?? 0) === 6
      && (t0?.columns?.[0]?.values?.length ?? 0) > 1000 && names.some(n => /d18O|NGRIP/i.test(n)),
    `metadataOnly=${b.metadataOnly}, parser=${t0?.parser}, cols=${t0?.columns?.length}, rows=${t0?.columns?.[0]?.values?.length}`)
})

// 5982 (The Sahara in the Holocene): a plain tab-delimited spreadsheet with a
// header row and mostly TEXT columns. The numeric-block strategy finds nothing
// here (5 of 7 columns are words), so it used to import as metadata-only even
// though the file is perfectly machine-readable. The delimited-table strategy
// recovers it, text columns survive instead of being coerced to null, and the
// Latin-1 degree signs in Coordinates decode rather than becoming U+FFFD.
await noaa(5982, b => {
  const t = (b.tables ?? [])[0]
  const names = (t?.columns ?? []).map(c => c.variableName)
  const rows = t ? Math.max(...t.columns.map(c => (c.values ?? []).length)) : 0
  const col = n => (t?.columns ?? []).find(c => c.variableName === n)
  const dates = col('DateBP')?.values ?? []
  const places = col('Location')?.values ?? []
  const coords = col('Coordinates')?.values ?? []
  rec('NOAA 5982 \u2192 tab-delimited table with text columns recovered',
    !b.metadataOnly && names.length === 7 && names[0] === 'DateBP' && rows > 2000
      && typeof dates[0] === 'number'
      && typeof places[0] === 'string' && places.filter(v => v !== null).length > 2000
      && typeof coords[0] === 'string' && !coords[0].includes('\uFFFD'),
    `metadataOnly=${b.metadataOnly}, cols=${names.length}, rows=${rows}, ` +
    `date=${typeof dates[0]}, place=${typeof places[0]}, coords=${JSON.stringify(coords[0])}`)
})

// 11179 (Baffin Island 14C): a column-aligned table with a real header whose
// labels contain spaces ("Field ID", "Bulk/Filament"). Whitespace splitting
// gives the header one more field than the data, so it has to be parsed by
// character position. Also the regression guard for duplicate tables: NOAA
// lists the .txt and .xls under ONE DataTableID, and PyleoTUPS returns the same
// frame for both, which used to be emitted twice.
await noaa(11179, b => {
  const names = ((b.tables ?? [])[0]?.columns ?? []).map(c => c.variableName)
  rec('NOAA 11179 \u2192 fixed-width table, header read by column position, no duplicate',
    (b.tables ?? []).length === 1 && names.length === 8
      && names[0] === 'Field ID' && names.includes('Bulk/Filament'),
    `tables=${(b.tables ?? []).length}, cols=${JSON.stringify(names)}`)
})

// 11921 (Alaska Palaeo-Glacier Atlas): column-aligned with no header line, and
// cells that contain spaces ("22.4 \u00b1 0.6", "Northeast Alaska Range"). Splitting
// on whitespace would shred both; the columns come out generic and flagged for
// review, which is the honest outcome.
await noaa(11921, b => {
  const t = (b.tables ?? [])[0]
  const vals = (t?.columns ?? []).map(c => (c.values ?? [])[0])
  rec('NOAA 11921 \u2192 fixed-width keeps cells that contain spaces',
    !b.metadataOnly && (t?.columns ?? []).length === 7 && t?.review === true
      && vals.some(v => typeof v === 'string' && v.includes('\u00b1'))
      && vals.some(v => typeof v === 'string' && v.split(' ').length >= 3),
    `cols=${(t?.columns ?? []).length}, review=${t?.review}, row0=${JSON.stringify(vals)}`)
})

// 2429 (Camp Century, our example study): fallback names its 2-column d18O
// tables from PyleoTUPS' variable metadata (not Var1/Var2), with units.
await noaa(2429, b => {
  const clean = (b.tables ?? []).filter(t => (t.columns ?? []).length === 2)
  const named = clean.length >= 2 && clean.every(t => t.columns.every(c => !/^Var\d+$/.test(c.variableName)))
  const withUnits = clean.some(t => t.columns.some(c => c.units))
  const allNames = (b.tables ?? []).flatMap(t => (t.columns ?? []).map(c => c.variableName))
  rec('NOAA 2429 → fallback names columns from variable metadata',
    !b.metadataOnly && (b.tables?.length ?? 0) === 3 && named && withUnits && allNames.some(n => /d18O|delta 18O/i.test(n)),
    `tables=${b.tables?.length}, cleanNamed=${named}, units=${withUnits}`)
})

// Geo site-point (not the coverage-box SW corner). 15076 (AICC2012) is a
// multi-core compilation whose coverage box spans Antarctica→Greenland; the geo
// must resolve to a real site (first site = Vostok ~-78.47, 106.8°E), NOT the
// box's SW corner (~-78.47, -42.32°W, out in the South Atlantic).
await noaa(15076, b => {
  const { latitude: lat, longitude: lon } = b.geo ?? {}
  rec('NOAA 15076 geo = real site point (Vostok), not box SW corner',
    Math.abs(lat - -78.47) < 0.1 && Math.abs(lon - 106.8) < 0.1,
    `geo=${lat},${lon}`)
})

// Point studies: geo unchanged (per-site Min==Max == the coverage box).
await noaa(2429, b => rec('NOAA 2429 geo unchanged for point study (Camp Century)',
  Math.abs((b.geo?.latitude ?? 0) - 77.17) < 0.01 && Math.abs((b.geo?.longitude ?? 0) - -61.13) < 0.01,
  `geo=${b.geo?.latitude},${b.geo?.longitude}`))

// Study-level metadata PyleoTUPS drops: funding, abstract (studyNotes), and the
// dataset landing-page DOI (fetched from the NCEI search record).
await noaa(33213, b => {
  const f = b.funding ?? []
  rec('NOAA 33213 captures funding + dataset DOI + notes',
    f.length === 4 && f.every(x => x.agency && x.grant)
      && /10\.25921\/mzh5-p372/.test(b.datasetDOI ?? '') && (b.studyNotes ?? '').length > 10,
    `funding=${f.length}, doi=${b.datasetDOI}, notes=${(b.studyNotes ?? '').length}ch`)
})
await noaa(2429, b => rec('NOAA 2429 captures DOI + abstract, empty funding ok',
  /10\.25921\/0537-2h54/.test(b.datasetDOI ?? '') && /CRREL|Camp Century/i.test(b.studyNotes ?? '') && Array.isArray(b.funding) && b.funding.length === 0,
  `doi=${b.datasetDOI}, funding=${(b.funding ?? []).length}, notes=${(b.studyNotes ?? '').length}ch`))

// Seasonality: cvSeasonality is hierarchical ("non-calendric period>summer");
// the service returns just the leaf ("summer") for the client to put in an
// interpretation block. 5466 (Baffin Island summer temperature) has one.
await noaa(5466, b => {
  const seas = (b.tables ?? []).flatMap(t => (t.columns ?? []))
    .map(c => c.seasonality).filter(Boolean)
  rec('NOAA 5466 seasonality returned as bare leaf (no ">")',
    seas.length >= 1 && seas.every(s => !s.includes('>')) && seas.includes('summer'),
    `seasonality=${JSON.stringify(seas)}`)
})

// ---- PANGAEA ----
async function pangaea(id, check, timeout = 120000) {
  const { status, body, error } = await get(`/pangaea/${id}`, timeout)
  if (status !== 200 || !body) { rec(`PANGAEA ${id}`, false, error || `HTTP ${status}${body?.detail ? ': ' + body.detail : ''}`); return }
  check(body)
}

await pangaea(965772, b => rec('PANGAEA 965772 imports (single table)', (b.tables?.length ?? 0) >= 1,
  `${b.tables?.length ?? 0} tables; cols ${colNames(b).slice(0, 4).join(', ')}`))

await pangaea(830587, b => rec('PANGAEA 830587 imports (radiocarbon table)', (b.tables?.length ?? 0) >= 1 || b.metadataOnly != null,
  `${b.tables?.length ?? 0} tables`))

await pangaea(868935, b => rec('PANGAEA 868935 imports', b.studyId != null, `${b.tables?.length ?? 0} tables`))

// Collections — return a member pick-list by default; ?expand merges members.
await pangaea(830589, b => rec('PANGAEA 830589 → collection of 3 members', b.collection === true && b.members?.length === 3,
  `collection=${b.collection} members=${b.members?.length}`))
{
  const { status, body } = await get('/pangaea/830589?expand=true', 200000)
  rec('PANGAEA 830589 expand → merged 3 tables', status === 200 && body?.tables?.length === 3 && !body.metadataOnly,
    `tables=${body?.tables?.length}`)
}
await pangaea(971943, b => rec('PANGAEA 971943 → collection of 48 members', b.collection === true && (b.members?.length ?? 0) >= 40,
  `collection=${b.collection} members=${b.members?.length}`), 180000)

// ---- report ----
const fails = results.filter(r => !r.ok)
console.log(`\n${results.length - fails.length}/${results.length} pass`)
process.exit(fails.length ? 1 : 0)
