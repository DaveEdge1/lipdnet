// Publication autocomplete from a DOI via the CrossRef REST API (CORS-open,
// no key needed). Returns only the fields it could resolve so the caller can
// merge them into the publication without clobbering hand-entered values.
import type { LipdPub } from '../types/lipd'

export async function fetchDoiMetadata(rawDoi: string): Promise<Partial<LipdPub>> {
  const doi = rawDoi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  if (!doi) throw new Error('Enter a DOI first')

  let res: Response
  try {
    res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
  } catch {
    throw new Error('Could not reach the CrossRef API — check your connection')
  }
  if (res.status === 404) throw new Error(`DOI "${doi}" was not found on CrossRef`)
  if (!res.ok) throw new Error(`CrossRef lookup failed (HTTP ${res.status})`)

  const msg = (await res.json())?.message
  if (!msg) throw new Error('CrossRef returned an unexpected response')

  const out: Partial<LipdPub> = { doi }
  if (msg.title?.[0]) out.title = String(msg.title[0])
  if (msg['container-title']?.[0]) out.journal = String(msg['container-title'][0])
  const year = msg.issued?.['date-parts']?.[0]?.[0] ?? msg['published-print']?.['date-parts']?.[0]?.[0]
  if (year) out.year = Number(year)
  if (msg.volume) out.volume = String(msg.volume)
  if (msg.page) out.pages = String(msg.page)
  if (Array.isArray(msg.author) && msg.author.length) {
    out.author = msg.author
      .map((a: { family?: string; given?: string; name?: string }) =>
        a.family ? { name: a.given ? `${a.family}, ${a.given}` : a.family }
        : a.name ? { name: a.name } : null)
      .filter((a: { name: string } | null): a is { name: string } => a !== null)
  }
  return out
}
