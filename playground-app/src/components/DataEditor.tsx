import { useState, useRef, useCallback, useMemo, useEffect, useTransition } from 'react'
import type { LipdMetadata } from '../types/lipd'
import { getTables, updateCellValue, deleteTableRow, addTableRow } from '../lib/lipd'

interface Props {
  metadata: LipdMetadata
  onChange: (updated: LipdMetadata) => void
  selectedPath?: string
}

interface EditCell {
  row: number
  colIdx: number
}

export function DataEditor({ metadata, onChange, selectedPath }: Props) {
  const tables = useMemo(() => getTables(metadata), [metadata])
  const [tableIdx, setTableIdx] = useState(0)
  const [isPending, startTransition] = useTransition()

  // Sync to selectedPath when it changes (e.g. clicking "Data" in Structure panel)
  useEffect(() => {
    if (!selectedPath) return
    const idx = tables.findIndex(t => t.path === selectedPath)
    if (idx >= 0) startTransition(() => setTableIdx(idx))
  }, [selectedPath, tables])
  const [editCell, setEditCell] = useState<EditCell | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const entry = tables[tableIdx]
  const table = entry?.table

  const cols = useMemo(
    () => (table ? [...table.columns].sort((a, b) => a.number - b.number) : []),
    [table]
  )

  const rowCount = useMemo(
    () => Math.max(0, ...cols.map(c => c.values?.length ?? 0)),
    [cols]
  )

  // Columns that share a variableName need the column number to distinguish them
  const duplicateNames = useMemo(() => {
    const seen = new Set<string>()
    const dups = new Set<string>()
    for (const col of cols) {
      if (seen.has(col.variableName)) dups.add(col.variableName)
      seen.add(col.variableName)
    }
    return dups
  }, [cols])

  function cellDisplay(val: number | string | null | undefined): string {
    if (val === null || val === undefined) return ''
    return String(val)
  }

  function parseValue(raw: string): number | string | null {
    if (raw.trim() === '' || raw.trim().toLowerCase() === 'nan') return null
    const n = Number(raw)
    return isNaN(n) ? raw : n
  }

  function startEdit(row: number, colIdx: number) {
    if (!cols[colIdx]) return
    const val = cols[colIdx].values?.[row]
    setEditValue(cellDisplay(val))
    setEditCell({ row, colIdx })
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitEdit = useCallback(() => {
    if (!editCell || !entry) return
    const col = cols[editCell.colIdx]
    if (!col) return
    const newVal = parseValue(editValue)
    const updated = updateCellValue(metadata, entry.path, col.number, editCell.row, newVal)
    onChange(updated)
    setEditCell(null)
  }, [editCell, editValue, cols, entry, metadata, onChange])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!editCell) return
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      commitEdit()
      // Move to next cell
      const nextCol = e.shiftKey && e.key === 'Tab'
        ? editCell.colIdx - 1
        : e.key === 'Tab' ? editCell.colIdx + 1 : editCell.colIdx
      const nextRow = e.key === 'Enter' ? editCell.row + 1 : editCell.row
      const clampedCol = Math.max(0, Math.min(cols.length - 1, nextCol))
      const clampedRow = Math.max(0, Math.min(rowCount - 1, nextRow))
      setTimeout(() => startEdit(clampedRow, clampedCol), 0)
    } else if (e.key === 'Escape') {
      setEditCell(null)
    }
  }

  function addRow() {
    if (!entry) return
    onChange(addTableRow(metadata, entry.path))
  }

  function deleteRow(row: number) {
    if (!entry) return
    onChange(deleteTableRow(metadata, entry.path, row))
  }

  if (!tables.length) {
    return (
      <div className="panel data-editor empty">
        <p>No data tables found in this file.</p>
      </div>
    )
  }

  return (
    <div className="panel data-editor">
      <div className="data-editor-toolbar">
        <select
          value={tableIdx}
          onChange={e => { const n = Number(e.target.value); startTransition(() => { setTableIdx(n); setEditCell(null) }) }}
        >
          {tables.map((t, i) => (
            <option key={t.path} value={i}>{t.label}</option>
          ))}
        </select>
        <span className="row-count">{rowCount} rows</span>
        <button className="btn-add-row" onClick={addRow}>+ Add row</button>
      </div>

      {isPending && (
        <div className="data-table-loading">
          <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx={12} cy={12} r={9} strokeOpacity={0.25} />
            <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
          </svg>
          Loading table…
        </div>
      )}
      <div className="data-table-scroll" style={isPending ? { visibility: 'hidden' } : undefined}>
        <table className="data-table">
          <thead>
            <tr>
              <th className="row-gutter" />
              {cols.map(col => {
                const isDup = duplicateNames.has(col.variableName)
                return (
                  <th key={col.number}>
                    {isDup
                      ? <>
                          <span className="col-varname col-member">#{col.number}</span>
                          <span className="col-units"> {col.variableName}</span>
                        </>
                      : <>
                          <span className="col-varname">{col.variableName}</span>
                          {col.units && <span className="col-units"> ({col.units as string})</span>}
                        </>
                    }
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, row) => (
              <tr key={row}>
                <td className="row-gutter">
                  <span className="row-num">{row + 1}</span>
                  <button
                    className="btn-delete-row"
                    title="Delete row"
                    onClick={() => deleteRow(row)}
                  >×</button>
                </td>
                {cols.map((col, ci) => {
                  const isEditing = editCell?.row === row && editCell?.colIdx === ci
                  const val = col.values?.[row]
                  const isEmpty = val === null || val === undefined
                  return (
                    <td
                      key={col.number}
                      className={`data-cell ${isEmpty ? 'null-cell' : ''} ${isEditing ? 'editing' : ''}`}
                      onClick={() => !isEditing && startEdit(row, ci)}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                          autoFocus
                        />
                      ) : (
                        isEmpty ? <span className="null-label">—</span> : cellDisplay(val)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
