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

export function NavBar({ active }: Props) {
  return (
    <nav className="site-nav">
      <a className="site-nav-brand" href="/">
        LiPD<span className="site-nav-brand-accent">.net</span>
      </a>
      <div className="site-nav-links">
        {LINKS.map(l => (
          <a
            key={l.href}
            href={l.href}
            className={l.href === active ? 'active' : ''}
            {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  )
}
