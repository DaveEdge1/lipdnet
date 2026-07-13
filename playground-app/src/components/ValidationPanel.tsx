import { useMemo, useState } from 'react'
import { validateLipd, validateNoaa } from '../lib/validate'
import type { LipdMetadata } from '../types/lipd'

interface Props {
  metadata: LipdMetadata
}

const NOAA_PROFILE_KEY = 'pg-noaa-profile'

export function ValidationPanel({ metadata }: Props) {
  // Optional stricter profile: what a NOAA WDS-Paleo submission expects
  const [noaaProfile, setNoaaProfile] = useState(() => {
    try { return localStorage.getItem(NOAA_PROFILE_KEY) === 'on' } catch { return false }
  })
  const toggleNoaa = () => {
    setNoaaProfile(v => {
      try { localStorage.setItem(NOAA_PROFILE_KEY, v ? 'off' : 'on') } catch { /* private mode */ }
      return !v
    })
  }

  const issues = useMemo(() => {
    const base = validateLipd(metadata)
    return noaaProfile ? [...base, ...validateNoaa(metadata)] : base
  }, [metadata, noaaProfile])

  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  const profileToggle = (
    <label className="noaa-profile-toggle" title="Also check the fields NOAA's WDS-Paleo submission template requires (investigators, time coverage, publication, site details…)">
      <input type="checkbox" checked={noaaProfile} onChange={toggleNoaa} />
      NOAA submission checks
    </label>
  )

  if (issues.length === 0) {
    return (
      <div className="panel validation-panel empty">
        <p>✓ No issues found.</p>
        {profileToggle}
      </div>
    )
  }

  return (
    <div className="panel validation-panel">
      <h2>Validation</h2>
      <div className="issue-summary">
        {errors.length > 0 && <span className="badge error">{errors.length} error{errors.length !== 1 ? 's' : ''}</span>}
        {warnings.length > 0 && <span className="badge warning">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>}
        {profileToggle}
      </div>

      {errors.length > 0 && (
        <section>
          <h3>Errors</h3>
          <ul className="issue-list">
            {errors.map((issue, i) => (
              <li key={i} className="issue error">
                <span className="issue-path">{issue.path}</span>
                <span className="issue-msg">{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section>
          <h3>Warnings</h3>
          <ul className="issue-list">
            {warnings.map((issue, i) => (
              <li key={i} className="issue warning">
                <span className="issue-path">{issue.path}</span>
                <span className="issue-msg">{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
