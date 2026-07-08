import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { proxiedLpdUrl } from '../lib/remote'
import type { DatasetResult } from '../lib/sparql'

// Fix default marker icons broken by bundlers (same as SiteMap)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow })

interface Props {
  results: DatasetResult[]
}

export function QueryMap({ results }: Props) {
  const located = useMemo(
    () => results.filter(r => r.lat !== undefined && r.lon !== undefined),
    [results]
  )

  if (!located.length) {
    return <p className="query-empty">None of these results have coordinates to map.</p>
  }

  const bounds = L.latLngBounds(located.map(r => [r.lat!, r.lon!] as [number, number])).pad(0.2)

  return (
    <div className="query-map">
      {located.length < results.length && (
        <p className="query-map-note">
          {located.length} of {results.length} results have coordinates
        </p>
      )}
      <MapContainer
        bounds={bounds}
        style={{ width: '100%', flex: 1, minHeight: 0 }}
        key={located.map(r => r.name).join('|')}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {located.map(r => (
          <Marker key={r.name} position={[r.lat!, r.lon!]}>
            <Popup>
              <strong>{r.name}</strong>
              {r.archiveType && <><br />{r.archiveType.replace(/([a-z])([A-Z])/g, '$1 $2')}</>}
              {r.minYear !== undefined && r.maxYear !== undefined && (
                <><br />{Math.round(r.minYear)}–{Math.round(r.maxYear)} CE</>
              )}
              <br />
              {r.lipdverseLink && (
                <a href={r.lipdverseLink} target="_blank" rel="noreferrer">LiPDverse</a>
              )}
              {r.downloadUrl && (
                <>
                  {r.lipdverseLink && ' · '}
                  <a href={proxiedLpdUrl(r.downloadUrl)} download={`${r.name}.lpd`}>Download</a>
                  {' · '}
                  <a href={`/playground?open=${encodeURIComponent(r.downloadUrl)}`}>Open in playground</a>
                </>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
