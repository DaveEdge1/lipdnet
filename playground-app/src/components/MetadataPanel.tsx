import { useState } from 'react'
import type { LipdMetadata, LipdPub } from '../types/lipd'
import { getSiteName } from '../lib/lipd'
import { fetchDoiMetadata } from '../lib/crossref'
import { ARCHIVE_TYPES_CANONICAL } from '../lib/vocabulary'

interface Props {
  metadata: LipdMetadata
  onChange: (updated: LipdMetadata) => void
}

function Field({ label, value, onEdit, textarea }: {
  label: string
  value: string
  onEdit: (v: string) => void
  textarea?: boolean
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {textarea
        ? <textarea rows={3} value={value} onChange={e => onEdit(e.target.value)} />
        : <input value={value} onChange={e => onEdit(e.target.value)} />}
    </div>
  )
}

// ---- DMS ↔ decimal ----------------------------------------------------------

interface Dms { d: string; m: string; s: string; neg: boolean }

function toDms(decimal: number): Dms {
  const neg = decimal < 0
  const abs = Math.abs(decimal)
  const d = Math.floor(abs)
  const mFloat = (abs - d) * 60
  const m = Math.floor(mFloat)
  const s = Math.round((mFloat - m) * 60 * 100) / 100
  return { d: String(d), m: String(m), s: String(s), neg }
}

function fromDms(dms: Dms): number {
  const d = Number(dms.d) || 0
  const m = Number(dms.m) || 0
  const s = Number(dms.s) || 0
  const val = d + m / 60 + s / 3600
  return Math.round((dms.neg ? -val : val) * 10000) / 10000
}

function DmsInput({ label, value, hemis, onCommit }: {
  label: string
  value: number
  hemis: [string, string]   // [positive, negative] e.g. ['N', 'S']
  onCommit: (decimal: number) => void
}) {
  const [dms, setDms] = useState<Dms>(() => toDms(value))
  const update = (patch: Partial<Dms>) => {
    const next = { ...dms, ...patch }
    setDms(next)
    onCommit(fromDms(next))
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className="dms-row">
        <input type="number" min="0" value={dms.d} onChange={e => update({ d: e.target.value })} title="Degrees" />
        <span className="dms-unit">°</span>
        <input type="number" min="0" max="59" value={dms.m} onChange={e => update({ m: e.target.value })} title="Minutes" />
        <span className="dms-unit">′</span>
        <input type="number" min="0" max="59.99" step="0.01" value={dms.s} onChange={e => update({ s: e.target.value })} title="Seconds" />
        <span className="dms-unit">″</span>
        <select value={dms.neg ? hemis[1] : hemis[0]} onChange={e => update({ neg: e.target.value === hemis[1] })}>
          <option value={hemis[0]}>{hemis[0]}</option>
          <option value={hemis[1]}>{hemis[1]}</option>
        </select>
      </div>
    </div>
  )
}

// ---- Panel -------------------------------------------------------------------

