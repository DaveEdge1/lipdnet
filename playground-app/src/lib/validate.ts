import type { LipdMetadata } from '../types/lipd'
import { ARCHIVE_TYPES, INTERP_VARIABLES, SEASONALITY, PROXY_TYPES, PROXY_GENERAL, UNITS, VARIABLE_NAMES } from './vocabulary'

export type IssueSeverity = 'error' | 'warning'

export interface Issue {
  severity: IssueSeverity
  path: string
  message: string
}

export function validateLipd(metadata: LipdMetadata): Issue[] {
  const issues: Issue[] = []

  // Required root fields
  if (!metadata.dataSetName) issues.push({ severity: 'error', path: 'dataSetName', message: 'dataSetName is missing' })
  if (!metadata.archiveType) issues.push({ severity: 'error', path: 'archiveType', message: 'archiveType is missing' })
  if (!metadata.geo) issues.push({ severity: 'error', path: 'geo', message: 'geo is missing' })
  if (!metadata.datasetId) issues.push({ severity: 'warning', path: 'datasetId', message: 'datasetId is missing' })
  if (!metadata.paleoData?.length && !metadata.chronData?.length) {
    issues.push({ severity: 'error', path: 'paleoData', message: 'No paleoData or chronData present' })
  }

  // archiveType vocabulary (case/space-insensitive: "marine sediment" ≈ "MarineSediment")
  const normArchive = (s: string) => s.toLowerCase().replace(/ /g, '')
  if (metadata.archiveType && !ARCHIVE_TYPES.some(a => normArchive(a) === normArchive(metadata.archiveType!))) {
    issues.push({ severity: 'warning', path: 'archiveType', message: `"${metadata.archiveType}" is not in the standard archiveType vocabulary` })
  }

  // geo
  if (metadata.geo) {
    const coords = metadata.geo.geometry?.coordinates
    const lat = coords ? coords[1] : metadata.geo.latitude
    const lon = coords ? coords[0] : metadata.geo.longitude
    if (lat == null) issues.push({ severity: 'error', path: 'geo.latitude', message: 'Latitude is missing' })
    if (lon == null) issues.push({ severity: 'error', path: 'geo.longitude', message: 'Longitude is missing' })
    if (lat != null && (lat < -90 || lat > 90)) issues.push({ severity: 'error', path: 'geo.latitude', message: `Latitude ${lat} is out of range [-90, 90]` })
    if (lon != null && (lon < -180 || lon > 180)) issues.push({ severity: 'error', path: 'geo.longitude', message: `Longitude ${lon} is out of range [-180, 180]` })
    if (lon != null && lon > 0 && metadata.geo.properties?.country && ['United States','Canada','Mexico'].some(c => metadata.geo!.properties!.country!.includes(c))) {
      issues.push({ severity: 'warning', path: 'geo.longitude', message: `Longitude ${lon} is positive — North American sites should typically be negative` })
    }
  }

  // pub
  for (const [i, pub] of (metadata.pub ?? []).entries()) {
    if (pub.DOI && !pub.doi) issues.push({ severity: 'warning', path: `pub[${i}].doi`, message: 'DOI is stored as "DOI" (uppercase) — should be "doi"' })
    if (pub.author && typeof pub.author === 'string') issues.push({ severity: 'warning', path: `pub[${i}].author`, message: 'author should be an array of {name: ...} objects, not a string' })
    if (pub.identifier) issues.push({ severity: 'warning', path: `pub[${i}].doi`, message: 'DOI stored in legacy "identifier" field — should be "doi"' })
  }

  // columns
  const tsids = new Set<string>()
  const sections = [...(metadata.paleoData ?? []).map((d, i) => ({ key: `paleoData[${i}]`, d })), ...(metadata.chronData ?? []).map((d, i) => ({ key: `chronData[${i}]`, d }))]
  for (const { key, d } of sections) {
    for (const [ti, table] of (d.measurementTable ?? []).entries()) {
      const tpath = `${key}.measurementTable[${ti}]`
      if (!table.columns?.length) issues.push({ severity: 'error', path: tpath, message: 'Table has no columns' })
      for (const col of table.columns ?? []) {
        const cpath = `${tpath}.${col.variableName}`
        if (!col.TSid) issues.push({ severity: 'error', path: cpath, message: 'Column is missing TSid' })
        if (col.TSid) {
          if (tsids.has(col.TSid)) issues.push({ severity: 'error', path: cpath, message: `Duplicate TSid: ${col.TSid}` })
          tsids.add(col.TSid)
        }
        if (!col.units) issues.push({ severity: 'warning', path: cpath, message: `${col.variableName}: units are missing` })
        if (col.units && !UNITS.includes(col.units as string)) issues.push({ severity: 'warning', path: cpath, message: `${col.variableName}: units "${col.units}" not in standard vocabulary` })
        if (col.variableName && !VARIABLE_NAMES.includes(col.variableName) && !['year','age','depth'].includes(col.variableName.toLowerCase())) {
          issues.push({ severity: 'warning', path: cpath, message: `${col.variableName}: variableName not in standard vocabulary` })
        }
        if (col.proxy && !PROXY_TYPES.includes(col.proxy as string)) issues.push({ severity: 'warning', path: cpath, message: `${col.variableName}: proxy "${col.proxy}" not in standard vocabulary` })
        if (col.proxyGeneral && !PROXY_GENERAL.includes(col.proxyGeneral as string)) issues.push({ severity: 'warning', path: cpath, message: `${col.variableName}: proxyGeneral "${col.proxyGeneral}" not in standard vocabulary` })
        if (!col.values?.length) issues.push({ severity: 'warning', path: cpath, message: `${col.variableName}: no data values loaded (CSV may not have been found)` })
        for (const [ii, interp] of (col.interpretation ?? []).entries()) {
          const ipath = `${cpath}.interpretation[${ii}]`
          if (interp.variable && !INTERP_VARIABLES.includes(interp.variable as string)) issues.push({ severity: 'warning', path: ipath, message: `interpretation.variable "${interp.variable}" not in standard vocabulary` })
          if (interp.seasonality && !SEASONALITY.includes(interp.seasonality as string)) issues.push({ severity: 'warning', path: ipath, message: `interpretation.seasonality "${interp.seasonality}" not in standard vocabulary` })
        }
      }
    }
  }

  return issues
}

