// Generate src/lib/synonyms.varnames.generated.ts from the LiPD standardization
// sheet exports in scripts/synonym-sheets/*.csv. Run: node scripts/generate-synonyms.mjs
//
// To refresh: in Google Drive open the "paleoData_variableName" sheet, File →
// Download → CSV, save it as scripts/synonym-sheets/paleoData_variableName.csv,
// then run this script and commit the regenerated .ts.
//
// Cleaning rules (see below): drop deleteMe/needsToBeChanged/NA/missing/blank
// targets, merge-artifact synonyms ("((( … )))", "… /// …"), assemblage taxa
// rows (isAssemblage=TRUE), exact identity rows, and an explicit blocklist of
// known-bad mappings. Conflicting keys keep the first occurrence.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SHEETS = join(here, 'synonym-sheets')
const OUT = join(here, '..', 'src', 'lib', 'synonyms.varnames.generated.ts')

// Minimal RFC-4180 CSV parser (handles quoted fields with commas/quotes).
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* ignore */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const SKIP_TARGET = new Set(['', 'deletme', 'deleteme', 'needstobechanged', 'na', 'missing'])
const norm = s => s.toLowerCase().trim().replace(/\s+/g, ' ')

// Known-bad synonym→target pairs to drop (semantic errors in the source sheet).
// Key is `${normalizedSynonym}=>${target}`.
const BLOCKLIST = new Set([
  // (none for variableName yet — add as discovered)
])

function buildVariableNamePairs() {
  const csv = readFileSync(join(SHEETS, 'paleoData_variableName.csv'), 'utf8')
  const rows = parseCsv(csv)
  const header = rows[0].map(h => h.trim())
  const iLipd = header.indexOf('lipdName')
  const iSyn = header.indexOf('synonym')
  const iAssemblage = header.indexOf('paleoData_isAssemblage')
  if (iLipd < 0 || iSyn < 0) throw new Error('variableName CSV missing lipdName/synonym columns')

  const seen = new Map()   // normalizedKey -> lipdName (first wins)
  let conflicts = 0, dropped = 0
  const pairs = []
  for (const r of rows.slice(1)) {
    const lipd = (r[iLipd] ?? '').trim()
    const syn = (r[iSyn] ?? '').trim()
    const assemblage = (r[iAssemblage] ?? '').trim().toUpperCase() === 'TRUE'
    if (!lipd || !syn) { dropped++; continue }
    if (SKIP_TARGET.has(norm(lipd))) { dropped++; continue }
    if (assemblage) { dropped++; continue }              // taxa, not a general variableName mapping
    if (syn.includes('(((') || syn.includes('///')) { dropped++; continue }  // merge artifacts
    if (syn === lipd) { dropped++; continue }            // exact identity — no normalization needed
    const key = norm(syn)
    if (BLOCKLIST.has(`${key}=>${lipd}`)) { dropped++; continue }
    if (seen.has(key)) { if (seen.get(key) !== lipd) conflicts++; continue }
    seen.set(key, lipd)
    pairs.push([syn, lipd])
  }
  return { pairs, conflicts, dropped }
}

const { pairs, conflicts, dropped } = buildVariableNamePairs()
pairs.sort((a, b) => a[0].localeCompare(b[0]))

const body = pairs.map(([syn, lipd]) => `  [${JSON.stringify(syn)}, ${JSON.stringify(lipd)}],`).join('\n')
const out = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/generate-synonyms.mjs from
// scripts/synonym-sheets/paleoData_variableName.csv.
// Each entry maps an observed raw variableName synonym → its canonical LiPD
// variableName. ${pairs.length} entries.

export const VARIABLE_NAME_SYNONYMS: ReadonlyArray<readonly [string, string]> = [
${body}
]
`
writeFileSync(OUT, out)
console.log(`Wrote ${pairs.length} variableName synonyms to ${OUT}`)
console.log(`(dropped ${dropped} rows, ${conflicts} key conflicts kept-first)`)
