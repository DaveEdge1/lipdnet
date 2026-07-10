import { useMemo, useState } from 'react'
import { parseTabular } from '../lib/tabular'
import { createLipdFromTable } from '../lib/newDataset'
import type { LipdFile } from '../types/lipd'

interface Props {
  onCreate: (lipd: LipdFile) => void
  onCancel: () => void
}

// "From a data table": paste tab/comma-separated data (e.g. copied from a
// spreadsheet) or upload a CSV/TSV file, and wrap it in a new LiPD dataset.
export function DataTableDialog({ onCreate, onCancel }: Props) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Live preview of what will be parsed
  const preview = useMemo(() => {
    if (!text.trim()) return null
    try {
      const parsed = parseTabular(text)
      return { ...parsed, error: null as string | null }
    } catch (e) {
      return { headers: null, rows: [], error: e instanceof Error ? e.message : 'Parse error' }
    }
  }, [text])

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setText(await file.text())
    if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ''))
  }

  const create = () => {
    setError(null)
    try {
      onCreate(createLipdFromTable(name, parseTabular(text)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the dataset')
    }
  }

  const rowCount = preview && !preview.error ? preview.rows.length : 0
  const colCount = preview && !preview.error ? Math.max(0, ...preview.rows.map(r => r.length)) : 0
  const canCreate = rowCount > 0 && colCount > 0

  return (
    <div className="wizard-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="wizard-card">
        <h2>New dataset from a data table</h2>
        <p className="query-hint">
          Paste tab- or comma-separated data (e.g. copied from a spreadsheet) or upload a
          CSV/TSV file. The first row is used as column names when it isn't numeric.
        </p>

        <label className="query-field">
          <span>Dataset name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. MyDataset" />
        </label>

        <label className="query-field">
          <span>Table data</span>
          <textarea
            className="datatable-input"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'depth\tage\td18O\n0\t100\t-8.1\n1\t200\t-8.4'}
            rows={8}
            spellCheck={false}
          />
        </label>

        <div className="datatable-actions-row">
          <label className="noaa-file-link">
            or upload a CSV/TSV file
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              style={{ display: 'none' }}
              onChange={e => { loadFile(e.target.files?.[0]); e.target.value = '' }}
            />
          </label>
          {preview && !preview.error && (
            <span className="datatable-preview-info">
              {rowCount} row{rowCount === 1 ? '' : 's'} × {colCount} column{colCount === 1 ? '' : 's'}
              {preview.headers ? ` · headers: ${preview.headers.slice(0, 4).join(', ')}${preview.headers.length > 4 ? '…' : ''}` : ' · no header row'}
            </span>
          )}
          {preview?.error && <span className="error">{preview.error}</span>}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="wizard-actions">
          <button className="btn-close" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={!canCreate} onClick={create}
            title={canCreate ? 'Create the dataset and open the editor' : 'Paste or upload some data first'}>
            Create dataset
          </button>
        </div>
      </div>
    </div>
  )
}
