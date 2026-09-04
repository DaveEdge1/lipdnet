// Editor view that shows the original NOAA text file(s) behind a dataset that
// was imported from NOAA. Text comes from one of two sources, in order:
//   1. captured in memory at import (lipd.noaaFiles) — instant, and the only
//      source for locally-opened NOAA .txt files;
//   2. fetched on demand from NCEI by study id — covers service imports and
//      datasets reloaded from a save/library (where only NOAAStudyId survives).
// Fetches are cached per session; a blocked fetch falls back to a link-out.
import { useCallback, useEffect, useState } from 'react'
import type { NoaaSourceFile } from '../types/lipd'
import { listNoaaStudyFiles, fetchNoaaFileText } from '../lib/noaa'

const textCache = new Map<string, string>()               // url -> text
const fileListCache = new Map<string, NoaaSourceFile[]>()  // studyId -> files
const TEXT_EXT = /\.(txt|csv|tsv|dat|text)$/i
// A file we can render inline: captured text, or a text-like URL to fetch.
const looksTextual = (f: NoaaSourceFile) => f.text !== undefined || !f.url || TEXT_EXT.test(f.url)

interface Props {
  sourceFiles?: NoaaSourceFile[]
  studyId?: string
  originalUrl?: string
}

export function NoaaTextView({ sourceFiles, studyId, originalUrl }: Props) {
  const studyUrl = originalUrl
    || (studyId ? `https://www.ncei.noaa.gov/access/paleo-search/study/${studyId}` : undefined)

  // File list: captured at import, else the session cache, else fetched by id.
  // (The component is keyed per dataset in PlaygroundView, so this resolves once.)
  const initial: NoaaSourceFile[] | null = sourceFiles?.length
    ? sourceFiles
    : (studyId ? fileListCache.get(studyId) ?? null : [])
  const [files, setFiles] = useState<NoaaSourceFile[] | null>(initial)
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (files !== null) return
    if (!studyId) { setFiles([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const list = await listNoaaStudyFiles(studyId)
        if (cancelled) return
        fileListCache.set(studyId, list)
        setFiles(list)
      } catch (e) {
        if (!cancelled) { setListError(e instanceof Error ? e.message : String(e)); setFiles([]) }
      }
    })()
    return () => { cancelled = true }
  }, [files, studyId])

  const current = files && files.length ? files[Math.min(selected, files.length - 1)] : undefined

  // Lazily load the selected file's text.
  const [text, setText] = useState<string | null>(null)
  const [textLoading, setTextLoading] = useState(false)
  const [textError, setTextError] = useState<string | null>(null)

  useEffect(() => {
    setText(null); setTextError(null); setTextLoading(false)
    if (!current) return
    if (current.text !== undefined) { setText(current.text); return }
    if (!current.url || !looksTextual(current)) return  // non-text file → link-out
    const cached = textCache.get(current.url)
    if (cached !== undefined) { setText(cached); return }
    const url = current.url
    let cancelled = false
    setTextLoading(true)
    ;(async () => {
      try {
        const t = await fetchNoaaFileText(url)
        if (cancelled) return
        textCache.set(url, t)
        setText(t)
      } catch (e) {
        if (!cancelled) setTextError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setTextLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [current])

  const copy = useCallback(() => {
    if (text != null) navigator.clipboard?.writeText(text).catch(() => {})
  }, [text])
  const download = useCallback(() => {
    if (text == null || !current) return
    const blob = new Blob([text], { type: 'text/plain' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = (current.name.replace(/[^\w.\-]+/g, '_') || 'noaa') + (/\.\w+$/.test(current.name) ? '' : '.txt')
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }, [text, current])

  if (files === null) {
    return <div className="noaa-text-view"><p className="noaa-text-msg">Loading NOAA source files…</p></div>
  }

  return (
    <div className="noaa-text-view">
      <div className="noaa-text-head">
        {files.length > 1 ? (
          <select
            className="noaa-text-select"
            value={Math.min(selected, files.length - 1)}
            onChange={e => setSelected(Number(e.target.value))}
            aria-label="NOAA source file"
          >
            {files.map((f, i) => <option key={i} value={i}>{f.name}</option>)}
          </select>
        ) : (
          <span className="noaa-text-name" title={current?.name}>{current?.name ?? 'NOAA source'}</span>
        )}
        <div className="noaa-text-actions">
          <button onClick={copy} disabled={text == null} className="noaa-text-btn" title="Copy the file text">Copy</button>
          <button onClick={download} disabled={text == null} className="noaa-text-btn" title="Download this file">Download</button>
          {current?.url && (
            <a className="noaa-text-btn" href={current.url} target="_blank" rel="noopener noreferrer">Original ↗</a>
          )}
          {studyUrl && (
            <a className="noaa-text-btn" href={studyUrl} target="_blank" rel="noopener noreferrer">Study on NOAA ↗</a>
          )}
        </div>
      </div>
      <div className="noaa-text-body">
        {!files.length ? (
          <p className="noaa-text-msg">
            No NOAA source files found for this dataset.{' '}
            {studyUrl && <a href={studyUrl} target="_blank" rel="noopener noreferrer">View the study on NOAA ↗</a>}
            {listError && <><br /><span className="noaa-text-err">Couldn’t load the file list: {listError}</span></>}
          </p>
        ) : textLoading ? (
          <p className="noaa-text-msg">Loading {current?.name}…</p>
        ) : textError ? (
          <p className="noaa-text-msg noaa-text-err">
            Couldn’t load this file in the browser ({textError}).{' '}
            {current?.url && <a href={current.url} target="_blank" rel="noopener noreferrer">Open it on NOAA ↗</a>}
          </p>
        ) : text != null ? (
          <pre className="noaa-text-pre">{text}</pre>
        ) : (
          <p className="noaa-text-msg">
            This file isn’t a text file.{' '}
            {current?.url && <a href={current.url} target="_blank" rel="noopener noreferrer">Open it on NOAA ↗</a>}
          </p>
        )}
      </div>
    </div>
  )
}
