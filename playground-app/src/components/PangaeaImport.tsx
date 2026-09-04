import { useState } from 'react'
import { pangaeaId, pangaeaImport, type PangaeaHit } from '../lib/noaa'
import type { LipdFile } from '../types/lipd'

interface Props {
  onLoad: (lipd: LipdFile) => void
}

// PANGAEA import runs entirely through the PyleoTUPS service (no browser path).
// Keyword search isn't ready yet, so for now this imports by ID / DOI / URL
// only (the fast, reliable path). The search plumbing still lives in lib/noaa
// (pangaeaSearch); re-add the search UI here once it's ready.
export function PangaeaImport({ onLoad }: Props) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collection, setCollection] = useState<{ id: string; name?: string; members: PangaeaHit[] } | null>(null)

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
    else if (res.status === 'collection') { setCollection({ id: res.id, name: res.name, members: res.members }) }
    else if (res.status === 'unavailable') setError(unavailableMsg)
    else setError(res.message)
  }

  const submit = async () => {
    const q = query.trim()
    if (!q || busy) return
    const id = pangaeaId(q)
    if (!id) {
      setError('Enter a PANGAEA dataset ID, DOI, or URL (keyword search isn’t available yet).')
      return
    }
    setCollection(null)
    await importId(id)
  }

  return (
    <div className="noaa-import">
      <div className="noaa-import-row">
        <input
          type="text"
          placeholder="PANGAEA dataset ID, DOI, or URL"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          disabled={!!busy}
        />
        <button className="btn" onClick={submit} disabled={!!busy}>
          Import
        </button>
      </div>

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
    </div>
  )
}
