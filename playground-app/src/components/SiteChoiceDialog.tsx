import type { ServiceSite } from '../lib/noaa'

interface Props {
  studyName: string
  sites: ServiceSite[]
  tableCounts: Record<string, number>
  onChoose: (mode: 'collapse' | 'per-site') => void
  onCancel: () => void
}

function coords(site: ServiceSite): string {
  if (site.latitude == null || site.longitude == null) return 'no coordinates'
  const lat = `${Math.abs(site.latitude).toFixed(2)}°${site.latitude >= 0 ? 'N' : 'S'}`
  const lon = `${Math.abs(site.longitude).toFixed(2)}°${site.longitude >= 0 ? 'E' : 'W'}`
  return site.elevation != null ? `${lat}, ${lon} · ${site.elevation} m` : `${lat}, ${lon}`
}

// A NOAA study can cover many sites, and the two sensible ways to land that in
// LiPD are genuinely different datasets — so ask rather than guess (issue #14).
export function SiteChoiceDialog({ studyName, sites, tableCounts, onChoose, onCancel }: Props) {
  const total = Object.values(tableCounts).reduce((a, b) => a + b, 0)
  return (
    <div className="welcome-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="welcome-card site-choice" role="dialog" aria-modal="true" aria-labelledby="site-choice-title">
        <button className="welcome-close" onClick={onCancel} aria-label="Cancel import">×</button>
        <p className="welcome-eyebrow">NOAA import</p>
        <h2 id="site-choice-title">This study covers {sites.length} sites</h2>
        <p className="welcome-dek">
          <strong>{studyName}</strong> has {total} data {total === 1 ? 'table' : 'tables'} spread
          across {sites.length} sites. How should that become LiPD?
        </p>

        <ul className="site-choice-list">
          {sites.map(site => (
            <li key={site.key}>
              <span className="site-choice-name">{site.siteName || '(unnamed site)'}</span>
              <span className="site-choice-meta">
                {coords(site)} · {tableCounts[site.key] ?? 0} {(tableCounts[site.key] ?? 0) === 1 ? 'table' : 'tables'}
              </span>
            </li>
          ))}
        </ul>

        <div className="site-choice-actions">
          <button className="btn site-choice-option" onClick={() => onChoose('per-site')}>
            <span className="site-choice-option-title">One dataset per site</span>
            <span className="site-choice-option-sub">
              {sites.length} separate LiPD datasets, each with its own coordinates. The cleanest fit
              to the format. All are saved to this browser and the first opens for editing.
            </span>
          </button>
          <button className="btn btn-secondary site-choice-option" onClick={() => onChoose('collapse')}>
            <span className="site-choice-option-title">Collapse into one dataset</span>
            <span className="site-choice-option-sub">
              One LiPD dataset, one PaleoData object per site, located by the area the sites cover.
              Each table gains latitude, longitude, and elevation columns so a row still traces back
              to its site.
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
