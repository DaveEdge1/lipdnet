const LINKS = [
  { href: '/', label: 'Home' },
  { href: 'http://linked.earth/ontology/', label: 'Ontology', external: true },
  { href: '/playground', label: 'Playground' },
  { href: '/query', label: 'Query' },
  { href: '/merge', label: 'Merge' },
]

interface Props {
  active: string // pathname of the current view, e.g. "/playground"
}

// Mirrors the home page header (views/include/navbar.jade) so the site chrome
// is identical on every page.
export function NavBar({ active }: Props) {
  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <a className="site-nav-brand" href="/">
          <img src="/img/lipd-nav-brand.jpg" alt="LiPD" />
        </a>
        <ul className="site-nav-links">
          {LINKS.map(l => (
            <li key={l.href}>
              <a
                href={l.href}
                className={l.href === active ? 'active' : ''}
                {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}
