import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { getSiteName, getCoordinates } from '../lib/lipd'
import type { LipdMetadata } from '../types/lipd'

// Fix default marker icons broken by bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow })

interface Props {
  metadata: LipdMetadata
}

export function SiteMap({ metadata }: Props) {
  const coords = getCoordinates(metadata)
  const siteName = getSiteName(metadata)

  if (!coords) {
    return <div className="panel map-panel empty"><p>No coordinates available.</p></div>
  }

  return (
    <div className="panel map-panel">
      <MapContainer center={coords} zoom={5} style={{ width: '100%', height: '100%' }} key={coords.join(',')}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={coords}>
          <Popup>{siteName}<br />{coords[0].toFixed(3)}°N, {coords[1].toFixed(3)}°E</Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
