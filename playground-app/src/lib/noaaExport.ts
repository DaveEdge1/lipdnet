// Export a LiPD dataset as NOAA-templated text file(s) — the reverse of the
// NOAA import in noaa.ts, and the browser-side replacement for the retired
// Flask backend's lpd_noaa conversion. One .txt per measurement table,
// following the NOAA WDS-Paleo template (# metadata, ## variable lines with
// the 9-component descriptor, tab-delimited data).
import JSZip from 'jszip'
import type { LipdFile, LipdMetadata, LipdTable, LipdColumn, LipdPub } from '../types/lipd'

const line = (s = '') => `# ${s}`.trimEnd()
const section = (title: string, rows: string[]) =>
  [line(title), ...rows.map(r => line(`   ${r}`)), line('---------------')]

function pubLines(pub: LipdPub, i: number): string[] {
  const authors = Array.isArray(pub.author)
    ? pub.author.map(a => a?.name).filter(Boolean).join('; ')
    : typeof pub.author === 'string' ? pub.author : ''
  return section(`Publication_${i + 1}`, [
    `Authors: ${authors}`,
    `Published_Title: ${pub.title ?? ''}`,
    `Journal_Name: ${pub.journal ?? ''}`,
    `Published_Date_or_Year: ${pub.year ?? ''}`,
    `Volume: ${pub.volume ?? ''}`,
    `Pages: ${pub.pages ?? ''}`,
    `DOI: ${pub.doi ?? pub.DOI ?? ''}`,
  ])
}

function geoLines(metadata: LipdMetadata): string[] {
  const geo = metadata.geo
  const coords = geo?.geometry?.coordinates
  const lat = coords ? coords[1] : geo?.latitude
  const lon = coords ? coords[0] : geo?.longitude
  const elev = coords ? coords[2] : geo?.elevation
  return section('Site Information', [
    `Site_Name: ${geo?.properties?.siteName ?? geo?.siteName ?? ''}`,
    `Location: ${geo?.properties?.location ?? ''}`,
    `Northernmost_Latitude: ${lat ?? ''}`,
    `Southernmost_Latitude: ${lat ?? ''}`,
    `Easternmost_Longitude: ${lon ?? ''}`,
    `Westernmost_Longitude: ${lon ?? ''}`,
    `Elevation: ${elev ?? ''}`,
  ])
}

function variableLine(col: LipdColumn): string {
  const numeric = (col.values ?? []).every(v => v === null || typeof v === 'number')
  // 9 components: what, material, error, units, seasonality, archive, detail, method, C/N
  const comps = [
    col.variableName ?? '', '', '',
    (col.units as string) ?? '', '', '',
    (col.description as string) ?? '', '',
    numeric ? 'N' : 'C',
  ]
  return `## ${col.variableName}\t${comps.join(',')}`
}

function tableToNoaaTxt(metadata: LipdMetadata, table: LipdTable): string {
  const cols = [...(table.columns ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  const rowCount = Math.max(0, ...cols.map(c => c.values?.length ?? 0))

  const out: string[] = [
    line(metadata.dataSetName ?? 'LiPD dataset'),
    line('-----------------------------------------------------------------------'),
    line('               World Data Service for Paleoclimatology, Boulder'),
    line('                                    and'),
    line('                       NOAA Paleoclimatology Program'),
    line('-----------------------------------------------------------------------'),
    line(`Online_Resource: https://lipd.net`),
    line(`Original_Source_URL: ${metadata.originalDataUrl ?? ''}`),
    line(`Archive: ${metadata.archiveType ?? ''}`),
    line(`Dataset_DOI: `),
    line('---------------'),
    ...section('Contribution_Date', [`Date: ${new Date().toISOString().slice(0, 10)}`]),
    ...section('Title', [
      `Study_Name: ${metadata.dataSetName ?? ''}`,
      `Table_Name: ${table.tableName ?? ''}`,
    ]),
    ...section('Investigators', [`Investigators: ${metadata.investigators ?? ''}`]),
    ...(metadata.pub ?? []).flatMap((p, i) => pubLines(p, i)),
    ...geoLines(metadata),
    line('Variables'),
    line(''),
    line('Data variables follow that are preceded by "##" in columns one and two.'),
    line('Data line format:  shortname-tab-9 components: what, material, error, units, seasonality, archive, detail, method, C or N for Character or Numeric data'),
    ...cols.map(variableLine),
    line('------------------------'),
    line('Data:'),
    line('Missing_Value: NaN'),
    cols.map(c => c.variableName).join('\t'),
  ]

  for (let i = 0; i < rowCount; i++) {
    out.push(cols.map(c => {
      const v = c.values?.[i]
      return v === null || v === undefined ? 'NaN' : String(v)
    }).join('\t'))
  }
  return out.join('\n') + '\n'
}

export interface NoaaExportFile {
  filename: string
  text: string
}

export function lipdToNoaaFiles(lipd: LipdFile): NoaaExportFile[] {
  const base = (lipd.metadata.dataSetName ?? lipd.filename.replace(/\.lpd$/i, '') ?? 'dataset')
    .replace(/[^\w.\-]+/g, '_')
  const files: NoaaExportFile[] = []
  const sections = [
    ...(lipd.metadata.paleoData ?? []).map((d, i) => ({ d, prefix: `paleo${i}` })),
    ...(lipd.metadata.chronData ?? []).map((d, i) => ({ d, prefix: `chron${i}` })),
  ]
  for (const { d, prefix } of sections) {
    ;(d.measurementTable ?? []).forEach((table, ti) => {
      if (!(table.columns ?? []).length) return
      files.push({
        filename: `${base}-${prefix}measurement${ti}.txt`,
        text: tableToNoaaTxt(lipd.metadata, table),
      })
    })
  }
  return files
}

// Download the NOAA version: a single .txt if there's one table, otherwise a
// zip with one .txt per table.
export async function downloadNoaa(lipd: LipdFile): Promise<void> {
  const files = lipdToNoaaFiles(lipd)
  if (!files.length) throw new Error('No measurement tables with columns to export')

  let blob: Blob
  let name: string
  if (files.length === 1) {
    blob = new Blob([files[0].text], { type: 'text/plain' })
    name = files[0].filename
  } else {
    const zip = new JSZip()
    for (const f of files) zip.file(f.filename, f.text)
    blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
    name = `${files[0].filename.replace(/-.*$/, '')}-noaa.zip`
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
