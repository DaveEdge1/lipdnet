import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { DropZone } from '../components/DropZone'
import { NoaaImport } from '../components/NoaaImport'
import { MetadataPanel } from '../components/MetadataPanel'
import { ChangelogPanel } from '../components/ChangelogPanel'
import { ColumnList } from '../components/ColumnList'
import { ColumnEditor } from '../components/ColumnEditor'
import { ValidationPanel } from '../components/ValidationPanel'
import { TimeSeriesPlot } from '../components/TimeSeriesPlot'
import { SiteMap } from '../components/SiteMap'
import { DataEditor } from '../components/DataEditor'
import { StructureView } from '../components/StructureView'
import { JsonEditor } from '../components/JsonEditor'
import { NoaaTextView } from '../components/NoaaTextView'
import { serializeLipd, appendChangelog, parseLipd, makeTemplate } from '../lib/lipd'
import { downloadNoaa } from '../lib/noaaExport'
import { NewDatasetWizard } from '../components/NewDatasetWizard'
import { DataTableDialog } from '../components/DataTableDialog'
import { saveSession, loadSession, clearSession } from '../lib/autosaveStore'
import { listLibrary, saveToLibrary, deleteFromLibrary, libraryKey, type LibraryEntry } from '../lib/browserLibrary'
import type { NoaaSearchSession } from '../components/NoaaImport'
import { WelcomeDialog } from '../components/WelcomeDialog'
import { validateLipd } from '../lib/validate'
import { proxiedLpdUrl } from '../lib/remote'
import { setFeedbackDataset } from '../lib/feedbackContext'
import type { LipdFile, LipdMetadata } from '../types/lipd'

function contentHash(metadata: LipdMetadata): string {
  const { changelog: _c, datasetVersion: _v, ...rest } = metadata
  return JSON.stringify(rest)
}

// Bump the suffix to re-show the welcome brief after a notable release.
const WELCOME_KEY = 'pg-welcome-v1'

// ---- Session auto-save -------------------------------------------------------
// The open dataset (metadata incl. values + raw csvData) is persisted to
// localStorage so a refresh or crash doesn't lose unsaved edits. Cleared on an
// explicit Close. Oversized datasets simply skip persistence (quota errors).

// Stores metadata (with in-memory column values) but NOT csvData — the raw CSV
// text is redundant with the values. On restore, measurement CSVs are rebuilt
// from values; rarely-used extra CSVs (e.g. ensemble) are not recovered by
// crash-restore, an acceptable tradeoff. Persisted in IndexedDB (see
// lib/autosaveStore) so large datasets fit.
interface AutosavePayload {
  filename: string
  metadata: LipdMetadata
  savedAt: string
}

// ---- Workspace layout (resizable + collapsible panes) -----------------------

type PaneKey = 'tl' | 'bl' | 'tr' | 'br'

interface Layout {
  mode: 'single' | 'quad'  // one view at a time (default) or the 2×2 grid
  colPct: number     // left column width as % of the grid
  leftFrac: number   // top pane fraction of the left column
  rightFrac: number  // top pane fraction of the right column
  collapsed: Record<PaneKey, boolean>
}

const DEFAULT_LAYOUT: Layout = {
  mode: 'single',
  colPct: 35,
  leftFrac: 0.5,
  rightFrac: 0.5,
  collapsed: { tl: false, bl: false, tr: false, br: false },
}

// The views a loaded dataset exposes. In single-pane mode the left nav lists
// them; in the 2×2 grid they're grouped into the four panes' tabs. 'noaa' is an
// extra single-pane view shown only for datasets imported from NOAA.
type ViewKey = 'metadata' | 'structure' | 'column' | 'data' | 'plot' | 'map' | 'issues' | 'json' | 'noaa'