// NOAA WDS-Paleo submission profile: what a landing page / template submission
// expects beyond a structurally valid LiPD. Errors = NOAA-required, warnings =
// strongly recommended. Shown in the validation panel behind a toggle and
// mirrored by the "NOAA .txt" export fields.
export function validateNoaa(metadata: LipdMetadata): Issue[] {
  const issues: Issue[] = []
  const req = (cond: unknown, path: string, message: string) => {
    if (!cond) issues.push({ severity: 'error', path, message })
  }
  const rec = (cond: unknown, path: string, message: string) => {
    if (!cond) issues.push({ severity: 'warning', path, message })
  }

  req(metadata.dataSetName, 'dataSetName', 'NOAA: study name (dataset name) is required')
  req(metadata.investigators, 'investigators', 'NOAA: investigators are required')
  req(metadata.timeUnit, 'timeUnit', 'NOAA: time unit is required (e.g. "cal yr BP")')
  req(metadata.earliestYear != null && metadata.earliestYear !== '', 'earliestYear', 'NOAA: earliest year is required')
  req(metadata.mostRecentYear != null && metadata.mostRecentYear !== '', 'mostRecentYear', 'NOAA: most recent year is required')

  const geo = metadata.geo
  const coords = geo?.geometry?.coordinates
  req(geo?.properties?.siteName ?? geo?.siteName, 'geo.siteName', 'NOAA: site name is required')
  rec(geo?.properties?.location, 'geo.location', 'NOAA: location (e.g. "Continent>Europe") is recommended')
  req(coords?.[1] != null || geo?.latitude != null, 'geo.latitude', 'NOAA: latitude is required')
  req(coords?.[0] != null || geo?.longitude != null, 'geo.longitude', 'NOAA: longitude is required')
  rec((coords?.[2] ?? geo?.elevation) != null, 'geo.elevation', 'NOAA: elevation is recommended')

  rec(metadata.datasetDOI, 'datasetDOI', 'NOAA: dataset DOI is recommended')
  rec(metadata.originalDataUrl, 'originalDataUrl', 'NOAA: original source URL is recommended')

  const pubs = metadata.pub ?? []
  req(pubs.length > 0, 'pub', 'NOAA: at least one publication is required')
  for (const [i, pub] of pubs.entries()) {
    req(pub.title, `pub[${i}].title`, `NOAA: publication ${i + 1} needs a title`)
    req(Array.isArray(pub.author) ? pub.author.length : pub.author, `pub[${i}].author`, `NOAA: publication ${i + 1} needs authors`)
    req(pub.year, `pub[${i}].year`, `NOAA: publication ${i + 1} needs a year`)
    rec(pub.abstract, `pub[${i}].abstract`, `NOAA: publication ${i + 1} abstract is recommended`)
  }

  const tables = [...(metadata.paleoData ?? []), ...(metadata.chronData ?? [])]
    .flatMap(s => s.measurementTable ?? [])
  req(tables.length > 0, 'paleoData', 'NOAA: at least one measurement table is required')
  for (const table of tables) {
    for (const col of table.columns ?? []) {
      rec(col.units, `${table.tableName ?? 'table'}.${col.variableName}`, `NOAA: column "${col.variableName}" should have units`)
    }
  }

  return issues
}
