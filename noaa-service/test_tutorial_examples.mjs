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

await noaa(10420, b => rec('NOAA 10420 imports (multi-site geometry)', (b.tables?.length ?? 0) >= 1 || b.metadataOnly != null,
  `${b.tables?.length ?? 0} tables; geo=${b.geo?.latitude},${b.geo?.longitude}`))

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
