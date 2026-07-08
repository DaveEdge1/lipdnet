import type { LipdFile, LipdColumn } from '../types/lipd'

// Generate a TSid for columns created in the playground. Follows the legacy
// playground convention of a WEB- prefix so provenance is visible.
export function makeTSid(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 10; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `WEB-${id}`
}

function column(number: number, variableName: string, units: string, rows: number): LipdColumn {
  return {
    number,
    variableName,
    TSid: makeTSid(),
    units,
    values: Array(rows).fill(null),
  }
}

// A minimal-but-valid starting point: one paleo measurement table with
// depth/age/value columns the user can rename, plus empty rows to fill in.
export function createNewLipd(): LipdFile {
  const rows = 5
  return {
    filename: 'MyDataset.lpd',
    metadata: {
      lipdVersion: 1.3,
      createdBy: 'lipd.net playground',
      dataSetName: 'MyDataset',
      datasetVersion: '1.0.0',
      archiveType: undefined,
      geo: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0, 0] },
        properties: { siteName: '' },
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
                column(3, 'temperature', 'degC', rows),
              ],
            },
          ],
        },
      ],
    },
    csvData: {},
  }
}
