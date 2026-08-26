import { useState } from 'react'
import type { LipdFile, LipdTable } from '../types/lipd'

/** Tables the importer flagged for human review (heuristic column naming). */
export function reviewTables(lipd: LipdFile): LipdTable[] {
  return (lipd.metadata.paleoData ?? [])
    .flatMap(pd => pd.measurementTable ?? [])
    .filter(t => t.reviewNeeded)
}

const preview = (vals?: (number | string | null)[]) =>
  (vals ?? []).filter(v => v !== null && v !== undefined && v !== '').slice(0, 5).join(', ')

interface Props {
  lipd: LipdFile
  onConfirm: (lipd: LipdFile) => void
  onCancel: () => void
}

/**
 * Human-in-the-loop step for tables recovered from old files whose column names
 * had to be guessed. Shows the original file and lets the user confirm or edit
 * each column name before the dataset is loaded into the workspace.
 */
export function NoaaReviewDialog({ lipd, onConfirm, onCancel }: Props) {
  const tables = reviewTables(lipd)
  const [names, setNames] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    tables.forEach((t, ti) => t.columns.forEach((c, ci) => { init[`${ti}:${ci}`] = c.variableName }))
    return init
  })

  const confirm = () => {
    tables.forEach((t, ti) => {
      t.columns.forEach((c, ci) => {
        const n = names[`${ti}:${ci}`]?.trim()
        if (n) c.variableName = n
      })
      delete t.reviewNeeded
      delete t.sourceUrl
    })
    onConfirm(lipd)
  }

  return (
    <div className="noaa-review-overlay" role="dialog" aria-modal="true" aria-label="Review imported columns">
      <div className="noaa-review">
        <h3>Review the imported columns</h3>
        <p className="noaa-review-intro">
          {tables.length === 1 ? 'This table came' : 'These tables came'} from an older file that
          couldn&rsquo;t be read automatically, so the column names below were <strong>guessed</strong>.
          Open the original to check them, and rename anything that looks wrong before importing.
        </p>

        {tables.map((t, ti) => (
          <section key={ti} className="noaa-review-table">
            <div className="noaa-review-table-head">
              <span className="noaa-review-table-name">{t.tableName}</span>
              {t.sourceUrl && (
                <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="noaa-ext-link">
                  View original file ↗
                </a>
              )}
            </div>
            <div className="noaa-review-cols">
              <div className="noaa-review-col noaa-review-col-head">
                <span>Column name</span>
                <span>First values in this column</span>
              </div>
              {t.columns.map((c, ci) => {
                const generic = /^Var\d+$/.test(names[`${ti}:${ci}`] ?? '')
                return (
                  <label key={ci} className="noaa-review-col">
                    <input
                      className={generic ? 'noaa-review-generic' : ''}
                      value={names[`${ti}:${ci}`] ?? ''}
                      onChange={e => setNames(m => ({ ...m, [`${ti}:${ci}`]: e.target.value }))}
                      aria-label={`Name for column ${ci + 1}`}
                    />
                    <span className="noaa-review-preview" title={preview(c.values)}>
                      {preview(c.values) || '—'}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        ))}

        <div className="noaa-review-actions">
          <button type="button" className="btn" onClick={confirm}>Import with these names</button>
          <button type="button" className="noaa-review-cancel" onClick={onCancel}>Cancel import</button>
        </div>
      </div>
    </div>
  )
}
