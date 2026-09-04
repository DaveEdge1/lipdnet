import { useState, useEffect } from 'react'
import type { LipdMetadata } from '../types/lipd'
import { getCleanMetadata, applyJsonEdit } from '../lib/lipd'

interface Props {
  metadata: LipdMetadata
  onChange: (updated: LipdMetadata) => void
}

export function JsonEditor({ metadata, onChange }: Props) {
  const [text, setText] = useState(() => JSON.stringify(getCleanMetadata(metadata), null, 2))
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Sync display when metadata changes externally (not from our own edits)
  useEffect(() => {
    if (!dirty) {
      setText(JSON.stringify(getCleanMetadata(metadata), null, 2))
    }
  }, [metadata, dirty])

  function apply() {
    try {
      const parsed = JSON.parse(text) as LipdMetadata
      onChange(applyJsonEdit(parsed, metadata))
      setError(null)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function reset() {
    setText(JSON.stringify(getCleanMetadata(metadata), null, 2))
    setError(null)
    setDirty(false)
  }

  return (
    <div className="panel json-editor">
      <div className="json-editor-toolbar">
        <span className="json-editor-hint">metadata.jsonld — data values omitted</span>
        <div className="json-editor-actions">
          <button className="btn-json-action" onClick={apply} disabled={!dirty}>Apply</button>
          <button className="btn-json-action" onClick={reset} disabled={!dirty}>Reset</button>
        </div>
      </div>
      {error && <div className="json-editor-error">{error}</div>}
      <textarea
        className="json-editor-textarea"
        value={text}
        onChange={e => { setText(e.target.value); setDirty(true) }}
        spellCheck={false}
      />
    </div>
  )
}
