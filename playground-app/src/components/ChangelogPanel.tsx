import { useState } from 'react'
import type { LipdMetadata } from '../types/lipd'

interface Props {
  metadata: LipdMetadata
}

// Fields shown inline in the header row — omit from expanded body
const HEADER_FIELDS = new Set(['version', 'date', 'name', 'curator', 'timestamp'])

// Flatten lipdR-style matrix arrays: [["a"], ["b"]] → ["a", "b"]
// or plain arrays: ["a", "b"] → ["a", "b"]
function flattenItems(val: unknown): string[] {
  if (!Array.isArray(val)) return [String(val)]
  return val.flatMap(item =>
    Array.isArray(item) ? item.map(String) : [String(item)]
  )
}

function renderValue(_key: string, val: unknown) {
  // Object with string keys → change-type groups (lipdR `changes` field)
  if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
    const entries = Object.entries(val as Record<string, unknown>)
    if (entries.length === 0) return <span className="changelog-detail-empty">—</span>
    return (
      <div className="changelog-changes">
        {entries.map(([type, items]) => (
          <div key={type} className="changelog-change-group">
            <span className="changelog-change-type">{type}</span>
            <ul className="changelog-change-list">
              {flattenItems(items).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    )
  }

  // Plain array
  if (Array.isArray(val)) {
    const items = flattenItems(val)
    return (
      <ul className="changelog-change-list">
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    )
  }

  // Primitive
  const str = String(val ?? '')
  return <span className="changelog-detail-val">{str || <em className="changelog-detail-empty">—</em>}</span>
}

export function ChangelogPanel({ metadata }: Props) {
  const entries = [...(metadata.changelog ?? [])].reverse()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  function toggle(i: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  return (
    <div className="panel changelog-panel">
      <h2>Changelog</h2>

      {entries.length === 0 ? (
        <p className="changelog-empty">No entries yet. One is added automatically each time you save changes.</p>
      ) : (
        <ol className="changelog-timeline">
          {entries.map((entry, i) => {
            const isOpen = expanded.has(i)
            const raw = entry as Record<string, unknown>
            // Separate header fields from body fields
            const bodyFields = Object.entries(raw).filter(([k]) => !HEADER_FIELDS.has(k))
            // Prefer showing `changes` first, then `notes`, then anything else
            const ordered = [
              ...bodyFields.filter(([k]) => k === 'changes'),
              ...bodyFields.filter(([k]) => k === 'notes'),
              ...bodyFields.filter(([k]) => k !== 'changes' && k !== 'notes'),
            ]
            // Show curator/timestamp from header fields if present
            const curator = raw.curator as string | undefined
            const timestamp = raw.timestamp as string | undefined

            return (
              <li key={i} className="changelog-entry">
                <div className="changelog-spine">
                  <div className={`changelog-dot${isOpen ? ' changelog-dot-open' : ''}`} />
                  {i < entries.length - 1 && <div className="changelog-line" />}
                </div>
                <div className="changelog-body">
                  <button
                    className="changelog-header"
                    onClick={() => toggle(i)}
                    aria-expanded={isOpen}
                  >
                    <span className="changelog-version">v{entry.version}</span>
                    <span className="changelog-date">{entry.date ?? timestamp?.slice(0, 10)}</span>
                    <span className="changelog-author">{entry.name ?? curator}</span>
                    <span className="changelog-chevron">{isOpen ? '▾' : '▸'}</span>
                  </button>

                  {isOpen && (
                    <div className="changelog-detail">
                      {ordered.length > 0 ? ordered.map(([k, v]) => (
                        <div key={k} className="changelog-detail-section">
                          {k !== 'notes' && (
                            <span className="changelog-detail-key">{k}</span>
                          )}
                          {renderValue(k, v)}
                        </div>
                      )) : (
                        <span className="changelog-detail-empty">No details recorded.</span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
