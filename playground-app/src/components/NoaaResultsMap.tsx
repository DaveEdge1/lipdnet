import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import type { NoaaStudy } from '../lib/noaa'

// Fix default marker icons broken by bundlers (same as QueryMap / SiteMap)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow })

// Two icons: the plain default, and a tinted+glowing one for the selected study
// (styled via the .noaa-marker-selected class — see App.css). Filter-only, no
// transform, since Leaflet positions markers with a transform of its own.
const DEFAULT_ICON = new L.Icon.Default()
const SELECTED_ICON = new L.Icon({
  iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
  className: 'noaa-marker-selected',
})

const SMALL = new Set(['and', 'of', 'the', 'in', 'for', 'to', 'a', 'on'])
const prettyArchive = (dt?: string) => !dt ? '' : dt.toLowerCase().split(/\s+/)
  .map((w, i) => (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

/** Primary-site point for a study. NOAA POINT coords are [lat, lon] strings. */
function primaryCoords(s: NoaaStudy): [number, number] | null {
  const geom = s.site?.[0]?.geo?.geometry
  if (!geom || String(geom.type).toUpperCase() !== 'POINT') return null
  const c = geom.coordinates
  if (!c || c.length < 2) return null
  const lat = Number(c[0]), lon = Number(c[1])
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return [lat, lon]
}

interface Props {
  results: NoaaStudy[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function NoaaResultsMap({ results, selectedId, onSelect }: Props) {
  const located = useMemo(
    () => results
      .map(s => ({ s, pos: primaryCoords(s) }))
      .filter((x): x is { s: NoaaStudy; pos: [number, number] } => x.pos !== null),
    [results],
  )

  // Keep the Leaflet marker instances so we can open the selected study's popup
  // programmatically — on list selection and on a restored "back to search".
  const markerRefs = useRef<Record<string, L.Marker>>({})
  useEffect(() => {
    if (!selectedId) return
    const t = window.setTimeout(() => {
      markerRefs.current[selectedId]?.openPopup()  // autoPan brings it into view
    }, 60)
    return () => window.clearTimeout(t)
  }, [selectedId, located])

  if (!located.length) return null

  const bounds = L.latLngBounds(located.map(x => x.pos)).pad(0.25)

  return (
    <div className="noaa-map-wrap">
      {located.length < results.length && (
        <p className="noaa-map-note">{located.length} of {results.length} results are mapped (others lack point coordinates).</p>
      )}
      <div className="noaa-map">
        <MapContainer
          bounds={bounds}
          scrollWheelZoom={false}
          style={{ width: '100%', height: '100%' }}
          key={located.map(x => x.s.NOAAStudyId).join('|')}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {located.map(({ s, pos }) => {
            const selected = selectedId === s.NOAAStudyId
            return (
              <Marker
                key={s.NOAAStudyId}
                position={pos}
                icon={selected ? SELECTED_ICON : DEFAULT_ICON}
                zIndexOffset={selected ? 1000 : 0}
                ref={m => { if (m) markerRefs.current[s.NOAAStudyId] = m; else delete markerRefs.current[s.NOAAStudyId] }}
                eventHandlers={{ click: () => onSelect(s.NOAAStudyId) }}
              >
                <Popup>
                  <strong>{s.studyName}</strong>
                  {s.dataType && <><br />{prettyArchive(s.dataType)}</>}
                  {s.earliestYearCE != null && s.mostRecentYearCE != null && (
                    <><br />{s.earliestYearCE}–{s.mostRecentYearCE} CE</>
                  )}
                  <br />NOAA {s.NOAAStudyId}
                  <br /><button type="button" className="noaa-map-select" onClick={() => onSelect(s.NOAAStudyId)}>Preview below ↓</button>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
