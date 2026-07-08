import { useState, useMemo } from 'react'
import type { LipdMetadata } from '../types/lipd'

// ---- Layout constants (vertical tree: depth → Y, siblings → X) -------------
const NW = 148    // node width
const NH = 46     // node height
const LEVEL_GAP = 40  // vertical gap between depth levels
const SIB_GAP = 10    // horizontal gap between sibling nodes
const PAD = 20    // canvas padding

// ---- Node types & colors ----------------------------------------------------
type NType =
  | 'root'
  | 'paleo' | 'chron'
  | 'model'
  | 'measurement' | 'ensemble' | 'summary' | 'distribution'
  | 'col'

const STYLE: Record<NType, { fill: string; stroke: string; text: string; sub: string }> = {
  root:         { fill: '#162033', stroke: '#4a90d9', text: '#9ecfff', sub: '#4a7aaa' },
  paleo:        { fill: '#192009', stroke: '#8abd28', text: '#c8f060', sub: '#527818' },
  chron:        { fill: '#2a0e0e', stroke: '#d45242', text: '#f0a090', sub: '#8a3828' },
  model:        { fill: '#1e1a2e', stroke: '#6658a8', text: '#b0a0e0', sub: '#504878' },
  measurement:  { fill: '#1c1230', stroke: '#8455d4', text: '#c8a8ff', sub: '#584080' },
  ensemble:     { fill: '#2a1e08', stroke: '#cc8820', text: '#f0c060', sub: '#8a5e18' },
  summary:      { fill: '#0e2228', stroke: '#2896b0', text: '#60c8e0', sub: '#206878' },
  distribution: { fill: '#141e14', stroke: '#4a7a4a', text: '#80b080', sub: '#305030' },
  col:          { fill: '#111826', stroke: '#445566', text: '#a0b4c8', sub: '#445566' },
}

// ---- Tree node types --------------------------------------------------------
interface TNode {
  id: string
  type: NType
  label: string
  sub?: string
  tsid?: string
  hasValues?: boolean
  children: TNode[]
}

interface LNode extends TNode {
  x: number
  y: number
  children: LNode[]
}

