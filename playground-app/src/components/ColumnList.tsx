import type { LipdMetadata } from '../types/lipd'
import { getColumns } from '../lib/lipd'
import { useMemo } from 'react'

interface Props {
  metadata: LipdMetadata
  selectedTSid: string | null
  onSelect: (tsid: string) => void
  className?: string
}

export function ColumnList({ metadata, selectedTSid, onSelect, className = '' }: Props) {
  const columns = useMemo(() => getColumns(metadata), [metadata])

  // Group by path
  const groups = useMemo(() => {
    const map = new Map<string, typeof columns>()
    for (const entry of columns) {
      const group = map.get(entry.path) ?? []
      group.push(entry)
      map.set(entry.path, group)
    }
    return map
  }, [columns])

  return (
    <div className={`panel column-list${className ? ' ' + className : ''}`}>
      <h2>Variables</h2>
      {[...groups.entries()].map(([path, cols]) => (
        <div key={path} className="col-group">
          <div className="col-group-label">{path}</div>
          <ul>
            {cols.map(({ col }) => {
              const hasValues = !!col.values?.length
              const proxy = col.proxy as string | undefined
              return (
                <li
                  key={col.TSid}
                  className={`${col.TSid === selectedTSid ? 'selected' : ''} ${!hasValues ? 'no-values' : ''}`}
                  onClick={() => onSelect(col.TSid)}
                  title={!hasValues ? 'No data values loaded' : undefined}
                >
                  <span className="var-name">{col.variableName}</span>
                  <div className="var-meta">
                    {col.units && <span className="var-units">{col.units as string}</span>}
                    {proxy && <span className="var-badge">{proxy}</span>}
                    {!hasValues && <span className="var-nodata" title="No values loaded">⚠</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
