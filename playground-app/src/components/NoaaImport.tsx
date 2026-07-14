import { useState } from 'react'
import {
  searchNoaaStudies, noaaStudyToLipd, noaaStudyViaService, noaaFileToLipd, noaaFileViaService,
  NOAA_DATA_TYPES, type NoaaStudy, type NoaaSearchFilters,
} from '../lib/noaa'
import { SEASONALITY } from '../lib/vocabulary'
import type { LipdFile } from '../types/lipd'
import pyleotupsLogo from '../assets/pyleotups_logo.png'

interface Props {
  onLoad: (lipd: LipdFile) => void
}

export function NoaaImport({ onLoad }: Props) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<NoaaStudy[] | null>(null)

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [investigators, setInvestigators] = useState('')
  const [dataTypeId, setDataTypeId] = useState('')
  const [variableName, setVariableName] = useState('')
  const [cvMaterials, setCvMaterials] = useState('')
  const [cvSeasonalities, setCvSeasonalities] = useState('')
  const [species, setSpecies] = useState('')
  const [locations, setLocations] = useState('')
  const [minLat, setMinLat] = useState(''); const [maxLat, setMaxLat] = useState('')
  const [minLon, setMinLon] = useState(''); const [maxLon, setMaxLon] = useState('')
  const [minElevation, setMinElevation] = useState(''); const [maxElevation, setMaxElevation] = useState('')
  const [earliestYear, setEarliestYear] = useState(''); const [latestYear, setLatestYear] = useState('')
  const [reconstructionOnly, setReconstructionOnly] = useState(false)

  const importStudy = async (study: NoaaStudy) => {
    setBusy(`Importing "${study.studyName}"…`)
    setError(null)
    try {
      // Prefer the PyleoTUPS service (better parsing); fall back to the
      // browser parser when it isn't deployed.
      const viaService = await noaaStudyViaService(study.NOAAStudyId)
      const { lipd, skippedFiles, metadataOnly } = viaService ?? await noaaStudyToLipd(study)
      if (skippedFiles.length) {
        console.warn('NOAA import skipped files:', skippedFiles)
      }
      if (metadataOnly) {
        const names = skippedFiles.map(f => f.split('/').pop()).join(', ')
        if (!window.confirm(
          `The data file(s) in this study (${names}) aren't in a format that can be ` +
          `converted automatically. Import the study metadata with an empty data table? ` +
          `You can add the values in the Data tab via "Import CSV/TSV" or "Paste data".`
        )) {
          setBusy(null)
          return
        }
      }
      onLoad(lipd)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  const openLocalNoaaFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(`Reading ${file.name}…`)
    setError(null)
    try {
      const text = await file.text()
      // Prefer the PyleoTUPS service (handles old/non-standard formats too)
      const viaService = await noaaFileViaService(text, file.name)
      if (viaService.status === 'ok') {
        onLoad(viaService.result.lipd)
        return
      }
      if (viaService.status === 'error') {
        setError(viaService.message)
        return
      }
      // Service unavailable → browser parser (standard NOAA templates only)
      onLoad(noaaFileToLipd(text, file.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file')
    } finally {
      setBusy(null)
    }
  }

  const search = async () => {
    if (busy) return
    const numOr = (s: string) => (s.trim() === '' ? undefined : Number(s))
    const filters: NoaaSearchFilters = {
      investigators: investigators || undefined,
      dataTypeId: dataTypeId || undefined,
      variableName: variableName || undefined,
      cvMaterials: cvMaterials || undefined,
      cvSeasonalities: cvSeasonalities || undefined,
      species: species || undefined,
      locations: locations || undefined,
      minLat: numOr(minLat), maxLat: numOr(maxLat),
      minLon: numOr(minLon), maxLon: numOr(maxLon),
      minElevation: numOr(minElevation), maxElevation: numOr(maxElevation),
      earliestYear: numOr(earliestYear), latestYear: numOr(latestYear),
      reconstructionOnly: reconstructionOnly || undefined,
    }
    const anyFilter = Object.values(filters).some(v => v !== undefined)
    if (!query.trim() && !anyFilter) return
    setBusy('Searching NOAA…')
    setError(null)
    setResults(null)
    try {
      const studies = await searchNoaaStudies(query, filters)
      if (!studies.length) {
        setError('No NOAA studies found for that query.')
      } else if (studies.length === 1) {
        await importStudy(studies[0])
        return
      } else {
        setResults(studies)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setBusy(prev => (prev && prev.startsWith('Importing') ? prev : null))
    }
  }

  return (
    <div className="noaa-import">
      <div className="noaa-import-row">
        <a
          className="noaa-import-logo"
          href="https://github.com/LinkedEarth/PyleoTUPS"
          target="_blank"
          rel="noreferrer"
          title="NOAA import based on PyleoTUPS — view on GitHub"
        >
          <img src={pyleotupsLogo} alt="PyleoTUPS" />
        </a>
        <input
          type="text"
          placeholder="NOAA study ID, study URL, or keywords"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search() }}
          disabled={!!busy}
        />
        <button className="btn" onClick={search} disabled={!!busy}>
          Search
        </button>
      </div>

      <div className="noaa-import-secondary">
        <button
          className="noaa-advanced-toggle"
          onClick={() => setShowAdvanced(s => !s)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? '▾' : '▸'} More filters
        </button>
        <label className="noaa-file-link" title="Open a NOAA-templated .txt file from your computer">
          or open a local NOAA .txt file
          <input
            type="file"
            accept=".txt,.csv,.tsv,.dat,text/plain"
            style={{ display: 'none' }}
            onChange={e => { openLocalNoaaFile(e.target.files?.[0]); e.target.value = '' }}
          />
        </label>
      </div>

      {showAdvanced && (
        <div className="noaa-advanced">
          <label className="query-field">
            <span>Investigator</span>
            <input value={investigators} onChange={e => setInvestigators(e.target.value)}
              placeholder="e.g. Khider" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Archive type</span>
            <select value={dataTypeId} onChange={e => setDataTypeId(e.target.value)}>
              <option value="">Any</option>
              {NOAA_DATA_TYPES.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="query-field">
            <span>Variable</span>
            {/* NOAA's cvWhats uses its own vocabulary (not LiPD names), e.g. "Sea Surface Temperature" */}
            <input value={variableName} onChange={e => setVariableName(e.target.value)}
              placeholder="e.g. Sea Surface Temperature" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Material</span>
            <input value={cvMaterials} onChange={e => setCvMaterials(e.target.value)}
              placeholder="e.g. calcite" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Seasonality</span>
            <input list="noaa-seasonality-list" value={cvSeasonalities} onChange={e => setCvSeasonalities(e.target.value)}
              placeholder="e.g. Annual" onKeyDown={e => { if (e.key === 'Enter') search() }} />
            <datalist id="noaa-seasonality-list">{SEASONALITY.map(v => <option key={v} value={v} />)}</datalist>
          </label>
          <label className="query-field">
            <span>Species <em>(4-letter code)</em></span>
            <input value={species} onChange={e => setSpecies(e.target.value)}
              placeholder="e.g. PCGL" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Location</span>
            <input value={locations} onChange={e => setLocations(e.target.value)}
              placeholder="e.g. Continent>Africa" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <div className="noaa-range">
            <span className="noaa-range-title">Latitude</span>
            <input type="number" step="any" placeholder="min" value={minLat} onChange={e => setMinLat(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={maxLat} onChange={e => setMaxLat(e.target.value)} />
          </div>
          <div className="noaa-range">
            <span className="noaa-range-title">Longitude</span>
            <input type="number" step="any" placeholder="min" value={minLon} onChange={e => setMinLon(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={maxLon} onChange={e => setMaxLon(e.target.value)} />
          </div>
          <div className="noaa-range">
            <span className="noaa-range-title">Elevation (m)</span>
            <input type="number" step="any" placeholder="min" value={minElevation} onChange={e => setMinElevation(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={maxElevation} onChange={e => setMaxElevation(e.target.value)} />
          </div>
          <div className="noaa-range">
            <span className="noaa-range-title">Year (CE)</span>
            <input type="number" step="any" placeholder="from" value={earliestYear} onChange={e => setEarliestYear(e.target.value)} />
            <input type="number" step="any" placeholder="to" value={latestYear} onChange={e => setLatestYear(e.target.value)} />
          </div>
          <label className="noaa-check">
            <input type="checkbox" checked={reconstructionOnly} onChange={e => setReconstructionOnly(e.target.checked)} />
            Reconstructions only
          </label>
        </div>
      )}

      {busy && <p className="noaa-import-status">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {results && (
        <ul className="noaa-import-results">
          {results.map(s => (
            <li key={s.NOAAStudyId}>
              <button onClick={() => importStudy(s)} disabled={!!busy}>
                <span className="noaa-study-name">{s.studyName}</span>
                <span className="noaa-study-meta">
                  {s.dataType ?? ''} · NOAA {s.NOAAStudyId}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
