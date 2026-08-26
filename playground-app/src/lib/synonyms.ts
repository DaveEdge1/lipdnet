// Synonym → canonical LiPD term maps, curated from the LiPD standardization
// sheets (Google Drive "LiPD synonyms" folder: archiveType, paleoData_units,
// paleoData_proxy). Used to normalize imported NOAA/PANGAEA metadata onto the
// LiPD controlled vocabulary. Rows marked deleteMe / needsToBeChanged / NA,
// merge-artifact synonyms ("((( … )))"), and unit-conversion errors (e.g.
// kelvin→degC) were dropped during curation.
//
// NOTE: the large paleoData_variableName sheet is intentionally NOT embedded
// here yet — it needs a generator script that cleans it (tracked in
// docs/playground-todo.md, workstream C follow-up).

import { VARIABLE_NAME_SYNONYMS } from './synonyms.varnames.generated'

// Normalize a lookup key: lowercase, trim, collapse internal whitespace.
const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')

function buildMap(pairs: Array<[string, string]>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [syn, canonical] of pairs) m.set(norm(syn), canonical)
  return m
}

// ---- archiveType ----------------------------------------------------------
const ARCHIVE_PAIRS: Array<[string, string]> = [
  ['Borehole', 'Borehole'],
  ['Coral', 'Coral'],
  ['Documents', 'Documents'],
  ['Creek', 'FluvialSediment'], ['Fluvial', 'FluvialSediment'], ['FluvialSediment', 'FluvialSediment'],
  ['River', 'FluvialSediment'], ['Stream', 'FluvialSediment'],
  ['GlacierIce', 'GlacierIce'], ['glacier ice', 'GlacierIce'], ['ice core', 'GlacierIce'], ['ice cores', 'GlacierIce'],
  ['GroundIce', 'GroundIce'],
  ['Lagoon', 'LakeSediment'], ['Lake', 'LakeSediment'], ['Lake Sediment', 'LakeSediment'], ['LakeSediment', 'LakeSediment'],
  ['Marine', 'MarineSediment'], ['MarineSediment', 'MarineSediment'], ['Delta', 'MarineSediment'],
  ['Marine Sediment', 'MarineSediment'], ['Ocean', 'MarineSediment'],
  ['Midden', 'Midden'],
  ['MolluskShells', 'MolluskShell'], ['MolluskShell', 'MolluskShell'], ['bivalve', 'MolluskShell'],
  ['Marl', 'Other'], ['Meadow', 'Other'], ['Archaeological', 'Other'], ['Coast', 'Other'],
  ['Farmland', 'Other'], ['Forest', 'Other'], ['Spring', 'Other'], ['Hybrid', 'Other'], ['Valley', 'Other'],
  ['Wetland', 'Peat'], ['Bog', 'Peat'], ['Fen', 'Peat'], ['Marsh', 'Peat'], ['Mire', 'Peat'], ['Peat', 'Peat'], ['Swamp', 'Peat'],
  ['Sclerosponge', 'Sclerosponge'],
  ['LakeDeposit', 'Shoreline'], ['LakeDeposits', 'Shoreline'], ['Shoreline', 'Shoreline'], ['lake levels', 'Shoreline'],
  ['Cave', 'Speleothem'], ['Speleothem', 'Speleothem'], ['speleothems', 'Speleothem'],
  ['Paleosol', 'TerrestrialSediment'], ['Dune', 'TerrestrialSediment'], ['Loess', 'TerrestrialSediment'],
  ['TerrestrialSediment', 'TerrestrialSediment'], ['Terrestrial Sediment', 'TerrestrialSediment'],
  ['Wood', 'Wood'], ['tree ring', 'Wood'], ['tree', 'Wood'], ['tree rings', 'Wood'],
]
const ARCHIVE_MAP = buildMap(ARCHIVE_PAIRS)

