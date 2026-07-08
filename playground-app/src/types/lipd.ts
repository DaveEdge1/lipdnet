export interface LipdColumn {
  number: number
  variableName: string
  TSid: string
  units?: string
  description?: string
  proxy?: string
  proxyGeneral?: string
  hasMinValue?: number
  hasMaxValue?: number
  hasMeanValue?: number
  hasMedianValue?: number
  interpretation?: Array<Record<string, unknown>>
  [key: string]: unknown
  // values loaded into memory (not stored in JSON)
  values?: (number | string | null)[]
}

export interface LipdTable {
  tableName?: string
  filename?: string
  missingValue?: string
  columns: LipdColumn[]
}

export interface LipdPaleoData {
  measurementTable?: LipdTable[]
  model?: Array<{
    summaryTable?: LipdTable[]
    ensembleTable?: LipdTable[]
    distributionTable?: LipdTable[]
  }>
}

export interface LipdGeo {
  type?: string
  geometry?: {
    type: string
    coordinates: [number, number, number?]
  }
  properties?: {
    siteName?: string
    country?: string
    location?: string
    [key: string]: unknown
  }
  // flat form (lipdR in-memory)
  latitude?: number
  longitude?: number
  elevation?: number
  siteName?: string
}

export interface LipdPub {
  author?: Array<{ name: string }> | string | null
  title?: string
  year?: number | string
  journal?: string
  volume?: string
  pages?: string
  doi?: string
  DOI?: string
  [key: string]: unknown
}

export interface LipdMetadata {
  '@context'?: string
  archiveType?: string
  dataSetName?: string
  datasetId?: string
  datasetVersion?: string
  lipdVersion?: number
  createdBy?: string
  investigators?: string
  changelog?: Array<{ name: string; date: string; version: string; notes: string }>
  geo?: LipdGeo
  pub?: LipdPub[]
  funding?: Array<Record<string, unknown>>
  paleoData?: LipdPaleoData[]
  chronData?: LipdPaleoData[]
  [key: string]: unknown
}

export interface LipdFile {
  metadata: LipdMetadata
  filename: string
  // map from csv filename -> raw text (for display / re-export)
  csvData: Record<string, string>
}
