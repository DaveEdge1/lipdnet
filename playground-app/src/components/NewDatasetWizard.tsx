import { useMemo, useState } from 'react'
import { ARCHIVE_TYPES, VARIABLE_NAMES, UNITS } from '../lib/vocabulary'
import { createNewLipd } from '../lib/newDataset'
import type { LipdFile } from '../types/lipd'

interface Props {
  onCreate: (lipd: LipdFile) => void
  onCancel: () => void
}

// Prompt for the key information a valid LiPD file needs before opening the
// editor. Controlled-vocabulary fields autocomplete from the lipdverse
// vocabulary (generated into lib/vocabulary.ts from lipdjs).
export function NewDatasetWizard({ onCreate, onCancel }: Props) {
  const [dataSetName, setDataSetName] = useState('')
  const [archiveType, setArchiveType] = useState('')
  const [siteName, setSiteName] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [elev, setElev] = useState('')
  const [investigators, setInvestigators] = useState('')
  const [variableName, setVariableName] = useState('temperature')
  const [units, setUnits] = useState('degC')

  const latNum = Number(lat)
  const lonNum = Number(lon)
  const latOk = lat.trim() !== '' && !isNaN(latNum) && latNum >= -90 && latNum <= 90
  const lonOk = lon.trim() !== '' && !isNaN(lonNum) && lonNum >= -180 && lonNum <= 180

  // Required for a valid LiPD file (matches the validator's error-level checks)
  const required: Array<{ label: string; done: boolean }> = useMemo(() => [
    { label: 'Dataset name', done: dataSetName.trim() !== '' },
    { label: 'Archive type', done: archiveType.trim() !== '' },
    { label: 'Site name', done: siteName.trim() !== '' },
    { label: 'Latitude', done: latOk },
    { label: 'Longitude', done: lonOk },
  ], [dataSetName, archiveType, siteName, latOk, lonOk])

  const doneCount = required.filter(r => r.done).length
  const pct = Math.round((doneCount / required.length) * 100)
  const complete = doneCount === required.length

  const create = () => {
    if (!complete) return
    onCreate(createNewLipd({
      dataSetName,
      archiveType,
      siteName,
      latitude: latNum,
      longitude: lonNum,
      elevation: elev.trim() === '' || isNaN(Number(elev)) ? undefined : Number(elev),
      investigators,
      variableName,
      units,
    }))
  }

  return (
    <div className="wizard-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="wizard-card">
        <h2>Start a new dataset</h2>
        <p className="query-hint">
          These fields make a valid LiPD file. Suggestions come from the{' '}
          <a href="https://lipdverse.org/vocabulary" target="_blank" rel="noreferrer">
            LiPDverse controlled vocabulary
          </a>.
        </p>

        <div className="wizard-progress">
          <div className="wizard-progress-track">
            <div className="wizard-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="wizard-progress-label">
            {doneCount} of {required.length} required
            {!complete && ` — missing: ${required.filter(r => !r.done).map(r => r.label).join(', ')}`}
          </span>
        </div>

        <div className="wizard-grid">
          <label className="query-field wizard-span2">
            <span>Dataset name * <em>(convention: Site.Investigator.Year, e.g. CrystalCave.McCabe-Glynn.2013)</em></span>
            <input value={dataSetName} onChange={e => setDataSetName(e.target.value)}
              placeholder="e.g. CrystalCave.McCabe-Glynn.2013" autoFocus />
          </label>

          <label className="query-field">
            <span>Archive type *</span>
            <input list="wizard-archives" value={archiveType} onChange={e => setArchiveType(e.target.value)}
              placeholder="e.g. Lake sediment" />
            <datalist id="wizard-archives">
              {ARCHIVE_TYPES.map(a => <option key={a} value={a} />)}
            </datalist>
          </label>

          <label className="query-field">
            <span>Site name *</span>
            <input value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. Crystal Cave" />
          </label>

          <label className="query-field">
            <span>Latitude * <em>(-90 to 90)</em></span>
            <input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)}
              className={lat && !latOk ? 'invalid' : ''} placeholder="e.g. 36.59" />
          </label>

          <label className="query-field">
            <span>Longitude * <em>(-180 to 180)</em></span>
            <input type="number" step="any" value={lon} onChange={e => setLon(e.target.value)}
              className={lon && !lonOk ? 'invalid' : ''} placeholder="e.g. -118.82" />
          </label>

          <label className="query-field">
            <span>Elevation (m)</span>
            <input type="number" step="any" value={elev} onChange={e => setElev(e.target.value)} placeholder="optional" />
          </label>

          <label className="query-field">
            <span>Investigators <em>(Last, F.; Last, F.)</em></span>
            <input value={investigators} onChange={e => setInvestigators(e.target.value)} placeholder="optional" />
          </label>

          <label className="query-field">
            <span>Primary variable</span>
            <input list="wizard-variables" value={variableName} onChange={e => setVariableName(e.target.value)} />
            <datalist id="wizard-variables">
              {VARIABLE_NAMES.map(v => <option key={v} value={v} />)}
            </datalist>
          </label>

          <label className="query-field">
            <span>Variable units</span>
            <input list="wizard-units" value={units} onChange={e => setUnits(e.target.value)} />
            <datalist id="wizard-units">
              {UNITS.map(u => <option key={u} value={u} />)}
            </datalist>
          </label>
        </div>

        <div className="wizard-actions">
          <button className="btn-close" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={!complete} onClick={create}
            title={complete ? 'Create the dataset and open the editor' : 'Fill the required fields first'}>
            Create dataset
          </button>
        </div>
      </div>
    </div>
  )
}
