import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
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
import { serializeLipd, appendChangelog, parseLipd } from '../lib/lipd'
import { createNewLipd } from '../lib/newDataset'
import { validateLipd } from '../lib/validate'
import { proxiedLpdUrl } from '../lib/remote'
import type { LipdFile, LipdMetadata } from '../types/lipd'

function contentHash(metadata: LipdMetadata): string {
  const { changelog: _c, datasetVersion: _v, ...rest } = metadata
  return JSON.stringify(rest)
}

export function PlaygroundView() {
  const [lipd, setLipd] = useState<LipdFile | null>(null)
  const [selectedTSid, setSelectedTSid] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null)

  // Per-panel tab state
  const [tlTab, setTlTab] = useState<'metadata' | 'issues' | 'json'>('metadata')
  const [blTab, setBlTab] = useState<'map' | 'plot'>('map')
  const [brTab, setBrTab] = useState<'column' | 'data'>('column')
  const [dataTablePath, setDataTablePath] = useState<string | undefined>(undefined)

  const savedHashRef = useRef<string>('')

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
        <div className="landing-header">
          <h1>LiPD Playground</h1>
          <p>Open, edit, and visualize paleoclimate data files</p>
        </div>
        {remoteStatus && <p className="noaa-import-status">{remoteStatus}</p>}
        <DropZone onLoad={handleLoad} />
        <div className="landing-actions">
          <span>or</span>
          <button className="btn" onClick={() => handleLoad(createNewLipd())}>
            Start a new dataset
          </button>
        </div>
        <NoaaImport onLoad={handleLoad} />
        <p className="landing-footer">
          {'based on '}
          <a href="https://github.com/nickmckay/lipd-studio" target="_blank" rel="noreferrer">LiPD Studio</a>
        </p>
      </div>
    )
  }

  const issuesBadge = (errorCount > 0 || warningCount > 0) && (
    <span className={`tab-issues-count ${errorCount > 0 ? 'has-errors' : 'has-warnings'}`}>
      {errorCount > 0 ? errorCount : warningCount}
    </span>
  )

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
          <button onClick={handleSave} disabled={saving} className="btn-save">
            {saving ? 'Saving…' : 'Save .lpd'}
          </button>
          <button onClick={() => { setLipd(null); setSelectedTSid(null) }} className="btn-close">
            Close
          </button>
        </div>
      </header>

      <div className="workspace-grid">

        {/* ── Top-left: Metadata / Issues ───────────────────────────────── */}
        <div className="panel-cell">
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

        {/* ── Top-right: Structure ──────────────────────────────────────── */}
        <div className="panel-cell">
          <div className="panel-tabbar">
            <span className="panel-label">Structure</span>
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

        {/* ── Bottom-left: Map / Plot ───────────────────────────────────── */}
        <div className="panel-cell">
          <div className="panel-tabbar">
            <button
              className={`panel-tab ${blTab === 'map' ? 'active' : ''}`}
              onClick={() => setBlTab('map')}
            >Map</button>
            <button
              className={`panel-tab ${blTab === 'plot' ? 'active' : ''}`}
              onClick={() => setBlTab('plot')}
            >Plot</button>
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

        {/* ── Bottom-right: Column / Data ───────────────────────────────── */}
        <div className="panel-cell">
          <div className="panel-tabbar">
            <button
              className={`panel-tab ${brTab === 'column' ? 'active' : ''}`}
              onClick={() => setBrTab('column')}
            >Column</button>
            <button
              className={`panel-tab ${brTab === 'data' ? 'active' : ''}`}
              onClick={() => setBrTab('data')}
            >Data</button>
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
  )
}
