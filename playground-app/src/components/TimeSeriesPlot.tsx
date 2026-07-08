import type { LipdMetadata } from '../types/lipd'
import { getColumns } from '../lib/lipd'
import { useMemo, useRef, useEffect } from 'react'

interface Props {
  metadata: LipdMetadata
  selectedTSid: string | null
}

export function TimeSeriesPlot({ metadata, selectedTSid }: Props) {
  const columns = useMemo(() => getColumns(metadata), [metadata])
  const divRef = useRef<HTMLDivElement>(null)

  const { ageCol, dataCol } = useMemo(() => {
    if (!selectedTSid) return { ageCol: null, dataCol: null }

    const entry = columns.find(c => c.col.TSid === selectedTSid)
    if (!entry) return { ageCol: null, dataCol: null }

    const tableCols = columns.filter(c => c.path === entry.path)
    const dataCol = entry.col

    const ageCol =
      tableCols.find(c =>
        ['year', 'age', 'age-yrad', 'yearad'].includes(c.col.variableName.toLowerCase()) &&
        c.col.TSid !== selectedTSid
      )?.col ??
      tableCols.find(c => c.col.TSid !== selectedTSid)?.col ??
      null

    return { ageCol, dataCol }
  }, [selectedTSid, columns])

  useEffect(() => {
    if (!divRef.current) return
    if (!ageCol?.values?.length || !dataCol?.values?.length) return

    const xLabel = `${ageCol.variableName}${ageCol.units ? ` (${ageCol.units})` : ''}`
    const yLabel = `${dataCol.variableName}${dataCol.units ? ` (${dataCol.units})` : ''}`

    // Dynamic import so Plotly doesn't block initial page render
    import('plotly.js-dist-min').then((mod) => {
      const Plotly = mod.default ?? mod
      if (!divRef.current) return

      Plotly.react(divRef.current, [{
        x: ageCol.values,
        y: dataCol.values,
        type: 'scatter',
        mode: 'lines+markers',
        marker: { size: 4, color: '#4a90d9' },
        line: { color: '#4a90d9', width: 1.5 },
        name: dataCol.variableName,
        connectgaps: false,
      }], {
        autosize: true,
        margin: { l: 70, r: 20, t: 30, b: 60 },
        xaxis: { title: { text: xLabel }, autorange: true, gridcolor: '#2d2d4e', color: '#e0e0f0' },
        yaxis: { title: { text: yLabel }, gridcolor: '#2d2d4e', color: '#e0e0f0' },
        paper_bgcolor: 'transparent',
        plot_bgcolor: '#1a1a2e',
        font: { color: '#e0e0f0', size: 12 },
      }, {
        displaylogo: false,
        responsive: true,
      })
    })

    return () => {
      import('plotly.js-dist-min').then((mod) => {
        const Plotly = mod.default ?? mod
        if (divRef.current) Plotly.purge(divRef.current)
      })
    }
  }, [ageCol, dataCol])

  if (!dataCol || !ageCol) {
    return (
      <div className="panel plot-panel empty">
        <p>Select a variable from the list to plot it.</p>
      </div>
    )
  }

  if (!ageCol.values?.length || !dataCol.values?.length) {
    return (
      <div className="panel plot-panel empty">
        <p>No data values found — CSV may not have loaded for this table.</p>
      </div>
    )
  }

  return <div ref={divRef} className="panel plot-panel" />
}
