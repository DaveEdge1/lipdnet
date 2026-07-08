import type { LipdMetadata } from '../types/lipd'
import { getSiteName } from '../lib/lipd'

interface Props {
  metadata: LipdMetadata
  onChange: (updated: LipdMetadata) => void
}

function Field({ label, value, onEdit }: { label: string; value: string; onEdit: (v: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} onChange={e => onEdit(e.target.value)} />
    </div>
  )
}

export function MetadataPanel({ metadata, onChange }: Props) {
  const set = (key: string, value: unknown) => onChange({ ...metadata, [key]: value })

  const pub = metadata.pub?.[0] ?? {}
  const setPub = (key: string, value: unknown) => {
    const pubs = [...(metadata.pub ?? [{}])]
    pubs[0] = { ...pubs[0], [key]: value }
    onChange({ ...metadata, pub: pubs })
  }

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
  const setSiteName = (name: string) => {
    onChange({
      ...metadata,
      geo: {
        ...geo,
        properties: { ...(geo.properties ?? {}), siteName: name },
      },
    })
  }

  const authorStr = Array.isArray(pub.author)
    ? pub.author.map((a: { name: string }) => a.name).join('; ')
    : typeof pub.author === 'string' ? pub.author : ''

  const setAuthors = (str: string) => {
    const authors = str.split(';').map(s => ({ name: s.trim() })).filter(a => a.name)
    setPub('author', authors)
  }

  const doi = (pub.doi ?? pub.DOI ?? '') as string

  return (
    <div className="panel metadata-panel">
      <h2>Metadata</h2>

      <section>
        <h3>Dataset</h3>
        <Field label="Name" value={metadata.dataSetName ?? ''} onEdit={v => set('dataSetName', v)} />
        <Field label="Archive type" value={metadata.archiveType ?? ''} onEdit={v => set('archiveType', v)} />
        <Field label="Investigators" value={metadata.investigators ?? ''} onEdit={v => set('investigators', v)} />
        <div className="field">
          <label>Dataset ID</label>
          <input value={metadata.datasetId ?? ''} readOnly className="readonly" />
        </div>
      </section>

      <section>
        <h3>Site</h3>
        <Field label="Site name" value={getSiteName(metadata)} onEdit={setSiteName} />
        <Field label="Longitude" value={String(coords[0] ?? '')} onEdit={v => setCoord(0, Number(v))} />
        <Field label="Latitude" value={String(coords[1] ?? '')} onEdit={v => setCoord(1, Number(v))} />
        <Field label="Elevation (m)" value={String(coords[2] ?? '')} onEdit={v => setCoord(2, Number(v))} />
      </section>

      <section>
        <h3>Publication</h3>
        <Field label="Title" value={(pub.title ?? '') as string} onEdit={v => setPub('title', v)} />
        <Field label="Authors (semicolon-separated)" value={authorStr} onEdit={setAuthors} />
        <Field label="Journal" value={(pub.journal ?? '') as string} onEdit={v => setPub('journal', v)} />
        <Field label="Year" value={String(pub.year ?? '')} onEdit={v => setPub('year', Number(v) || v)} />
        <Field label="DOI" value={doi} onEdit={v => { setPub('doi', v); setPub('DOI', undefined) }} />
      </section>
    </div>
  )
}
