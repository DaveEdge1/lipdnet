import type { LipdFile, LipdColumn } from '../types/lipd'

// Generate a TSid for columns created in the playground. Follows the legacy
// playground convention of a WEB- prefix so provenance is visible.
export function makeTSid(): string {
  return `WEB-${randomId(10)}`
}

function randomId(len: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < len; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return id
}

function column(number: number, variableName: string, units: string | undefined, rows: number): LipdColumn {
  return {
    number,
    variableName,
    TSid: makeTSid(),
    ...(units ? { units } : {}),
    values: Array(rows).fill(null),
  }
}

export interface NewDatasetOptions {
  dataSetName: string
  archiveType?: string
  siteName?: string
  latitude?: number
  longitude?: number
  elevation?: number
  investigators?: string
}

// Build a valid starting dataset from the wizard's answers: one paleo
// measurement table with a generic depth/age/value skeleton, geo from the
// given coordinates, and an auto-generated datasetId. Columns are meant to be
// added/replaced in the Data tab (CSV/spreadsheet import).
export function createNewLipd(opts: NewDatasetOptions): LipdFile {
  const rows = 5
  const name = opts.dataSetName.trim() || 'MyDataset'
  return {
    filename: `${name.replace(/[^\w.\-]+/g, '_')}.lpd`,
    metadata: {
      lipdVersion: 1.3,
      createdBy: 'lipd.net playground',
      dataSetName: name,
      datasetId: `WEB${randomId(17)}`,
      datasetVersion: '1.0.0',
      archiveType: opts.archiveType?.trim() || undefined,
      investigators: opts.investigators?.trim() || undefined,
      geo: {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [opts.longitude ?? 0, opts.latitude ?? 0, opts.elevation ?? 0],
        },
        properties: { siteName: opts.siteName?.trim() ?? '' },
      },
      pub: [],
      paleoData: [
        {
          measurementTable: [
            {
              tableName: 'measurementTable0',
              filename: 'paleo0measurement0.csv',
              missingValue: 'NaN',
              columns: [
                column(1, 'depth', 'cm', rows),
                column(2, 'age', 'yr BP', rows),
                column(3, 'value', undefined, rows),
              ],
            },
          ],
        },
      ],
    },
    csvData: {},
  }
}