// ---- units ----------------------------------------------------------------
const UNIT_PAIRS: Array<[string, string]> = [
  ['cm', 'cm'], ['cmblf', 'cm'],
  ['uS/cm', 'uS/cm'],
  ['deg C', 'degC'], ['degC', 'degC'], ['Deg', 'degC'], ['degrees', 'degC'], ['ºC', 'degC'], ['°C', 'degC'],
  ['%', 'percent'], ['percent', 'percent'], ['% abs', 'percent'], ['mol%', 'percent'],
  ['wt %', 'percent'], ['Precent', 'percent'], ['percentByWeight', 'percent'],
  ['per mil', 'permil'], ['permil', 'permil'], ['pemil', 'permil'], ['permit', 'permil'], ['perml', 'permil'],
  ['‰ PDB', 'permil'], ['‰ SMOW', 'permil'], ['PDB', 'permil'], ['per mil (PDB)', 'permil'],
  ['per mil (VPDB)', 'permil'], ['per mil vs PDB', 'permil'], ['per mil vs VPDB', 'permil'],
  ['per mil VSMOW', 'permil'], ['permil (PDB)', 'permil'], ['permil (SMOW)', 'permil'],
  ['permil (VPDB)', 'permil'], ['permil (VSMOW)', 'permil'], ['permil PDB', 'permil'],
  ['permil SMOW', 'permil'], ['permil VPDB', 'permil'], ['permil VSMOW', 'permil'],
  ['permil vs PDB', 'permil'], ['permil vs VPDB', 'permil'],
  ['ratio', 'ratio'], ['cps/cps', 'ratio'], ['g/g', 'ratio'], ['mol/mol', 'ratio'], ['mol_mol', 'ratio'], ['mm/m', 'ratio'],
  ['BP', 'yr BP'], ['cal years BP', 'yr BP'], ['cal year BP', 'yr BP'], ['cal yr BP', 'yr BP'],
  ['cal yrs BP', 'yr BP'], ['cal yr B.P.', 'yr BP'], ['Calibrated', 'yr BP'], ['yr BP', 'yr BP'],
  ['year BP', 'yr BP'], ['years BP', 'yr BP'], ['yr B.P.', 'yr BP'], ['cal age BP', 'yr BP'],
  ['cal bp', 'yr BP'], ['yrs bp', 'yr BP'],
  ['AD', 'yr AD'], ['CE', 'yr AD'], ['yr AD', 'yr AD'], ['yr', 'yr AD'], ['year CE', 'yr AD'],
  ['year ce', 'yr AD'], ['year C.E.', 'yr AD'], ['year A.D.', 'yr AD'], ['yr ce', 'yr AD'],
  ['14C yr BP', 'yr 14C BP'], ['yr 14C BP', 'yr 14C BP'], ['radiocarbon years BP', 'yr 14C BP'],
  ['bp14C', 'yr 14C BP'], ['C14yr BP', 'yr 14C BP'],
  ['ka', 'yr ka'], ['ka BP', 'yr ka'],
  ['b2000', 'yr b2k'], ['cal. BP2000', 'yr b2k'], ['Years before 2k', 'yr b2k'],
  ['mm', 'mm'], ['mm/a', 'mm/yr'], ['mm/yr', 'mm/yr'], ['mm/day', 'mm/day'], ['mm/season', 'mm/season'],
  ['m', 'm'], ['masl', 'm'], ['mcd', 'm'],
  ['ppb', 'ppb'], ['ppm', 'ppm'],
  ['psu', 'practical salinity unit'],
  ['pH', 'pH'],
  ['SI', 'SI'], ['si', 'SI'],
  ['unitless', 'unitless'], ['dimensionless', 'unitless'], ['index', 'unitless'],
  ['unitless index', 'unitless'], ['standardized', 'unitless'], ['normalized anomaly', 'unitless'],
  ['count', 'count'], ['counts', 'count'], ['cts', 'count'], ['number', 'count'], ['no', 'count'],
  ['cps', 'cps'],
  ['SD', 'z score'], ['sd', 'z score'], ['std dev', 'z score'], ['zscore', 'z score'], ['SD units', 'z score'],
  ['mmol/mol', 'mmol/mol'], ['umol/mol', 'umol/mol'],
  ['ug/g', 'ug/g'], ['ug/g dry sed', 'ug/g'], ['ug/g dry sediment', 'ug/g'],
  ['mg/g', 'mg/g'], ['mg/kg', 'mg/kg'], ['mg/L', 'mg/L'], ['g/L', 'g/L'],
  ['grayscale', 'grayscale'],
  ['day', 'day'], ['days', 'day'], ['year', 'year'], ['years', 'year'],
  ['fraction', 'fraction'], ['relative abundance', 'fraction'], ['fractional abundance', 'fraction'], ['fraction 0 to 1', 'fraction'],
  ['peak area', 'peak area'],
  ['lightness', 'lightness'], ['reflectance', 'lightness'],
  ['decimal degrees', 'degree'], ['degree', 'degree'],
  ['phi', 'phi'],
]
const UNIT_MAP = buildMap(UNIT_PAIRS)

