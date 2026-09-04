import { useFeedbackDataset, type FeedbackDataset } from '../lib/feedbackContext'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/format', label: 'Format' },
  { href: '/playground', label: 'Classic Playground' },
  { href: '/playground-new', label: 'Playground v2 (beta)' },
  { href: '/query', label: 'Query' },
  { href: '/merge', label: 'Merge' },
]

// Beta feedback goes to GitHub issues. We open the "new issue" page pre-filled
// with a short template plus environment context (and the open dataset, when
// there is one), so reports arrive actionable without any backend. (A future
// v2 could POST an in-app form to the API and file the issue server-side.)
const FEEDBACK_REPO = 'DaveEdge1/lipdnet'
function feedbackHref(ds: FeedbackDataset | null): string {
  const nav = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const loc = typeof window !== 'undefined' ? window.location : { pathname: '', href: '' }
  const lines = [
    '**What happened / what did you expect?**',
    '',
    '',
    '**Steps to reproduce (if reporting a bug):**',
    '1. ',
    '',
    '---',
    '_Submitted from the LiPD Playground v2 (beta)._',
  ]
  if (ds?.dataSetName || ds?.datasetId) {
    lines.push(`- Dataset: ${ds.dataSetName ?? '(unnamed)'}${ds.datasetId ? ` (id ${ds.datasetId})` : ''}`)
  }
  if (ds?.source) {
    lines.push(`- Source: ${ds.source}${ds.noaaStudyId ? ` — study ${ds.noaaStudyId}` : ''}`)
  }
  lines.push(
    `- Page: ${loc.pathname}`,
    `- URL: ${loc.href}`,
    `- Browser: ${nav}`,
    `- Date: ${new Date().toISOString()}`,
  )
  const params = new URLSearchParams({ title: '[Playground v2] ', body: lines.join('\n'), labels: 'beta-feedback' })
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${params.toString()}`
}

interface Props {
  active: string // pathname of the current view, e.g. "/playground"
}

// Mirrors the home page header (views/include/navbar.jade) so the site chrome
// is identical on every page.
export function NavBar({ active }: Props) {
  const dataset = useFeedbackDataset()
  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <a className="site-nav-brand" href="/">
          <img src="/img/lipd-nav-brand.jpg" alt="LiPD" />
        </a>
        <ul className="site-nav-links">
          {LINKS.map(l => (
            <li key={l.href}>
              <a href={l.href} className={l.href === active ? 'active' : ''}>
                {l.label}
              </a>
            </li>
          ))}
          <li className="site-nav-cta">
            <a
              href={feedbackHref(dataset)}
              target="_blank"
              rel="noopener noreferrer"
              title="Report a bug or suggest an improvement (opens a pre-filled GitHub issue)"
            >
              Feedback
            </a>
          </li>
        </ul>
      </div>
    </header>
  )
}
