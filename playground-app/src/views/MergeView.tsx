import { useMemo, useState } from 'react'
import { parseLipd, serializeLipd } from '../lib/lipd'
import { diffMetadata, applyResolutions, renderSide, type Resolution } from '../lib/diff'
import type { LipdFile } from '../types/lipd'

function FileSlot({ label, file, onLoad }: {
  label: string
  file: LipdFile | null
  onLoad: (f: LipdFile) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const handle = async (f: File | undefined) => {
    if (!f) return
    setError(null)
    try {
      onLoad(await parseLipd(f))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    }
  }
  return (
    <div className={`merge-slot ${file ? 'loaded' : ''}`}>
      <span className="merge-slot-label">{label}</span>
      {file ? (
        <span className="merge-slot-file">{file.filename}</span>
      ) : (
        <label className="btn">
          Choose .lpd
          <input type="file" accept=".lpd" style={{ display: 'none' }}
            onChange={e => handle(e.target.files?.[0])} />
        </label>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function MergeView() {
  const [fileA, setFileA] = useState<LipdFile | null>(null)
  const [fileB, setFileB] = useState<LipdFile | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [saving, setSaving] = useState(false)

  const diffs = useMemo(
    () => (fileA && fileB ? diffMetadata(fileA.metadata, fileB.metadata) : []),
    [fileA, fileB]
  )

  const resolve = (label: string, r: Resolution) =>
    setResolutions(prev => ({ ...prev, [label]: r }))

  const resolveAll = (r: Resolution) =>
    setResolutions(Object.fromEntries(diffs.map(d => [d.label, r])))

  const saveMerged = async () => {
    if (!fileA || !fileB) return
    setSaving(true)
    try {
      const metadata = applyResolutions(fileA.metadata, diffs, resolutions)
      const merged: LipdFile = {
        metadata,
        filename: fileA.filename.replace(/\.lpd$/i, '') + '.merged.lpd',
        // keep any CSVs that aren't regenerated from columns (e.g. ensembles)
        csvData: { ...fileB.csvData, ...fileA.csvData },
      }
      const blob = await serializeLipd(merged)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = merged.filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app merge-page">
      <div className="merge-header">
        <h2>Merge Datasets</h2>
        <p className="query-hint">
          Load two versions of a dataset, review their differences, choose which value
          wins for each, and download the merged .lpd. File 1 is the base — unresolved
          differences keep File 1's value.
        </p>
        <div className="merge-slots">
          <FileSlot label="File 1 (base)" file={fileA} onLoad={f => { setFileA(f); setResolutions({}) }} />
          <FileSlot label="File 2" file={fileB} onLoad={f => { setFileB(f); setResolutions({}) }} />
          {(fileA || fileB) && (
            <button className="btn-close" onClick={() => { setFileA(null); setFileB(null); setResolutions({}) }}>
              Reset
            </button>
          )}
        </div>
      </div>

      {fileA && fileB && (
        <div className="merge-body">
          <div className="merge-toolbar">
            <span>{diffs.length} difference{diffs.length === 1 ? '' : 's'}</span>
            {diffs.length > 0 && (
              <>
                <button onClick={() => resolveAll('a')}>All from File 1</button>
                <button onClick={() => resolveAll('b')}>All from File 2</button>
              </>
            )}
            <button className="btn-save" onClick={saveMerged} disabled={saving}>
              {saving ? 'Saving…' : 'Download merged .lpd'}
            </button>
          </div>

          {diffs.length === 0 ? (
            <p className="query-empty">The two files have identical metadata.</p>
          ) : (
            <ul className="merge-diff-list">
              {diffs.map(d => {
                const r = resolutions[d.label] ?? 'a'
                return (
                  <li key={d.label}>
                    <div className="merge-diff-path">{d.label}</div>
                    <div className="merge-diff-options">
                      <label className={r === 'a' ? 'chosen' : ''}>
                        <input type="radio" name={d.label} checked={r === 'a'}
                          onChange={() => resolve(d.label, 'a')} />
                        <span className="merge-diff-side">File 1:</span> {renderSide(d.a)}
                      </label>
                      <label className={r === 'b' ? 'chosen' : ''}>
                        <input type="radio" name={d.label} checked={r === 'b'}
                          onChange={() => resolve(d.label, 'b')} />
                        <span className="merge-diff-side">File 2:</span> {renderSide(d.b)}
                      </label>
                      <label className={r === 'remove' ? 'chosen' : ''}>
                        <input type="radio" name={d.label} checked={r === 'remove'}
                          onChange={() => resolve(d.label, 'remove')} />
                        <span className="merge-diff-side">Remove field</span>
                      </label>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