// ---- proxy (and proxyGeneral derivation) ----------------------------------
// [synonym, canonical proxy, proxyGeneral]
const PROXY_ROWS: Array<[string, string, string]> = [
  ['10Be', '10Be', 'isotopic'],
  ['ACL', 'ACL', 'biomarker'],
  ['Al/Ca', 'Al/Ca', 'elemental'], ['Al/Si', 'Al/Si', 'elemental'], ['AlSi', 'Al/Si', 'elemental'],
  ['Al2O3', 'Al2O3', 'mineral'],
  ['alkenone', 'alkenone', 'biomarker'],
  ['amoeba', 'amoeba', 'faunal assemblage'],
  ['Ba/Al', 'Ba/Al', 'elemental'], ['BaCa', 'Ba/Ca', 'elemental'], ['Ba/Ca', 'Ba/Ca', 'elemental'], ['Ba/Sr', 'Ba/Sr', 'elemental'],
  ['BITindex', 'BIT', 'biomarker'],
  ['borehole', 'borehole', 'borehole'],
  ['BSi', 'BSi', 'biogenic'],
  ['bubble frequency', 'bubble frequency', 'cryophysical'],
  ['bulk density', 'bulk density', 'sedimentology'], ['gamma', 'bulk density', 'sedimentology'],
  ['bulk sediment', 'bulk sediment', 'sedimentology'], ['BulkSed', 'bulk sediment', 'sedimentology'],
  ['C/N', 'C/N', 'elemental'],
  ['Ca', 'Ca', 'elemental'], ['Ca/K', 'Ca/K', 'elemental'], ['Ca/Mg', 'Ca/Mg', 'elemental'], ['Ca/Ti', 'Ca/Ti', 'elemental'],
  ['CaCO3', 'CaCO3', 'mineral'],
  ['calcification', 'calcification rate', 'mineral'], ['calcification rate', 'calcification rate', 'mineral'],
  ['calcite', 'calcite', 'mineral'],
  ['authigenic carbonate', 'carbonate', 'mineral'], ['Carbonate content', 'carbonate', 'mineral'],
  ['CBT', 'CBT', 'biomarker'],
  ['cellulose', 'cellulose', 'biogenic'],
  ['charcoal', 'charcoal', 'pyrogenic'],
  ['chironomid', 'chironomid', 'faunal assemblage'], ['midge', 'chironomid', 'faunal assemblage'],
  ['chlorophyll', 'chlorophyll', 'biogenic'],
  ['chrysophyte', 'chrysophyte assemblage', 'floral assemblage'],
  ['Cladocera', 'cladoceran', 'faunal assemblage'],
  ['coccolith', 'coccolithophore', 'floral assemblage'],
  ['d13C', 'd13C', 'isotopic'], ['d13Cwax', 'd13C', 'isotopic'], ['delta 13C', 'd13C', 'isotopic'],
  ['d15N', 'd15N', 'isotopic'], ['delta 15N', 'd15N', 'isotopic'],
  ['cellulose d18O', 'd18O', 'isotopic'], ['d18O', 'd18O', 'isotopic'], ['delta18O', 'd18O', 'isotopic'], ['delta 18O', 'd18O', 'isotopic'], ['foram d18O', 'd18O', 'isotopic'],
  ['d2H', 'dD', 'isotopic'], ['dD', 'dD', 'isotopic'], ['dDwax', 'dD', 'isotopic'], ['delta D', 'dD', 'isotopic'], ['delta 2H', 'dD', 'isotopic'], ['leaf wax', 'dD', 'isotopic'], ['leafWax', 'dD', 'isotopic'],
  ['deterium excess', 'deuterium excess', 'isotopic'], ['dx', 'deuterium excess', 'isotopic'],
  ['diatom', 'diatom', 'floral assemblage'],
  ['dinocyst', 'dinocyst', 'faunal assemblage'],
  ['CaMg(CO3)2', 'dolomite', 'mineral'],
  ['DBD', 'dry bulk density', 'sedimentology'],
  ['Eu/Zr', 'Eu/Zr', 'elemental'],
  ['Fe', 'Fe', 'elemental'], ['Fe/Al', 'Fe/Al', 'elemental'], ['FeCa', 'Fe/Ca', 'elemental'], ['Fe/Ca', 'Fe/Ca', 'elemental'],
  ['Fe/K', 'Fe/K', 'elemental'], ['Fe/Mn', 'Fe/Mn', 'elemental'],
  ['foraminifer', 'foraminifera', 'faunal assemblage'], ['foraminifera', 'foraminifera', 'faunal assemblage'],
  ['planktonic foraminifera', 'foraminifera', 'faunal assemblage'],
  ['brGDGT', 'GDGT', 'biomarker'], ['GDGT', 'GDGT', 'biomarker'],
  ['particle size', 'grain size', 'sedimentology'],
  ['HBI', 'HBI', 'biomarker'],
  ['Documentary', 'historical', 'historical'], ['historic', 'historical', 'historical'],
  ['humification', 'humification', 'sedimentology'],
  ['ice accumulation', 'ice accumulation', 'cryophysical'],
  ['ice melt', 'ice melt', 'cryophysical'], ['melt', 'ice melt', 'cryophysical'], ['melt layer', 'ice melt', 'cryophysical'],
  ['TIC', 'inorganic carbon', 'mineral'],
  ['IP25', 'IP25', 'biomarker'],
  ['K/Al', 'K/Al', 'elemental'],
  ['lake level', 'lake level', 'stratigraphy'], ['lakeLevel', 'lake level', 'stratigraphy'], ['LakeStatus', 'lake level', 'stratigraphy'],
  ['late-wood cellulose', 'latewood cellulose', 'biogenic'], ['latewood cellulose', 'latewood cellulose', 'biogenic'],
  ['LDI', 'LDI', 'biomarker'], ['long chain diol', 'LDI', 'biomarker'],
  ['macrofossils', 'macrofossils', 'biogenic'],
  ['ARM/IRM', 'magnetic', 'sedimentology'], ['IRM', 'magnetic', 'sedimentology'],
  ['Magnetic Susceptibility', 'magnetic susceptibility', 'sedimentology'], ['MS', 'magnetic susceptibility', 'sedimentology'],
  ['MAR', 'mass accumulation rate', 'sedimentology'],
  ['delta Density', 'maximum latewood density', 'dendrophysical'], ['MXD', 'maximum latewood density', 'dendrophysical'],
  ['Mg', 'Mg', 'elemental'],
  ['foram Mg/Ca', 'Mg/Ca', 'elemental'], ['Mg/Ca', 'Mg/Ca', 'elemental'], ['MgCa', 'Mg/Ca', 'elemental'],
  ['MnFe', 'Mn/Fe', 'elemental'], ['MnTi', 'Mn/Ti', 'elemental'],
  ['hybrid', 'multiproxy', 'multiproxy'],
  ['n-alkane', 'n-alkane', 'biomarker'],
  ['neodymium', 'Nd', 'elemental'],
  ['ostracod', 'ostracod', 'faunal assemblage'],
  ['Paq', 'P-aqueous', 'biomarker'],
  ['peat ash', 'peat ash', 'mineral'],
  ['pH', 'pH', 'elemental'],
  ['aquatic palynomorphs', 'pollen', 'floral assemblage'], ['pollen', 'pollen', 'floral assemblage'],
  ['radiolaria', 'radiolaria', 'faunal assemblage'],
  ['Rb', 'Rb', 'elemental'], ['Rb/Sr', 'Rb/Sr', 'elemental'],
  ['reflectance', 'reflectance', 'reflectance'],
  ['TRW', 'ring width', 'dendrophysical'], ['Tree ring width', 'ring width', 'dendrophysical'],
  ['Tree-ring width', 'ring width', 'dendrophysical'], ['tree ring width', 'ring width', 'dendrophysical'],
  ['Tree ring', 'ring width', 'dendrophysical'],
  ['Sedimentation rate', 'sedimentation rate', 'sedimentology'],
  ['Sr', 'Sr', 'elemental'],
  ['Ca/Sr', 'Sr/Ca', 'elemental'], ['Coral Sr/Ca', 'Sr/Ca', 'elemental'], ['Sr/Ca', 'Sr/Ca', 'elemental'], ['SrCa', 'Sr/Ca', 'elemental'],
  ['Minerogenic layers', 'stratigraphy', 'stratigraphy'], ['stratigraphy', 'stratigraphy', 'stratigraphy'],
  ['S', 'sulfur', 'elemental'],
  ['TEX86', 'TEX86', 'biomarker'],
  ['Ti', 'Ti', 'elemental'], ['Ti/Al', 'Ti/Al', 'elemental'],
  ['ln(ti/ca)', 'Ti/Ca', 'elemental'], ['Ti/Ca', 'Ti/Ca', 'elemental'], ['TiCa', 'Ti/Ca', 'elemental'],
  ['LOI', 'TOC', 'biogenic'], ['TOC', 'TOC', 'biogenic'], ['organicCarbon', 'TOC', 'biogenic'],
  ['TN', 'total nitrogen', 'elemental'],
  ['varve', 'varve thickness', 'stratigraphy'], ['varve thickness', 'varve thickness', 'stratigraphy'], ['varves', 'varve thickness', 'stratigraphy'],
]
const PROXY_MAP = buildMap(PROXY_ROWS.map(([syn, proxy]) => [syn, proxy]))
const PROXY_GENERAL_BY_PROXY = buildMap(PROXY_ROWS.map(([, proxy, general]) => [proxy, general]))