export function MetadataPanel({ metadata, onChange }: Props) {
  const set = (key: string, value: unknown) => onChange({ ...metadata, [key]: value })
  const [dmsMode, setDmsMode] = useState(false)
  const [doiStatus, setDoiStatus] = useState<Record<number, string>>({})

  // -- geo ---------------------------------------------------------------------
  const geo = metadata.geo ?? {}
  const coords = geo.geometry?.coordinates ?? [geo.longitude ?? 0, geo.latitude ?? 0, geo.elevation ?? 0]
  const setCoord = (idx: number, value: number) => {
    const newCoords = [...coords] as [number, number, number]
    newCoords[idx] = value
    onChange({
      ...metadata,
      geo: {
        ...geo,
        geometry: { type: 'Point', coordinates: newCoords },
        properties: geo.properties ?? {},
      },
    })
  }
  const setGeoProp = (key: string, value: string) => {
    onChange({
      ...metadata,
      geo: { ...geo, properties: { ...(geo.properties ?? {}), [key]: value } },
    })
  }

  // -- publications --------------------------------------------------------------
  const pubs = metadata.pub ?? []
  const setPub = (idx: number, patch: Partial<LipdPub>) => {
    const next = [...pubs]
    next[idx] = { ...next[idx], ...patch }
    onChange({ ...metadata, pub: next })
  }
  const addPub = () => onChange({ ...metadata, pub: [...pubs, {}] })
  const removePub = (idx: number) => {
    const next = [...pubs]
    next.splice(idx, 1)
    onChange({ ...metadata, pub: next })
  }
  const authorStr = (pub: LipdPub) =>
    Array.isArray(pub.author)
      ? pub.author.map(a => a.name).join('; ')
      : typeof pub.author === 'string' ? pub.author : ''
  const setAuthors = (idx: number, str: string) => {
    setPub(idx, { author: str.split(';').map(s => ({ name: s.trim() })).filter(a => a.name) })
  }

  const autofillDoi = async (idx: number) => {
    const pub = pubs[idx]
    const doi = (pub?.doi ?? pub?.DOI ?? '') as string
    setDoiStatus(s => ({ ...s, [idx]: 'Looking up…' }))
    try {
      const fetched = await fetchDoiMetadata(doi)
      // Merge: CrossRef fills gaps and refreshes core fields, but never blanks one
      const merged: Partial<LipdPub> = { ...fetched }
      for (const k of Object.keys(merged) as Array<keyof LipdPub>) {
        if (merged[k] == null || merged[k] === '') delete merged[k]
      }
      setPub(idx, { ...merged, DOI: undefined })
      setDoiStatus(s => ({ ...s, [idx]: '✓ Filled from CrossRef — please verify' }))
    } catch (e) {
      setDoiStatus(s => ({ ...s, [idx]: e instanceof Error ? e.message : 'Lookup failed' }))
    }
  }

  // -- funding -------------------------------------------------------------------
  const funding = (metadata.funding ?? []) as Array<Record<string, unknown>>
  const setFunding = (idx: number, key: string, value: string) => {
    const next = [...funding]
    next[idx] = { ...next[idx], [key]: value }
    onChange({ ...metadata, funding: next })
  }
  const addFunding = () => onChange({ ...metadata, funding: [...funding, {}] })
  const removeFunding = (idx: number) => {
    const next = [...funding]
    next.splice(idx, 1)
    onChange({ ...metadata, funding: next.length ? next : undefined })
  }

  // -- NOAA online resources -------------------------------------------------------
  const onlineRes = (metadata.onlineResource ?? []) as Array<{ onlineResource?: string; description?: string }>
  const setOnlineRes = (idx: number, key: 'onlineResource' | 'description', value: string) => {
    const next = [...onlineRes]
    next[idx] = { ...next[idx], [key]: value }
    onChange({ ...metadata, onlineResource: next })
  }

  return (
    <div className="panel metadata-panel">
      <h2>Metadata</h2>

      <section>
        <h3>Dataset</h3>
        <Field label="Name" value={metadata.dataSetName ?? ''} onEdit={v => set('dataSetName', v)} />
        <div className="field">
          <label>Archive type</label>
          <input
            list="archive-list"
            value={metadata.archiveType ?? ''}
            onChange={e => set('archiveType', e.target.value)}
          />
          <datalist id="archive-list">
            {ARCHIVE_TYPES_CANONICAL.map(a => <option key={a} value={a} />)}
          </datalist>
        </div>
        <Field label="Investigators" value={metadata.investigators ?? ''} onEdit={v => set('investigators', v)} />
        <Field label="Created by" value={metadata.createdBy ?? ''} onEdit={v => set('createdBy', v)} />
        <Field label="Notes" value={(metadata.notes ?? '') as string} onEdit={v => set('notes', v)} textarea />
        <div className="field">
          <label>Dataset ID</label>
          <input value={metadata.datasetId ?? ''} readOnly className="readonly" />
        </div>
      </section>

      <section>
        <div className="section-header-row">
          <h3>Site</h3>
          <button
            className="btn-mini"
            onClick={() => setDmsMode(m => !m)}
            title="Switch coordinate entry between decimal degrees and degrees-minutes-seconds (stored as decimal)"
          >
            {dmsMode ? 'Use decimal' : 'Use ° ′ ″'}
          </button>
        </div>
        <Field label="Site name" value={getSiteName(metadata)} onEdit={v => setGeoProp('siteName', v)} />
        {dmsMode ? (
          <>
            <DmsInput key={`lat${coords[1]}`} label="Latitude" value={Number(coords[1]) || 0} hemis={['N', 'S']} onCommit={v => setCoord(1, v)} />
            <DmsInput key={`lon${coords[0]}`} label="Longitude" value={Number(coords[0]) || 0} hemis={['E', 'W']} onCommit={v => setCoord(0, v)} />
          </>
        ) : (
          <>
            <Field label="Latitude" value={String(coords[1] ?? '')} onEdit={v => setCoord(1, Number(v))} />
            <Field label="Longitude" value={String(coords[0] ?? '')} onEdit={v => setCoord(0, Number(v))} />
          </>
        )}
        <Field label="Elevation (m)" value={String(coords[2] ?? '')} onEdit={v => setCoord(2, Number(v))} />
        <Field label="Location" value={(geo.properties?.location ?? '') as string} onEdit={v => setGeoProp('location', v)} />
      </section>

      <section>
        <div className="section-header-row">
          <h3>Publications</h3>
          <button className="btn-mini" onClick={addPub}>+ Add</button>
        </div>
        {pubs.length === 0 && <p className="section-empty">No publications yet.</p>}
        {pubs.map((pub, i) => (
          <div className="sub-card" key={i}>
            <div className="sub-card-head">
              <span>Publication {i + 1}</span>
              <button className="btn-remove-field" onClick={() => removePub(i)} title="Remove this publication">×</button>
            </div>
            <div className="field">
              <label>DOI</label>
              <div className="field-extra-row">
                <input
                  value={(pub.doi ?? pub.DOI ?? '') as string}
                  onChange={e => setPub(i, { doi: e.target.value, DOI: undefined })}
                  placeholder="10.xxxx/xxxxx"
                />
                <button
                  className="btn-add-field"
                  onClick={() => autofillDoi(i)}
                  disabled={!(pub.doi ?? pub.DOI)}
                  title="Fill title, authors, journal, year, volume, and pages from the CrossRef record for this DOI"
                >
                  Autofill
                </button>
              </div>
              {doiStatus[i] && <span className="doi-status">{doiStatus[i]}</span>}
            </div>
            <Field label="Title" value={(pub.title ?? '') as string} onEdit={v => setPub(i, { title: v })} />
            <Field label="Authors (semicolon-separated)" value={authorStr(pub)} onEdit={v => setAuthors(i, v)} />
            <Field label="Journal" value={(pub.journal ?? '') as string} onEdit={v => setPub(i, { journal: v })} />
            <div className="field-grid-3">
              <Field label="Year" value={String(pub.year ?? '')} onEdit={v => setPub(i, { year: Number(v) || v })} />
              <Field label="Volume" value={(pub.volume ?? '') as string} onEdit={v => setPub(i, { volume: v })} />
              <Field label="Pages" value={(pub.pages ?? '') as string} onEdit={v => setPub(i, { pages: v })} />
            </div>
            <Field label="Abstract" value={(pub.abstract ?? '') as string} onEdit={v => setPub(i, { abstract: v })} textarea />
          </div>
        ))}
      </section>

      <section>
        <div className="section-header-row">
          <h3>Funding</h3>
          <button className="btn-mini" onClick={addFunding}>+ Add</button>
        </div>
        {funding.length === 0 && <p className="section-empty">No funding entries yet.</p>}
        {funding.map((f, i) => (
          <div className="sub-card" key={i}>
            <div className="sub-card-head">
              <span>Funding {i + 1}</span>
              <button className="btn-remove-field" onClick={() => removeFunding(i)} title="Remove this funding entry">×</button>
            </div>
            <div className="field-grid-2">
              <Field label="Agency" value={(f.agency ?? '') as string} onEdit={v => setFunding(i, 'agency', v)} />
              <Field label="Grant" value={(f.grant ?? '') as string} onEdit={v => setFunding(i, 'grant', v)} />
            </div>
            <div className="field-grid-2">
              <Field label="Principal investigator" value={(f.investigator ?? '') as string} onEdit={v => setFunding(i, 'investigator', v)} />
              <Field label="Country" value={(f.country ?? '') as string} onEdit={v => setFunding(i, 'country', v)} />
            </div>
          </div>
        ))}
      </section>

      <details className="noaa-details">
        <summary>NOAA submission fields</summary>
        <p className="section-hint">
          Used by the NOAA .txt export and the NOAA checks in the Issues tab.
        </p>
        <div className="field-grid-3">
          <Field label="Earliest year" value={String(metadata.earliestYear ?? '')} onEdit={v => set('earliestYear', Number(v) || v || undefined)} />
          <Field label="Most recent year" value={String(metadata.mostRecentYear ?? '')} onEdit={v => set('mostRecentYear', Number(v) || v || undefined)} />
          <Field label="Time unit" value={(metadata.timeUnit ?? '') as string} onEdit={v => set('timeUnit', v || undefined)} />
        </div>
        <Field label="Dataset DOI" value={(metadata.datasetDOI ?? '') as string} onEdit={v => set('datasetDOI', v || undefined)} />
        <Field label="Original source URL" value={(metadata.originalDataUrl ?? '') as string} onEdit={v => set('originalDataUrl', v || undefined)} />
        <div className="section-header-row">
          <h3>Online resources</h3>
          <button className="btn-mini" onClick={() => onChange({ ...metadata, onlineResource: [...onlineRes, {}] })}>+ Add</button>
        </div>
        {onlineRes.map((r, i) => (
          <div className="sub-card" key={i}>
            <div className="sub-card-head">
              <span>Resource {i + 1}</span>
              <button className="btn-remove-field" onClick={() => {
                const next = [...onlineRes]
                next.splice(i, 1)
                onChange({ ...metadata, onlineResource: next.length ? next : undefined })
              }} title="Remove this resource">×</button>
            </div>
            <Field label="URL" value={r.onlineResource ?? ''} onEdit={v => setOnlineRes(i, 'onlineResource', v)} />
            <Field label="Description" value={r.description ?? ''} onEdit={v => setOnlineRes(i, 'description', v)} />
          </div>
        ))}
      </details>
    </div>
  )
}
