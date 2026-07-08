// Regenerates src/lib/vocabulary.ts from the lipdjs controlled vocabulary
// (which is itself synced with lipdverse). Run after upgrading lipdjs:
//   node scripts/generate-vocabulary.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  ArchiveTypeConstants,
  InterpretationVariableConstants,
  InterpretationSeasonalityConstants,
  PaleoProxyConstants,
  PaleoProxyGeneralConstants,
  PaleoUnitConstants,
  PaleoVariableConstants,
} from 'lipdjs'

const labels = cls =>
  [...new Set(Object.values(cls).map(v => v && v.label).filter(Boolean))].sort()

// Archive types appear in the wild both as ontology labels ("Lake sediment")
// and as legacy compact forms ("LakeSediment") — accept both.
const archiveLabels = labels(ArchiveTypeConstants)
const camel = l => l.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join('')
const archiveTypes = [...new Set([...archiveLabels, ...archiveLabels.map(camel)])].sort()

const list = arr => JSON.stringify(arr)

const out = `// AUTO-GENERATED from lipdjs — do not edit by hand.
// Regenerate with: node scripts/generate-vocabulary.mjs

export const ARCHIVE_TYPES = ${list(archiveTypes)}

export const INTERP_VARIABLES = ${list(labels(InterpretationVariableConstants))}

export const SEASONALITY = ${list(labels(InterpretationSeasonalityConstants))}

export const PROXY_TYPES = ${list(labels(PaleoProxyConstants))}

export const PROXY_GENERAL = ${list(labels(PaleoProxyGeneralConstants))}

export const UNITS = ${list(labels(PaleoUnitConstants))}

export const VARIABLE_NAMES = ${list(labels(PaleoVariableConstants))}
`

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'vocabulary.ts')
writeFileSync(dest, out)
console.log(`Wrote ${dest}`)