// ---- Build tree from metadata -----------------------------------------------
function buildTree(metadata: LipdMetadata): TNode {
  const root: TNode = {
    id: '__root__',
    type: 'root',
    label: metadata.dataSetName ?? 'Dataset',
    sub: (metadata.archiveType as string) ?? '',
    children: [],
  }

  const defs: Array<{ key: 'paleoData' | 'chronData'; type: 'paleo' | 'chron' }> = [
    { key: 'paleoData', type: 'paleo' },
    { key: 'chronData', type: 'chron' },
  ]

  for (const { key, type } of defs) {
    const sections = (metadata[key] ?? []) as Array<{
      measurementTable?: Array<{ tableName?: string; columns?: Array<{
        number?: number; variableName: string; TSid: string; units?: unknown; proxy?: unknown; values?: unknown[]
      }> }>
      model?: Array<{
        summaryTable?: Array<{ tableName?: string; columns?: Array<{
          number?: number; variableName: string; TSid: string; units?: unknown; values?: unknown[]
        }> }>
        ensembleTable?: Array<{ tableName?: string; columns?: Array<{
          number?: number; variableName: string; TSid: string; values?: unknown[]
        }> }>
        distributionTable?: Array<{ tableName?: string; columns?: Array<{
          number?: number; variableName: string; TSid: string; values?: unknown[]
        }> }>
      }>
    }>

    sections.forEach((section, si) => {
      const prefix = type === 'paleo' ? 'paleo' : 'chron'
      const measCount = (section.measurementTable ?? []).length
      const modelCount = (section.model ?? []).length
      const secNode: TNode = {
        id: `${key}[${si}]`,
        type,
        label: `${prefix}${si}`,
        sub: [
          measCount ? `${measCount} meas` : '',
          modelCount ? `${modelCount} model` : '',
        ].filter(Boolean).join(' · ') || 'empty',
        children: [],
      }

      // Measurement tables
      ;(section.measurementTable ?? []).forEach((table, ti) => {
        const cols = [...(table.columns ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
        const rowCount = Math.max(0, ...cols.map(c => (c.values?.length ?? 0)))
        const tableNode: TNode = {
          id: `${key}[${si}].measurementTable[${ti}]`,
          type: 'measurement',
          label: table.tableName ?? `measurement${ti}`,
          sub: `${cols.length} col · ${rowCount > 0 ? rowCount + ' row' : 'no data'}`,
          children: colNodes(cols),
        }
        secNode.children.push(tableNode)
      })

      // Model tables
      ;(section.model ?? []).forEach((model, mi) => {
        const tableTypes: Array<{
          key: 'summaryTable' | 'ensembleTable' | 'distributionTable'
          type: 'summary' | 'ensemble' | 'distribution'
          labelPrefix: string
        }> = [
          { key: 'summaryTable',      type: 'summary',      labelPrefix: 'summary' },
          { key: 'ensembleTable',     type: 'ensemble',     labelPrefix: 'ensemble' },
          { key: 'distributionTable', type: 'distribution', labelPrefix: 'distribution' },
        ]

        const modelChildren: TNode[] = []
        for (const def of tableTypes) {
          ;(model[def.key] ?? []).forEach((table, ti) => {
            const cols = [...(table.columns ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
            const rowCount = Math.max(0, ...cols.map(c => (c.values?.length ?? 0)))
            modelChildren.push({
              id: `${key}[${si}].model[${mi}].${def.key}[${ti}]`,
              type: def.type,
              label: table.tableName ?? `${def.labelPrefix}${ti}`,
              sub: `${cols.length} col · ${rowCount > 0 ? rowCount + ' row' : 'no data'}`,
              children: colNodes(cols),
            })
          })
        }

        if (modelChildren.length > 0) {
          secNode.children.push({
            id: `${key}[${si}].model[${mi}]`,
            type: 'model',
            label: `model${mi}`,
            sub: `${modelChildren.length} table${modelChildren.length !== 1 ? 's' : ''}`,
            children: modelChildren,
          })
        }
      })

      if (secNode.children.length > 0) root.children.push(secNode)
    })
  }

  return root
}

function colNodes(cols: Array<{
  number?: number; variableName: string; TSid: string; units?: unknown; proxy?: unknown; values?: unknown[]
}>): TNode[] {
  return cols.map(col => ({
    id: col.TSid,
    type: 'col' as NType,
    label: col.variableName,
    sub: [col.units as string, col.proxy as string].filter(Boolean).join(' · ') || '\u00a0',
    tsid: col.TSid,
    hasValues: (col.values?.length ?? 0) > 0,
    children: [],
  }))
}

// ---- Layout: vertical tree with leaf-centering -----------------------------
// Y = depth level, X = centered over children (leaf-centering)
function layoutTree(
  root: TNode,
  collapsed: Set<string>
): { nodes: LNode[]; edges: Array<[LNode, LNode]>; w: number; h: number } {
  function build(node: TNode, depth: number): LNode {
    const ln: LNode = { ...node, x: 0, y: PAD + depth * (NH + LEVEL_GAP), children: [] }
    if (!collapsed.has(node.id)) {
      ln.children = node.children.map(c => build(c, depth + 1))
    }
    return ln
  }

  // Assign x by leaf-centering (horizontal equivalent of the old y assignment)
  const counter = { h: PAD }
  function assignX(node: LNode): void {
    if (node.children.length === 0) {
      node.x = counter.h
      counter.h += NW + SIB_GAP
    } else {
      node.children.forEach(assignX)
      node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2
    }
  }

  const lRoot = build(root, 0)
  assignX(lRoot)

  function flatten(n: LNode): LNode[] { return [n, ...n.children.flatMap(flatten)] }
  function collectEdges(n: LNode): Array<[LNode, LNode]> {
    return n.children.flatMap(c => [[n, c] as [LNode, LNode], ...collectEdges(c)])
  }

  const nodes = flatten(lRoot)
  const edges = collectEdges(lRoot)
  const w = Math.max(...nodes.map(n => n.x + NW)) + PAD
  const h = Math.max(...nodes.map(n => n.y + NH)) + PAD

  return { nodes, edges, w, h }
}

// Vertical bezier: bottom-center of parent → top-center of child
function edgePath(from: LNode, to: LNode): string {
  const x1 = from.x + NW / 2, y1 = from.y + NH
  const x2 = to.x   + NW / 2, y2 = to.y
  const my = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`
}

// ---- Determine default collapsed set ----------------------------------------
function defaultCollapsed(metadata: LipdMetadata): Set<string> {
  const s = new Set<string>()
  // Collapse distribution tables by default (can have 49+ entries)
  ;(metadata.paleoData ?? []).concat(metadata.chronData ?? []).forEach((sec, si) => {
    const key = si < (metadata.paleoData ?? []).length ? 'paleoData' : 'chronData'
    const adjSi = key === 'chronData' ? si - (metadata.paleoData ?? []).length : si
    ;(sec.model ?? []).forEach((model, mi) => {
      if ((model.distributionTable ?? []).length > 0) {
        // collapse each distribution table node
        ;(model.distributionTable ?? []).forEach((_t, ti) => {
          s.add(`${key}[${adjSi}].model[${mi}].distributionTable[${ti}]`)
        })
      }
    })
  })

  // Collapse ensemble table columns if there are many (ensemble tables have hundreds)
  ;(metadata.paleoData ?? []).concat(metadata.chronData ?? []).forEach((sec, si) => {
    const key = si < (metadata.paleoData ?? []).length ? 'paleoData' : 'chronData'
    const adjSi = key === 'chronData' ? si - (metadata.paleoData ?? []).length : si
    ;(sec.model ?? []).forEach((model, mi) => {
      ;(model.ensembleTable ?? []).forEach((table, ti) => {
        if ((table.columns?.length ?? 0) > 5) {
          s.add(`${key}[${adjSi}].model[${mi}].ensembleTable[${ti}]`)
        }
      })
    })
  })

  return s
}

// ---- Component --------------------------------------------------------------
interface Props {
  metadata: LipdMetadata
  selectedTSid: string | null
  onSelect: (tsid: string) => void
  onNavigate: (tab: string) => void
  onOpenData?: (tablePath: string) => void
}

const FONT = '"Inter", "Segoe UI", system-ui, sans-serif'

export function StructureView({ metadata, selectedTSid, onSelect, onNavigate, onOpenData }: Props) {
  const tree = useMemo(() => buildTree(metadata), [metadata])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsed(metadata))

  const { nodes, edges, w, h } = useMemo(
    () => layoutTree(tree, collapsed),
    [tree, collapsed]
  )

  function toggleCollapse(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleNodeClick(node: LNode) {
    if (node.tsid) {
      onSelect(node.tsid)
      onNavigate('plot')
    } else if (node.type !== 'root') {
      toggleCollapse(node.id)
    }
  }

  // Count hidden children for collapsed indicator
  function countDescendants(id: string): number {
    function walk(n: TNode): number {
      if (n.id === id) return n.children.length
      for (const c of n.children) {
        const r = walk(c)
        if (r >= 0) return r
      }
      return -1
    }
    return Math.max(0, walk(tree))
  }

  return (
    <div className="structure-view">
      <div className="structure-legend">
        {(['measurement', 'ensemble', 'summary', 'distribution'] as NType[]).map(t => (
          <span key={t} className="legend-item">
            <svg width={10} height={10}><rect width={10} height={10} rx={2} fill={STYLE[t].stroke} opacity={0.8} /></svg>
            {t}
          </span>
        ))}
        <span className="legend-sep" />
        <span className="structure-hint-text">Click column to plot · click node to expand/collapse</span>
      </div>
      <div className="structure-scroll">
        <svg width={w} height={h} style={{ display: 'block' }}>
          {/* Edges */}
          <g>
            {edges.map(([from, to]) => (
              <path
                key={`${from.id}->${to.id}`}
                d={edgePath(from, to)}
                fill="none"
                stroke={STYLE[to.type].stroke}
                strokeWidth={1.5}
                strokeOpacity={0.4}
              />
            ))}
          </g>

          {/* Nodes */}
          {nodes.map(node => {
            const s = STYLE[node.type]
            const isSelected = node.tsid != null && node.tsid === selectedTSid
            const isLeaf = node.type === 'col' || node.type === 'root'
            const isCollapsed = collapsed.has(node.id)

            return (
              <g
                key={node.id}
                onClick={() => handleNodeClick(node)}
                style={{ cursor: (node.tsid || !isLeaf) ? 'pointer' : 'default' }}
              >
                {/* Selection glow */}
                {isSelected && (
                  <rect
                    x={node.x - 3} y={node.y - 3}
                    width={NW + 6} height={NH + 6}
                    rx={11} fill="none"
                    stroke={s.stroke} strokeWidth={2.5} opacity={0.65}
                  />
                )}

                {/* Node body */}
                <rect
                  x={node.x} y={node.y}
                  width={NW} height={NH}
                  rx={8}
                  fill={s.fill}
                  stroke={s.stroke}
                  strokeWidth={isSelected ? 2 : 1.5}
                  strokeOpacity={isSelected ? 1 : 0.55}
                />

                {/* No-values stripe for column nodes */}
                {node.type === 'col' && !node.hasValues && (
                  <rect
                    x={node.x} y={node.y + NH - 4}
                    width={NW} height={4} rx={0}
                    fill="#f0c040" opacity={0.3}
                  />
                )}

                {/* Primary label */}
                <text
                  x={node.x + 10} y={node.y + 16}
                  fontFamily={FONT} fontSize={12} fontWeight={600}
                  fill={s.text}
                >
                  {truncate(node.label, 17)}
                </text>

                {/* Sub label */}
                {node.sub && (
                  <text
                    x={node.x + 10} y={node.y + 31}
                    fontFamily={FONT} fontSize={10}
                    fill={s.sub}
                  >
                    {truncate(node.sub, (node.type === 'measurement' || node.type === 'ensemble' || node.type === 'distribution') && onOpenData ? 12 : 21)}
                  </text>
                )}

                {/* Collapse indicator */}
                {!isLeaf && (
                  <text
                    x={node.x + NW - 13} y={node.y + 17}
                    fontFamily={FONT} fontSize={10}
                    fill={s.sub} textAnchor="middle"
                  >
                    {isCollapsed ? `+${countDescendants(node.id)}` : '−'}
                  </text>
                )}

                {/* Data button (measurement, ensemble, distribution tables) */}
                {(node.type === 'measurement' || node.type === 'ensemble' || node.type === 'distribution') && onOpenData && (
                  <g
                    onClick={e => { e.stopPropagation(); onOpenData(node.id) }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={node.x + NW - 44} y={node.y + 24}
                      width={36} height={15} rx={3}
                      fill={s.stroke} opacity={0.2}
                    />
                    <rect
                      x={node.x + NW - 44} y={node.y + 24}
                      width={36} height={15} rx={3}
                      fill="none" stroke={s.stroke} strokeWidth={1} opacity={0.7}
                    />
                    <text
                      x={node.x + NW - 26} y={node.y + 34}
                      fontFamily={FONT} fontSize={9} fontWeight={500}
                      fill={s.text} textAnchor="middle" pointerEvents="none"
                    >
                      data
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}
