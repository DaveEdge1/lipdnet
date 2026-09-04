// Parse user-supplied tabular text (comma or tab delimited) for direct upload
// into a measurement table.

export interface ParsedTabular {
  headers: string[] | null // null when the file has no header row
  rows: (number | string | null)[][]
}

// Split one CSV line honoring double-quoted cells ("" escapes a quote)
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function toValue(raw: string): number | string | null {
  const t = raw.trim()
  if (t === '' || /^(nan|na|null)$/i.test(t)) return null
  const n = Number(t)
  return isNaN(n) ? t : n
}

export function parseTabular(text: string): ParsedTabular {
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '')
  if (!lines.length) throw new Error('The file is empty')

  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const split = delimiter === '\t'
    ? (l: string) => l.split('\t').map(c => c.trim())
    : (l: string) => splitCsvLine(l).map(c => c.trim())

  const cells = lines.map(split)
  const width = Math.max(...cells.map(r => r.length))
  const padded = cells.map(r => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r))

  // First row is a header if it contains at least one non-numeric, non-empty cell
  const first = padded[0]
  const isHeader = first.some(c => c !== '' && isNaN(Number(c)))

  const dataRows = (isHeader ? padded.slice(1) : padded).map(r => r.map(toValue))
  if (!dataRows.length) throw new Error('No data rows found below the header')

  return {
    headers: isHeader ? first.map((c, i) => c || `column${i + 1}`) : null,
    rows: dataRows,
  }
}