// ---- variableName (generated; see scripts/generate-synonyms.mjs) ----------
const VARNAME_MAP = buildMap(VARIABLE_NAME_SYNONYMS.map(([syn, lipd]) => [syn, lipd]))

// ---- public API -----------------------------------------------------------

/** Map a raw archive string to a canonical LiPD archiveType, or undefined. */
export function normalizeArchiveType(raw?: string | null): string | undefined {
  if (!raw) return undefined
  return ARCHIVE_MAP.get(norm(raw))
}

/** Map a raw units string to canonical LiPD units, or undefined. */
export function normalizeUnits(raw?: string | null): string | undefined {
  if (!raw) return undefined
  return UNIT_MAP.get(norm(raw))
}

/** Map a raw proxy string to a canonical LiPD proxy, or undefined. */
export function normalizeProxy(raw?: string | null): string | undefined {
  if (!raw) return undefined
  return PROXY_MAP.get(norm(raw))
}

/** The proxyGeneral category for a canonical LiPD proxy (autogenerated). */
export function proxyGeneralFor(proxy?: string | null): string | undefined {
  if (!proxy) return undefined
  return PROXY_GENERAL_BY_PROXY.get(norm(proxy))
}

/** Map a raw variableName to its canonical LiPD variableName, or undefined. */
export function normalizeVariableName(raw?: string | null): string | undefined {
  if (!raw) return undefined
  return VARNAME_MAP.get(norm(raw))
}
