import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { DropZone } from '../components/DropZone'
import { NoaaImport } from '../components/NoaaImport'
import { PangaeaImport } from '../components/PangaeaImport'
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
import { serializeLipd, appendChangelog, parseLipd } from '../lib/lipd'
import { downloadNoaa } from '../lib/noaaExport'
import { NewDatasetWizard } from '../components/NewDatasetWizard'
import { DataTableDialog } from '../components/DataTableDialog'
import { WelcomeDialog } from '../components/WelcomeDialog'
import { validateLipd } from '../lib/validate'
import { proxiedLpdUrl } from '../lib/remote'
import type { LipdFile, LipdMetadata } from '../types/lipd'

function contentHash(metadata: LipdMetadata): string {
  const { changelog: _c, datasetVersion: _v, ...rest } = metadata
  return JSON.stringify(rest)
}

// Bump the suffix to re-show the welcome brief after a notable release.
const WELCOME_KEY = 'pg-welcome-v1'

// ---- Workspace layout (resizable + collapsible panes) -----------------------

type PaneKey = 'tl' | 'bl' | 'tr' | 'br'

interface Layout {
  colPct: number     // left column width as % of the grid
  leftFrac: number   // top pane fraction of the left column
  rightFrac: number  // top pane fraction of the right column
  collapsed: Record<PaneKey, boolean>
}

const DEFAULT_LAYOUT: Layout = {
  colPct: 35,
  leftFrac: 0.5,
  rightFrac: 0.5,
  collapsed: { tl: false, bl: false, tr: false, br: false },
}

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

  // Per-panel tab state
  const [tlTab, setTlTab] = useState<'metadata' | 'issues' | 'json'>('metadata')
  const [blTab, setBlTab] = useState<'map' | 'plot'>('map')
  const [brTab, setBrTab] = useState<'column' | 'data'>('column')
  const [dataTablePath, setDataTablePath] = useState<string | undefined>(undefined)

  const savedHashRef = useRef<string>('')

  // Workspace layout
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* private mode */ }
  }, [layout])

  const togglePane = (k: PaneKey) =>
    setLayout(l => ({ ...l, collapsed: { ...l.collapsed, [k]: !l.collapsed[k] } }))

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

  // Deep link: /playground?open=<lipdverse .lpd url> (used by the Query page)
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

  if (!lipd) {
    return (
      <div className="app landing">
        <header className="landing-header">
          <h1>LiPD Playground</h1>
          <p>Open, edit, validate, and visualize paleoclimate data — right in your browser.</p>
          <button className="landing-whatsnew" onClick={() => setShowWelcome(true)}>
            What&rsquo;s new?
          </button>
        </header>

        {showWelcome && <WelcomeDialog onClose={dismissWelcome} />}

        {remoteStatus && <p className="noaa-import-status">{remoteStatus}</p>}

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
            <NoaaImport onLoad={handleLoad} />
          </section>

          <section className="landing-card landing-card-wide">
            <h2>PANGAEA to LiPD</h2>
            <p className="landing-card-hint">
              Import a dataset from the <a href="https://www.pangaea.de" target="_blank" rel="noreferrer">PANGAEA</a> archive
              by ID or DOI (fast), or by keyword search (slower).
            </p>
            <PangaeaImport onLoad={handleLoad} />
          </section>
        </div>

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

  return (
    <div className="app workspace">
      <header className="toolbar">
        <span className="toolbar-title">
          {lipd.metadata.dataSetName ?? lipd.filename}
        </span>
        {lipd.metadata.datasetVersion && (
          <span className="toolbar-version">v{lipd.metadata.datasetVersion}</span>
        )}
        <div className="toolbar-actions">
          <button
            onClick={() => { downloadNoaa(lipd).catch(e => alert(e instanceof Error ? e.message : String(e))) }}
            className="btn-close"
            title="Download this dataset in the NOAA WDS-Paleo template format"
          >
            NOAA .txt
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-save">
            {saving ? 'Saving…' : 'Save .lpd'}
          </button>
          <button onClick={() => { setLipd(null); setSelectedTSid(null) }} className="btn-close">
            Close
          </button>
        </div>
      </header>

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
            <div className="panel-body">
              {tlTab === 'metadata' && (
                <div className="metadata-tab">
                  <MetadataPanel metadata={lipd.metadata} onChange={handleMetadataChange} />
                  <ChangelogPanel metadata={lipd.metadata} />
                </div>
              )}
              {tlTab === 'issues' && (
                <ValidationPanel metadata={lipd.metadata} />
              )}
              {tlTab === 'json' && (
                <JsonEditor metadata={lipd.metadata} onChange={handleMetadataChange} />
              )}
            </div>
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
            <div className="panel-body">
              {blTab === 'map' && <SiteMap metadata={lipd.metadata} />}
              {blTab === 'plot' && (
                <div className="panel-split">
                  <ColumnList
                    className="panel-sidebar"
                    metadata={lipd.metadata}
                    selectedTSid={selectedTSid}
                    onSelect={tsid => { setSelectedTSid(tsid) }}
                  />
                  <div className="panel-split-main">
                    <TimeSeriesPlot metadata={lipd.metadata} selectedTSid={selectedTSid} />
                  </div>
                </div>
              )}
            </div>
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
            <div className="panel-body">
              <StructureView
                metadata={lipd.metadata}
                selectedTSid={selectedTSid}
                onSelect={tsid => { setSelectedTSid(tsid) }}
                onNavigate={t => { if (t === 'plot') setBlTab('plot') }}
                onOpenData={path => { setDataTablePath(path); setBrTab('data') }}
              />
            </div>
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
            <div className="panel-body">
              {brTab === 'column' && (
                <div className="panel-split">
                  <ColumnList
                    className="panel-sidebar"
                    metadata={lipd.metadata}
                    selectedTSid={selectedTSid}
                    onSelect={tsid => { setSelectedTSid(tsid); setBrTab('column') }}
                  />
                  <div className="panel-split-main">
                    <ColumnEditor
                      metadata={lipd.metadata}
                      selectedTSid={selectedTSid}
                      onChange={handleMetadataChange}
                    />
                  </div>
                </div>
              )}
              {brTab === 'data' && (
                <DataEditor metadata={lipd.metadata} onChange={handleMetadataChange} selectedPath={dataTablePath} />
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