const svg = (children: ReactNode): ReactNode => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const VIEW_ICON: Record<ViewKey, ReactNode> = {
  metadata: svg(<><rect x="3" y="2" width="10" height="12" rx="1.5" /><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" /></>),
  structure: svg(<><rect x="6" y="1.5" width="4" height="3" rx="1" /><rect x="2" y="11.5" width="4" height="3" rx="1" /><rect x="10" y="11.5" width="4" height="3" rx="1" /><path d="M8 4.5v3M8 7.5H4v4M8 7.5h4v4" /></>),
  column: svg(<><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M6.5 2.5v11M9.5 2.5v11" /></>),
  data: svg(<><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M2.5 6h11M2.5 9.5h11M6.5 2.5v11" /></>),
  plot: svg(<><path d="M2.5 2.5v11h11" /><path d="M4.5 10l3-3.5 2.5 2 3-4" /></>),
  map: svg(<><path d="M8 14.5s4.5-4 4.5-7A4.5 4.5 0 0 0 3.5 7.5c0 3 4.5 7 4.5 7z" /><circle cx="8" cy="7.5" r="1.6" /></>),
  issues: svg(<><path d="M8 2l6 11H2z" /><path d="M8 6.5v3.5M8 11.6v.1" /></>),
  json: svg(<><path d="M6 2.5c-1.5 0-2 1-2 2.5s.3 2-1 2.5c1.3.5 1 1 1 2.5s.5 2.5 2 2.5" /><path d="M10 2.5c1.5 0 2 1 2 2.5s-.3 2 1 2.5c-1.3.5-1 1-1 2.5s-.5 2.5-2 2.5" /></>),
  noaa: svg(<><path d="M4 1.5h5l3 3v10a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z" /><path d="M9 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 13h3" /></>),
}
const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'metadata', label: 'Metadata' },
  { key: 'structure', label: 'Structure' },
  { key: 'column', label: 'Column' },
  { key: 'data', label: 'Data' },
  { key: 'plot', label: 'Plot' },
  { key: 'map', label: 'Map' },
  { key: 'issues', label: 'Issues' },
  { key: 'json', label: 'JSON' },
]

const LAYOUT_KEY = 'pg-workspace-layout'

function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '')
    return {
      ...DEFAULT_LAYOUT,
      ...saved,
      collapsed: { ...DEFAULT_LAYOUT.collapsed, ...(saved.collapsed ?? {}) },
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function PlaygroundView() {
  const [lipd, setLipd] = useState<LipdFile | null>(null)
  const [selectedTSid, setSelectedTSid] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [showDataTable, setShowDataTable] = useState(false)
  // First-run welcome brief — shown once per browser (persisted), reopenable.
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return localStorage.getItem(WELCOME_KEY) !== 'dismissed' } catch { return false }
  })
  const dismissWelcome = () => {
    try { localStorage.setItem(WELCOME_KEY, 'dismissed') } catch { /* private mode */ }
    setShowWelcome(false)
  }

  // Unsaved-session recovery: offer to restore an auto-saved dataset on landing.
  // Only for work with no home in the saved footer — if the crash slot holds a
  // dataset that's already saved there, fold its (newer) edits into that entry
  // and skip the banner, so the same dataset never shows up in both places.
  const [autosave, setAutosave] = useState<AutosavePayload | null>(null)
  const autosaveTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let session: AutosavePayload | null = null
      try { session = await loadSession<AutosavePayload>() } catch { /* IndexedDB unavailable */ }
      if (cancelled) return
      if (session?.metadata) {
        const lib = await listLibrary().catch(() => [] as LibraryEntry[])
        const existing = lib.find(e => e.id === libraryKey(session!.metadata, session!.filename))
        if (existing) {
          // Already in the footer — fold the newer crash-slot edits in, drop the slot.
          const updated: LibraryEntry = {
            ...existing, metadata: session.metadata, filename: session.filename, savedAt: session.savedAt,
          }
          await saveToLibrary(updated).catch(() => {})
          await clearSession().catch(() => {})
        } else if (!cancelled) {
          setAutosave(session)  // genuinely unsaved → offer restore
        }
      }
      // Load the library from a fresh read, so this (possibly late-resolving)
      // effect never clobbers an entry the user saved while it was still running.
      if (!cancelled) setLibrary(await listLibrary().catch(() => [] as LibraryEntry[]))
    })()
    return () => { cancelled = true }
  }, [])
  // Debounced persist of the open dataset
  useEffect(() => {
    if (!lipd) return
    window.clearTimeout(autosaveTimer.current)
    autosaveTimer.current = window.setTimeout(() => {
      saveSession({
        filename: lipd.filename,
        metadata: lipd.metadata,
        savedAt: new Date().toISOString(),
      } satisfies AutosavePayload).catch(() => { /* storage unavailable — skip */ })
    }, 1000)
    return () => window.clearTimeout(autosaveTimer.current)
  }, [lipd])

  // Publish the open dataset's identity so the NavBar's Feedback link can fold
  // it into the pre-filled GitHub issue (dataset name/id, and NOAA/PANGAEA
  // source when known). Cleared when no dataset is open.
  useEffect(() => {
    if (!lipd) { setFeedbackDataset(null); return }
    const m = lipd.metadata
    const created = typeof m.createdBy === 'string' ? m.createdBy : ''
    const source = m.NOAAStudyId ? 'NOAA'
      : /PANGAEA/i.test(created) ? 'PANGAEA'
      : /NOAA/i.test(created) ? 'NOAA'
      : undefined
    setFeedbackDataset({
      dataSetName: m.dataSetName,
      datasetId: typeof m.datasetId === 'string' ? m.datasetId : undefined,
      noaaStudyId: m.NOAAStudyId ? String(m.NOAAStudyId) : undefined,
      source,
    })
    return () => setFeedbackDataset(null)
  }, [lipd])

  // Per-panel tab state (2×2 grid) + the single-pane view selection
  const [tlTab, setTlTab] = useState<'metadata' | 'issues' | 'json'>('metadata')
  const [blTab, setBlTab] = useState<'map' | 'plot'>('map')
  const [brTab, setBrTab] = useState<'column' | 'data'>('column')
  const [singleView, setSingleView] = useState<ViewKey>('metadata')
  const [dataTablePath, setDataTablePath] = useState<string | undefined>(undefined)

  const savedHashRef = useRef<string>('')

  // Preserved NOAA search state — held in a ref and fed back to NoaaImport so
  // returning to the landing restores the same results. `hasSearchResults`
  // mirrors "are there results to go back to" and gates the "← Search results"
  // button, so the editor and the search stay one click apart for the whole
  // session — including after resuming a saved dataset that didn't itself come
  // from the search.
  const noaaSessionRef = useRef<NoaaSearchSession | null>(null)
  const [hasSearchResults, setHasSearchResults] = useState(false)
  const handleNoaaSession = useCallback((s: NoaaSearchSession) => {
    noaaSessionRef.current = s
    setHasSearchResults((s.results?.length ?? 0) > 0)
  }, [])

  // "Saved in this browser" library (explicit, multi-entry; separate from the
  // single crash-recovery autosave slot above). Shown in an always-visible
  // footer bar pinned to the bottom of both the landing and the editor.
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [browserSaved, setBrowserSaved] = useState(false)
  const refreshLibrary = useCallback(async () => {
    try { setLibrary(await listLibrary()) } catch { /* IndexedDB unavailable */ }
  }, [])
  // (Initial library load happens in the crash-recovery reconcile effect above.)

  // Workspace layout
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* private mode */ }
  }, [layout])

  const togglePane = (k: PaneKey) =>
    setLayout(l => ({ ...l, collapsed: { ...l.collapsed, [k]: !l.collapsed[k] } }))

  const setMode = (mode: Layout['mode']) => setLayout(l => ({ ...l, mode }))

  const startColDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const grid = gridRef.current
    if (!grid) return
    const move = (ev: PointerEvent) => {
      const rect = grid.getBoundingClientRect()
      setLayout(l => ({ ...l, colPct: clamp(((ev.clientX - rect.left) / rect.width) * 100, 15, 85) }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startRowDrag = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    e.preventDefault()
    const col = (e.currentTarget as HTMLElement).parentElement
    if (!col) return
    const move = (ev: PointerEvent) => {
      const rect = col.getBoundingClientRect()
      const frac = clamp((ev.clientY - rect.top) / rect.height, 0.15, 0.85)
      setLayout(l => (side === 'left' ? { ...l, leftFrac: frac } : { ...l, rightFrac: frac }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Flex sizing for a pane given its own and its sibling's collapse state
  const paneStyle = (self: boolean, sibling: boolean, frac: number): CSSProperties =>
    self ? { flex: '0 0 auto' }
    : sibling ? { flex: '1 1 0', minHeight: 0 }
    : { flex: `${frac} 1 0`, minHeight: 0 }

  const collapseBtn = (k: PaneKey) => (
    <button
      className="panel-collapse"
      title={layout.collapsed[k] ? 'Expand pane' : 'Collapse pane'}
      onClick={() => togglePane(k)}
    >
      {layout.collapsed[k] ? '⊞' : '—'}
    </button>
  )

  const handleLoad = useCallback((f: LipdFile) => {
    setLipd(f)
    setSelectedTSid(null)
    savedHashRef.current = contentHash(f.metadata)
  }, [])

  // Explicitly keep the current dataset in the browser library (named).
  const handleSaveToBrowser = useCallback(async () => {
    if (!lipd) return
    const defaultName = lipd.metadata.dataSetName ?? lipd.filename
    const name = window.prompt('Save this dataset in your browser as:', defaultName)
    if (name === null) return  // cancelled
    try {
      await saveToLibrary({
        id: libraryKey(lipd.metadata, lipd.filename),
        name: name.trim() || defaultName,
        filename: lipd.filename,
        metadata: lipd.metadata,
        savedAt: new Date().toISOString(),
      })
      await refreshLibrary()
      setBrowserSaved(true)
      window.setTimeout(() => setBrowserSaved(false), 1800)
    } catch {
      alert('Could not save to the browser library — storage may be full or unavailable.')
    }
  }, [lipd, refreshLibrary])

  // Auto-checkpoint the current dataset into the library so it can be resumed
  // with a click. Preserves any existing entry's name; keyed by dataset id so
  // it updates in place rather than piling up copies.
  const autoSaveToLibrary = useCallback(async (l: LipdFile) => {
    const id = libraryKey(l.metadata, l.filename)
    const existingName = library.find(e => e.id === id)?.name
    try {
      await saveToLibrary({
        id,
        name: existingName ?? l.metadata.dataSetName ?? l.filename,
        filename: l.filename,
        metadata: l.metadata,
        savedAt: new Date().toISOString(),
      })
      setLibrary(await listLibrary())
    } catch { /* storage unavailable — skip */ }
  }, [library])

  // Return to the search results, auto-saving the current work first so it's
  // waiting in the saved list to resume. The NOAA search itself is untouched —
  // NoaaImport remounts seeded from noaaSessionRef, so the results reappear.
  const backToSearch = useCallback(async () => {
    if (lipd) await autoSaveToLibrary(lipd)
    setLipd(null)
    setSelectedTSid(null)
  }, [lipd, autoSaveToLibrary])

  const handleDeleteLibrary = useCallback((id: string) => {
    deleteFromLibrary(id).then(refreshLibrary).catch(() => { /* ignore */ })
  }, [refreshLibrary])

  // Open a saved dataset. If one is already open (editing), checkpoint it first
  // so switching never loses work; a no-op if it's the same dataset.
  const openSaved = useCallback(async (entry: LibraryEntry) => {
    if (lipd) {
      if (libraryKey(lipd.metadata, lipd.filename) === entry.id) return  // already editing it
      await autoSaveToLibrary(lipd)
    }
    handleLoad({ metadata: entry.metadata, filename: entry.filename, csvData: {} })
  }, [lipd, autoSaveToLibrary, handleLoad])

  // Deep link: /playground-new?open=<lipdverse .lpd url> (used by the Query page)
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('open')
    if (!url) return
    let cancelled = false
    setRemoteStatus('Fetching dataset…')
    ;(async () => {
      try {
        const res = await fetch(proxiedLpdUrl(url))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const name = decodeURIComponent(url.split('/').pop() ?? 'dataset.lpd')
        const file = new File([blob], name)
        const parsed = await parseLipd(file)
        if (!cancelled) {
          handleLoad(parsed)
          setRemoteStatus(null)
        }
      } catch (e) {
        if (!cancelled) {
          setRemoteStatus(`Could not open remote dataset: ${e instanceof Error ? e.message : e}`)
        }
      }
    })()
    return () => { cancelled = true }
  }, [handleLoad])

  // "From a LiPD template": load an existing .lpd as the starting point for a
  // new dataset — a fresh datasetId so it's distinct from the original.
  const openTemplateFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    setRemoteStatus(`Loading ${file.name}…`)
    try {
      const parsed = await parseLipd(file)
      const rid = Array.from({ length: 17 }, () =>
        'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
      parsed.metadata.datasetId = `WEB${rid}`
      // Structure-only template: keep tables/columns/metadata, drop the values
      const stripValues = window.confirm(
        'Clear the data values so only the structure remains?\n\n' +
        'OK — blank template: keeps tables, columns, and metadata, but empties the data and assigns new TSids.\n' +
        'Cancel — keep the original data as the starting point.'
      )
      if (stripValues) {
        parsed.metadata = makeTemplate(parsed.metadata)
        parsed.csvData = {}
      }
      handleLoad(parsed)
      setRemoteStatus(null)
    } catch (e) {
      setRemoteStatus(`Could not read the LiPD file: ${e instanceof Error ? e.message : e}`)
    }
  }, [handleLoad])

  const handleMetadataChange = useCallback((updated: LipdMetadata) => {
    setLipd(prev => prev ? { ...prev, metadata: updated } : null)
  }, [])

  const handleSave = useCallback(async () => {
    if (!lipd) return
    setSaving(true)
    try {
      const isDirty = contentHash(lipd.metadata) !== savedHashRef.current
      const finalMetadata = isDirty
        ? appendChangelog(lipd.metadata, 'Edited with the lipd.net playground')
        : lipd.metadata
      const finalLipd = isDirty ? { ...lipd, metadata: finalMetadata } : lipd
      if (isDirty) {
        setLipd(finalLipd)
        savedHashRef.current = contentHash(finalMetadata)
      }
      const blob = await serializeLipd(finalLipd)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = finalLipd.filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setSaving(false)
    }
  }, [lipd])

  const issues = useMemo(() => lipd ? validateLipd(lipd.metadata) : [], [lipd])
  const errorCount = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length

  // Always-visible footer bar of saved datasets, pinned to the bottom of both
  // the landing and the editor. Each is a clickable chip; openSaved checkpoints
  // any open dataset before switching. The chip for the open dataset is marked.
  // Shown even when empty, with a hint, so it's a constant, findable place.
  const currentKey = lipd ? libraryKey(lipd.metadata, lipd.filename) : null
  const savedFooter = (
    <footer className="saved-footer" aria-label="Datasets saved in this browser">
      <span className="saved-footer-label">Saved</span>
      {library.length === 0 ? (
        <span className="saved-footer-empty">
          Nothing saved yet — use “Save to browser” to keep a dataset here.
        </span>
      ) : (
        <ul className="saved-footer-list">
          {library.map(entry => (
            <li key={entry.id} className={`saved-chip ${entry.id === currentKey ? 'active' : ''}`}>
              <button
                type="button"
                className="saved-chip-open"
                onClick={() => openSaved(entry)}
                title={`Open “${entry.name}” — saved ${new Date(entry.savedAt).toLocaleString()}`}
              >
                {entry.name}
              </button>
              <button
                type="button"
                className="saved-chip-del"
                onClick={() => handleDeleteLibrary(entry.id)}
                aria-label={`Remove ${entry.name} from this browser`}
                title="Remove from this browser"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </footer>
  )

  if (!lipd) {
    return (
      <div className="app landing">
        <div className="landing-scroll">
        <header className="landing-header">
          <h1>LiPD Playground</h1>
          <p>Open, edit, validate, and visualize paleoclimate data — right in your browser.</p>
          <button className="landing-whatsnew" onClick={() => setShowWelcome(true)}>
            What&rsquo;s new?
          </button>
        </header>

        {showWelcome && <WelcomeDialog onClose={dismissWelcome} />}

        {remoteStatus && <p className="noaa-import-status">{remoteStatus}</p>}

        {autosave && (
          <div className="restore-banner">
            <span>
              You have unsaved work on{' '}
              <strong>{autosave.metadata.dataSetName ?? autosave.filename}</strong>
              {' '}from {new Date(autosave.savedAt).toLocaleString()}.
            </span>
            <div className="restore-actions">
              <button
                className="btn-restore"
                onClick={() => {
                  handleLoad({ metadata: autosave.metadata, filename: autosave.filename, csvData: {} })
                }}
              >
                Restore
              </button>
              <button
                className="btn-discard"
                onClick={() => { clearSession(); setAutosave(null) }}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        <div className="landing-cards">
          <section className="landing-card">
            <h2>Open a LiPD</h2>
            <DropZone onLoad={handleLoad} />
          </section>

          <section className="landing-card">
            <h2>Create a LiPD</h2>
            <div className="landing-choice-list">
              <label className="landing-choice">
                <span className="landing-choice-title">From a LiPD template</span>
                <span className="landing-choice-sub">Start from an existing .lpd file</span>
                <input
                  type="file"
                  accept=".lpd"
                  style={{ display: 'none' }}
                  onChange={e => { openTemplateFile(e.target.files?.[0]); e.target.value = '' }}
                />
              </label>
              <button className="landing-choice" onClick={() => setShowDataTable(true)}>
                <span className="landing-choice-title">From a data table</span>
                <span className="landing-choice-sub">Paste or upload CSV/TSV data</span>
              </button>
              <button className="landing-choice" onClick={() => setShowWizard(true)}>
                <span className="landing-choice-title">From a blank slate</span>
                <span className="landing-choice-sub">Guided form for a valid LiPD skeleton</span>
              </button>
            </div>
          </section>

          <section className="landing-card landing-card-wide">
            <h2>NOAA to LiPD</h2>
            <p className="landing-card-hint">
              Pull a study from the NOAA NCEI Paleoclimatology archive, or open a NOAA text file.
            </p>
            <NoaaImport
              onLoad={handleLoad}
              initialSession={noaaSessionRef.current}
              onSession={handleNoaaSession}
            />
          </section>
        </div>
        </div>

        {savedFooter}

        {showWizard && (
          <NewDatasetWizard
            onCreate={f => { handleLoad(f); setShowWizard(false) }}
            onCancel={() => setShowWizard(false)}
          />
        )}
        {showDataTable && (
          <DataTableDialog
            onCreate={f => { handleLoad(f); setShowDataTable(false) }}
            onCancel={() => setShowDataTable(false)}
          />
        )}
      </div>
    )
  }

  const issuesBadge = (errorCount > 0 || warningCount > 0) && (
    <span className={`tab-issues-count ${errorCount > 0 ? 'has-errors' : 'has-warnings'}`}>
      {errorCount > 0 ? errorCount : warningCount}
    </span>
  )

  const c = layout.collapsed

  // The NOAA source-text view is offered only for datasets that came from NOAA
  // (captured source text, or a NOAAStudyId to fetch by). It lives in the
  // single-pane nav only — the 2×2 grid keeps its fixed panes.
  const isNoaa = !!(lipd.metadata.NOAAStudyId || lipd.noaaFiles?.length)
  const navViews = isNoaa ? [...VIEWS, { key: 'noaa' as ViewKey, label: 'NOAA' }] : VIEWS
  const effectiveSingleView: ViewKey = (singleView === 'noaa' && !isNoaa) ? 'metadata' : singleView

  // Switch to a view: in single-pane mode select it directly; in the grid,
  // activate the tab of whichever pane hosts it.
  const showView = (key: ViewKey) => {
    if (layout.mode === 'single') { setSingleView(key); return }
    if (key === 'metadata' || key === 'issues' || key === 'json') setTlTab(key)
    else if (key === 'map' || key === 'plot') setBlTab(key)
    else if (key === 'column' || key === 'data') setBrTab(key)
    // 'structure' has its own pane — nothing to toggle
  }

  // The content of one view, reused by both the single pane and the grid tabs.
  const renderView = (key: ViewKey): ReactNode => {
    switch (key) {
      case 'metadata':
        return (
          <div className="metadata-tab">
            <MetadataPanel metadata={lipd.metadata} onChange={handleMetadataChange} />
            <ChangelogPanel metadata={lipd.metadata} />
          </div>
        )
      case 'issues':
        return <ValidationPanel metadata={lipd.metadata} />
      case 'json':
        return <JsonEditor metadata={lipd.metadata} onChange={handleMetadataChange} />
      case 'map':
        return <SiteMap metadata={lipd.metadata} />
      case 'plot':
        return (
          <div className="panel-split">
            <ColumnList className="panel-sidebar" metadata={lipd.metadata} selectedTSid={selectedTSid}
              onSelect={tsid => setSelectedTSid(tsid)} />
            <div className="panel-split-main">
              <TimeSeriesPlot metadata={lipd.metadata} selectedTSid={selectedTSid} />
            </div>
          </div>
        )
      case 'structure':
        return (
          <StructureView metadata={lipd.metadata} selectedTSid={selectedTSid}
            onSelect={tsid => setSelectedTSid(tsid)}
            onNavigate={t => showView(t as ViewKey)}
            onOpenData={path => { setDataTablePath(path); showView('data') }} />
        )
      case 'column':
        return (
          <div className="panel-split">
            <ColumnList className="panel-sidebar" metadata={lipd.metadata} selectedTSid={selectedTSid}
              onSelect={tsid => setSelectedTSid(tsid)} />
            <div className="panel-split-main">
              <ColumnEditor metadata={lipd.metadata} selectedTSid={selectedTSid} onChange={handleMetadataChange} />
            </div>
          </div>
        )
      case 'data':
        return <DataEditor metadata={lipd.metadata} onChange={handleMetadataChange} selectedPath={dataTablePath} />
      case 'noaa':
        return (
          <NoaaTextView
            key={String(lipd.metadata.NOAAStudyId ?? lipd.filename)}
            sourceFiles={lipd.noaaFiles}
            studyId={lipd.metadata.NOAAStudyId ? String(lipd.metadata.NOAAStudyId) : undefined}
            originalUrl={typeof lipd.metadata.originalDataUrl === 'string' ? lipd.metadata.originalDataUrl : undefined}
          />
        )
    }
  }

  // Single ⇄ grid switcher, shown in the toolbar in both modes.
  const layoutToggle = (
    <div className="view-toggle" role="group" aria-label="Workspace layout">
      <button className={layout.mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}
        title="Show one pane at a time" aria-pressed={layout.mode === 'single'}>▭ 1 pane</button>
      <button className={layout.mode === 'quad' ? 'active' : ''} onClick={() => setMode('quad')}
        title="Show four panes at once" aria-pressed={layout.mode === 'quad'}>⊞ 4 panes</button>
    </div>
  )

  const toolbar = (
    <header className="toolbar">
      <span className="toolbar-title">{lipd.metadata.dataSetName ?? lipd.filename}</span>
      {lipd.metadata.datasetVersion && (
        <span className="toolbar-version">v{lipd.metadata.datasetVersion}</span>
      )}
      <div className="toolbar-actions">
        {layoutToggle}
        {hasSearchResults && (
          <button
            onClick={backToSearch}
            className="btn-back"
            title="Save the current work and return to your NOAA search results"
          >
            ← Search results
          </button>
        )}
        <button
          onClick={() => { downloadNoaa(lipd).catch(e => alert(e instanceof Error ? e.message : String(e))) }}
          className="btn-close"
          title="Download this dataset in the NOAA WDS-Paleo template format"
        >
          NOAA .txt
        </button>
        <button
          onClick={handleSaveToBrowser}
          className="btn-browser"
          title="Keep this dataset in your browser to reopen later"
        >
          {browserSaved ? 'Saved ✓' : 'Save to browser'}
        </button>
        <button onClick={handleSave} disabled={saving} className="btn-save">
          {saving ? 'Saving…' : 'Save .lpd'}
        </button>
        <button
          onClick={() => {
            window.clearTimeout(autosaveTimer.current)
            clearSession()
            setAutosave(null)
            setLipd(null)
            setSelectedTSid(null)
          }}
          className="btn-close"
        >
          Close
        </button>
      </div>
    </header>
  )

  // ── Single-pane workspace: left nav lists the views, main shows one. ──────
  if (layout.mode === 'single') {
    return (
      <div className="app workspace">
        {toolbar}
        <div className="workspace-single">
          <nav className="workspace-nav" aria-label="Views">
            {navViews.map(v => (
              <button
                key={v.key}
                className={`workspace-nav-item ${effectiveSingleView === v.key ? 'active' : ''}`}
                onClick={() => setSingleView(v.key)}
                aria-current={effectiveSingleView === v.key}
              >
                <span className="workspace-nav-icon">{VIEW_ICON[v.key]}</span>
                <span className="workspace-nav-label">{v.label}</span>
                {v.key === 'issues' && issuesBadge}
              </button>
            ))}
          </nav>
          <div className="panel-cell workspace-single-main">
            <div className="panel-body">{renderView(effectiveSingleView)}</div>
          </div>
        </div>
        {savedFooter}
      </div>
    )
  }

  return (
    <div className="app workspace">
      {toolbar}

      <div className="workspace-grid" ref={gridRef}>

        {/* ── Left column: Metadata/Issues/JSON over Map/Plot ─────────────── */}
        <div className="workspace-col" style={{ width: `calc(${layout.colPct}% - 3px)` }}>

          <div className={`panel-cell ${c.tl ? 'collapsed' : ''}`} style={paneStyle(c.tl, c.bl, layout.leftFrac)}>
            <div className="panel-tabbar">
              <button
                className={`panel-tab ${tlTab === 'metadata' ? 'active' : ''}`}
                onClick={() => setTlTab('metadata')}
              >Metadata</button>
              <button
                className={`panel-tab ${tlTab === 'issues' ? 'active' : ''}`}
                onClick={() => setTlTab('issues')}
              >Issues{issuesBadge}</button>
              <button
                className={`panel-tab ${tlTab === 'json' ? 'active' : ''}`}
                onClick={() => setTlTab('json')}
              >JSON</button>
              {collapseBtn('tl')}
            </div>
            <div className="panel-body">{renderView(tlTab)}</div>
          </div>

          {!c.tl && !c.bl && <div className="row-divider" onPointerDown={startRowDrag('left')} />}

          <div className={`panel-cell ${c.bl ? 'collapsed' : ''}`} style={paneStyle(c.bl, c.tl, 1 - layout.leftFrac)}>
            <div className="panel-tabbar">
              <button
                className={`panel-tab ${blTab === 'map' ? 'active' : ''}`}
                onClick={() => setBlTab('map')}
              >Map</button>
              <button
                className={`panel-tab ${blTab === 'plot' ? 'active' : ''}`}
                onClick={() => setBlTab('plot')}
              >Plot</button>
              {collapseBtn('bl')}
            </div>
            <div className="panel-body">{renderView(blTab)}</div>
          </div>
        </div>

        <div className="col-divider" onPointerDown={startColDrag} />

        {/* ── Right column: Structure over Column/Data ────────────────────── */}
        <div className="workspace-col" style={{ flex: 1, minWidth: 0 }}>

          <div className={`panel-cell ${c.tr ? 'collapsed' : ''}`} style={paneStyle(c.tr, c.br, layout.rightFrac)}>
            <div className="panel-tabbar">
              <span className="panel-label">Structure</span>
              {collapseBtn('tr')}
            </div>
            <div className="panel-body">{renderView('structure')}</div>
          </div>

          {!c.tr && !c.br && <div className="row-divider" onPointerDown={startRowDrag('right')} />}

          <div className={`panel-cell ${c.br ? 'collapsed' : ''}`} style={paneStyle(c.br, c.tr, 1 - layout.rightFrac)}>
            <div className="panel-tabbar">
              <button
                className={`panel-tab ${brTab === 'column' ? 'active' : ''}`}
                onClick={() => setBrTab('column')}
              >Column</button>
              <button
                className={`panel-tab ${brTab === 'data' ? 'active' : ''}`}
                onClick={() => setBrTab('data')}
              >Data</button>
              {collapseBtn('br')}
            </div>
            <div className="panel-body">{renderView(brTab)}</div>
          </div>
        </div>

      </div>
      {savedFooter}
    </div>
  )
}
