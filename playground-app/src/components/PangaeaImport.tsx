import { useState } from 'react'
import { pangaeaId, pangaeaSearch, pangaeaImport, type PangaeaHit } from '../lib/noaa'
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

  const unavailableMsg =
    'PANGAEA import needs the PyleoTUPS import service, which is not available here.'

  const importId = async (id: string, label?: string) => {
    setBusy(`Importing ${label ?? `PANGAEA ${id}`}…`)
    setError(null)
    const res = await pangaeaImport(id)
    setBusy(null)
    if (res.status === 'ok') onLoad(res.result.lipd)
    else if (res.status === 'unavailable') setError(unavailableMsg)
    else setError(res.message)
  }

  const search = async () => {
    const q = query.trim()
    if (!q || busy) return
    // A bare id / DOI / URL is a direct import
    const id = pangaeaId(q)
    if (id && /^\d+$/.test(q.replace(/^.*PANGAEA\./i, ''))) {
      await importId(id)
      return
    }
    setBusy('Searching PANGAEA (this can take up to a minute)…')
    setError(null)
    setResults(null)
    const res = await pangaeaSearch(q)
    setBusy(null)
    if (res.status === 'unavailable') { setError(unavailableMsg); return }
    if (res.status === 'error') { setError(res.message); return }
    if (!res.hits.length) { setError('No PANGAEA datasets found for that query.'); return }
    if (res.hits.length === 1) { await importId(res.hits[0].id, res.hits[0].name); return }
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
      {busy && <p className="noaa-import-status">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {results && (
        <ul className="noaa-import-results">
          {results.map(h => (
            <li key={h.id}>
              <button onClick={() => importId(h.id, h.name)} disabled={!!busy}>
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
