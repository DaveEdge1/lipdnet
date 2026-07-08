import { useState } from 'react'
import { queryDatasets, type DatasetResult, type QueryFilters } from '../lib/sparql'
import { proxiedLpdUrl } from '../lib/remote'
import { QueryMap } from '../components/QueryMap'

// Ontology archive types (local names) with display labels
const ARCHIVES = [
  'Borehole', 'Coral', 'Documents', 'FluvialSediment', 'GlacierIce', 'GroundIce',
  'LakeSediment', 'MarineSediment', 'Midden', 'MolluskShell', 'Other', 'Peat',
  'Sclerosponge', 'Shoreline', 'Speleothem', 'TerrestrialSediment', 'Wood',
]
const label = (a: string) => a.replace(/([a-z])([A-Z])/g, '$1 $2')

function NumRange({ title, min, max, onMin, onMax }: {
  title: string
  min: string; max: string
  onMin: (v: string) => void; onMax: (v: string) => void
}) {
  return (
    <div className="query-range">
      <span className="query-range-title">{title}</span>
      <input type="number" placeholder="min" value={min} onChange={e => onMin(e.target.value)} />
      <input type="number" placeholder="max" value={max} onChange={e => onMax(e.target.value)} />
    </div>
  )
}

export function QueryView() {
  const [name, setName] = useState('')
  const [variable, setVariable] = useState('')
  const [archives, setArchives] = useState<Set<string>>(new Set())
  const [latMin, setLatMin] = useState(''); const [latMax, setLatMax] = useState('')
  const [lonMin, setLonMin] = useState(''); const [lonMax, setLonMax] = useState('')
  const [elevMin, setElevMin] = useState(''); const [elevMax, setElevMax] = useState('')
  const [yearMin, setYearMin] = useState(''); const [yearMax, setYearMax] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<DatasetResult[] | null>(null)
  const [view, setView] = useState<'list' | 'map'>('list')

  const toggleArchive = (a: string) => {
    setArchives(prev => {
      const next = new Set(prev)
      if (next.has(a)) next.delete(a); else next.add(a)
      return next
    })
  }

  const search = async () => {
    setBusy(true)
    setError(null)
    try {
      const opt = (s: string) => (s.trim() === '' ? undefined : Number(s))
      const filters: QueryFilters = {
        name: name || undefined,
        variableName: variable || undefined,
        archiveTypes: archives.size ? [...archives] : undefined,
        latMin: opt(latMin), latMax: opt(latMax),
        lonMin: opt(lonMin), lonMax: opt(lonMax),
        elevMin: opt(elevMin), elevMax: opt(elevMax),
        yearMin: opt(yearMin), yearMax: opt(yearMax),
      }
      setResults(await queryDatasets(filters))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app query-page">
      <div className="query-filters">
        <h2>Query LiPDverse Datasets</h2>
        <p className="query-hint">
          Search the <a href="https://lipdverse.org" target="_blank" rel="noreferrer">LiPDverse</a> knowledge
          base. All filters are optional; combine as needed.
        </p>

        <label className="query-field">
          <span>Dataset name contains</span>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }} placeholder="e.g. ODP846" />
        </label>

        <label className="query-field">
          <span>Variable name contains</span>
          <input type="text" value={variable} onChange={e => setVariable(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }} placeholder="e.g. temperature, d18O" />
        </label>

        <fieldset className="query-archives">
          <legend>Archive type</legend>
          {ARCHIVES.map(a => (
            <label key={a}>
              <input type="checkbox" checked={archives.has(a)} onChange={() => toggleArchive(a)} />
              {label(a)}
            </label>
          ))}
        </fieldset>

        <NumRange title="Latitude" min={latMin} max={latMax} onMin={setLatMin} onMax={setLatMax} />
        <NumRange title="Longitude" min={lonMin} max={lonMax} onMin={setLonMin} onMax={setLonMax} />
        <NumRange title="Elevation (m)" min={elevMin} max={elevMax} onMin={setElevMin} onMax={setElevMax} />
        <NumRange title="Year (CE)" min={yearMin} max={yearMax} onMin={setYearMin} onMax={setYearMax} />

        <button className="btn query-search-btn" onClick={search} disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="query-results">
        {results === null && !busy && (
          <p className="query-empty">Set your filters, then hit Search.</p>
        )}
        {results !== null && (
          <>
            <div className="query-results-header">
              <span>
                {results.length} dataset{results.length === 1 ? '' : 's'}
                {results.length >= 200 && ' (showing first 200 — narrow your filters)'}
              </span>
              {results.length > 0 && (
                <div className="query-view-toggle">
                  <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
                    List
                  </button>
                  <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
                    Map
                  </button>
                </div>
              )}
            </div>
            {view === 'map' && <QueryMap results={results} />}
            {view === 'list' && (
            <ul className="query-results-list">
              {results.map(r => (
                <li key={r.name}>
                  <div className="query-result-main">
                    <span className="query-result-name">{r.name}</span>
                    <span className="query-result-meta">
                      {[
                        r.archiveType && label(r.archiveType),
                        r.siteName,
                        r.lat !== undefined && r.lon !== undefined && `${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°`,
                        r.minYear !== undefined && r.maxYear !== undefined && `${Math.round(r.minYear)}–${Math.round(r.maxYear)} CE`,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="query-result-actions">
                    {r.lipdverseLink && (
                      <a href={r.lipdverseLink} target="_blank" rel="noreferrer">LiPDverse</a>
                    )}
                    {r.downloadUrl && (
                      <>
                        <a href={proxiedLpdUrl(r.downloadUrl)} download={`${r.name}.lpd`}>Download</a>
                        <a href={`/playground?open=${encodeURIComponent(r.downloadUrl)}`}>Open in playground</a>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
