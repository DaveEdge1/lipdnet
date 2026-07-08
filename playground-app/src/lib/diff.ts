// Deep-diff two LiPD metadata trees and apply user resolutions to produce a
// merged dataset. Replaces the legacy AngularJS /merge page's diff logic.
import type { LipdMetadata } from '../types/lipd'

export type PathToken = string | number

export interface DiffEntry {
  path: PathToken[]
  label: string        // "pub[0].title"
  a: unknown           // value in file 1 (undefined = absent)
  b: unknown           // value in file 2 (undefined = absent)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function pathLabel(path: PathToken[]): string {
  return path.reduce<string>(
    (acc, t) => (typeof t === 'number' ? `${acc}[${t}]` : acc ? `${acc}.${t}` : t),
    ''
  )
}

// Column `values` arrays are compared as a unit (they can hold thousands of
// numbers); everything else is compared leaf-by-leaf.
function walk(a: unknown, b: unknown, path: PathToken[], out: DiffEntry[]) {
  if (a === undefined && b === undefined) return

  const last = path[path.length - 1]
  if (last === 'values') {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ path, label: pathLabel(path), a, b })
    }
    return
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) walk(a[i], b[i], [...path, i], out)
    return
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) walk(a[k], b[k], [...path, k], out)
    return
  }

  // Type mismatch or leaf values
  if (a === b) return
  if (JSON.stringify(a) === JSON.stringify(b)) return
  out.push({ path, label: pathLabel(path), a, b })
}

export function diffMetadata(a: LipdMetadata, b: LipdMetadata): DiffEntry[] {
  const out: DiffEntry[] = []
  walk(a, b, [], out)
  return out
}

export type Resolution = 'a' | 'b' | 'remove'

function setAtPath(root: unknown, path: PathToken[], value: unknown, remove: boolean) {
  let node: any = root
  for (let i = 0; i < path.length - 1; i++) {
    const t = path[i]
    if (node[t] === undefined || node[t] === null) {
      node[t] = typeof path[i + 1] === 'number' ? [] : {}
    }
    node = node[t]
  }
  const leaf = path[path.length - 1]
  if (remove || value === undefined) {
    if (Array.isArray(node) && typeof leaf === 'number') node.splice(leaf, 1)
    else delete node[leaf]
  } else {
    node[leaf] = value
  }
}

// Build the merged metadata: start from file 1, apply every diff the user
// resolved toward file 2 (or removal). Array-index removals are applied
// deepest/right-most first so earlier splices don't shift later ones.
export function applyResolutions(
  a: LipdMetadata,
  diffs: DiffEntry[],
  resolutions: Record<string, Resolution>
): LipdMetadata {
  const merged = JSON.parse(JSON.stringify(a)) as LipdMetadata
  const actionable = diffs
    .map(d => ({ d, r: resolutions[d.label] ?? 'a' }))
    .filter(({ r }) => r !== 'a')
    .sort((x, y) => y.d.label.localeCompare(x.d.label))
  for (const { d, r } of actionable) {
    const value = r === 'b' && d.b !== undefined ? JSON.parse(JSON.stringify(d.b)) : undefined
    setAtPath(merged, d.path, value, r === 'remove' || value === undefined)
  }
  return merged
}

// Compact one-line rendering of a diff side for the resolution UI
export function renderSide(v: unknown): string {
  if (v === undefined) return '(absent)'
  if (v === null) return 'null'
  if (Array.isArray(v)) {
    const prev = v.slice(0, 5).map(x => (typeof x === 'number' ? x : JSON.stringify(x))).join(', ')
    return `[${prev}${v.length > 5 ? `, … ${v.length} values` : ''}]`
  }
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return s.length > 120 ? s.slice(0, 117) + '…' : s
  }
  const s = String(v)
  return s.length > 120 ? s.slice(0, 117) + '…' : s
}
