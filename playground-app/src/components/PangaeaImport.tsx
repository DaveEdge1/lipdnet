import { useState } from 'react'
import { pangaeaId, pangaeaSearch, pangaeaImport, PANGAEA_TOPICS, type PangaeaHit, type PangaeaSearchFilters } from '../lib/noaa'
import { VARIABLE_NAMES } from '../lib/vocabulary'
import type { LipdFile } from '../types/lipd'

interface Props {
  onLoad: (lipd: LipdFile) => void
}

// PANGAEA import runs entirely through the PyleoTUPS service (no browser path).
export function PangaeaImport({ onLoad }: Props) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<PangaeaHit[] | null>(null)
  const [collection, setCollection] = useState<{ id: string; name?: string; members: PangaeaHit[] } | null>(null)

  // Advanced filters (mirror PyleoTUPS search_studies)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [investigators, setInvestigators] = useState('')
  const [variableName, setVariableName] = useState('')
  const [topic, setTopic] = useState('')
  const [minLat, setMinLat] = useState(''); const [maxLat, setMaxLat] = useState('')
  const [minLon, setMinLon] = useState(''); const [maxLon, setMaxLon] = useState('')

  const unavailableMsg =
    'PANGAEA import needs the PyleoTUPS import service, which is not available here.'

  const importId = async (id: string, opts: { label?: string; expand?: boolean } = {}) => {
    const { label, expand } = opts
    setBusy(expand
      ? `Importing all datasets in ${label ?? `collection ${id}`} — this can take a while…`
      : `Importing ${label ?? `PANGAEA ${id}`}…`)
    setError(null)
    const res = await pangaeaImport(id, expand)
    setBusy(null)
    if (res.status === 'ok') { setCollection(null); onLoad(res.result.lipd) }
    else if (res.status === 'collection') { setResults(null); setCollection({ id: res.id, name: res.name, members: res.members }) }
    else if (res.status === 'unavailable') setError(unavailableMsg)
    else setError(res.message)
  }

  const search = async () => {
    const q = query.trim()
    const numOr = (s: string) => (s.trim() === '' ? undefined : Number(s))
    const filters: PangaeaSearchFilters = {
      investigators: investigators || undefined,
      variableName: variableName || undefined,
      topic: topic || undefined,
      minLat: numOr(minLat), maxLat: numOr(maxLat),
      minLon: numOr(minLon), maxLon: numOr(maxLon),
    }
    const anyFilter = Object.values(filters).some(v => v !== undefined)
    if ((!q && !anyFilter) || busy) return
    // A bare id / DOI / URL is a direct import
    const id = pangaeaId(q)
    if (id && /^\d+$/.test(q.replace(/^.*PANGAEA\./i, ''))) {
      await importId(id)
      return
    }
    setCollection(null)
    setBusy('Searching PANGAEA (this can take up to a minute)…')
    setError(null)
    setResults(null)
    setCollection(null)
    const res = await pangaeaSearch(q, filters)
    setBusy(null)
    if (res.status === 'unavailable') { setError(unavailableMsg); return }
    if (res.status === 'error') { setError(res.message); return }
    if (!res.hits.length) { setError('No PANGAEA datasets found for that query.'); return }
    if (res.hits.length === 1) { await importId(res.hits[0].id, { label: res.hits[0].name }); return }
    setResults(res.hits)
  }

  return (
    <div className="noaa-import">
      <div className="noaa-import-row">
        <input
          type="text"
          placeholder="PANGAEA dataset ID, DOI, or keywords"
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
      </div>

      {showAdvanced && (
        <div className="noaa-advanced">
          <label className="query-field">
            <span>Investigator</span>
            <input value={investigators} onChange={e => setInvestigators(e.target.value)}
              placeholder="e.g. Stein" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Variable / parameter</span>
            <input list="pangaea-varname-list" value={variableName} onChange={e => setVariableName(e.target.value)}
              placeholder="e.g. d18O" onKeyDown={e => { if (e.key === 'Enter') search() }} />
            <datalist id="pangaea-varname-list">{VARIABLE_NAMES.map(v => <option key={v} value={v} />)}</datalist>
          </label>
          <label className="query-field">
            <span>Topic</span>
            <select value={topic} onChange={e => setTopic(e.target.value)}>
              <option value="">Any</option>
              {PANGAEA_TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
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
          <p className="noaa-advanced-note">A geographic box needs all four bounds filled.</p>
        </div>
      )}

      {busy && <p className="noaa-import-status">{busy}</p>}
      {error && <p className="error">{error}</p>}

      {collection && (
        <div className="pangaea-collection">
          <p className="pangaea-collection-note">
            <strong>{collection.name ?? `PANGAEA ${collection.id}`}</strong> is a collection of{' '}
            {collection.members.length} datasets. Import them all as one dataset (one table each), or pick one:
          </p>
          <button className="btn" onClick={() => importId(collection.id, { expand: true, label: collection.name })} disabled={!!busy}>
            Import all {collection.members.length} together
          </button>
          <ul className="noaa-import-results">
            {collection.members.map(m => (
              <li key={m.id}>
                <button onClick={() => importId(m.id, { label: m.name })} disabled={!!busy}>
                  <span className="noaa-study-name">{m.name}</span>
                  <span className="noaa-study-meta">PANGAEA {m.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {results && (
        <ul className="noaa-import-results">
          {results.map(h => (
            <li key={h.id}>
              <button onClick={() => importId(h.id, { label: h.name })} disabled={!!busy}>
                <span className="noaa-study-name">{h.name}</span>
                <span className="noaa-study-meta">PANGAEA {h.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
