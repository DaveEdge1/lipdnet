import { useMemo } from 'react'
import { validateLipd } from '../lib/validate'
import type { LipdMetadata } from '../types/lipd'

interface Props {
  metadata: LipdMetadata
}

export function ValidationPanel({ metadata }: Props) {
  const issues = useMemo(() => validateLipd(metadata), [metadata])
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  if (issues.length === 0) {
    return <div className="panel validation-panel empty"><p>✓ No issues found.</p></div>
  }

  return (
    <div className="panel validation-panel">
      <h2>Validation</h2>
      <div className="issue-summary">
        {errors.length > 0 && <span className="badge error">{errors.length} error{errors.length !== 1 ? 's' : ''}</span>}
        {warnings.length > 0 && <span className="badge warning">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>}
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
