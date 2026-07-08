import { NavBar } from './components/NavBar'
import { PlaygroundView } from './views/PlaygroundView'
import { QueryView } from './views/QueryView'
import { MergeView } from './views/MergeView'
import './App.css'

// The Express app serves this SPA at /playground, /query, and /merge — each
// route is a full page load, so the view is picked from the pathname.
function currentRoute(): '/playground' | '/query' | '/merge' {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === '/query') return '/query'
  if (path === '/merge') return '/merge'
  return '/playground'
}

export default function App() {
  const route = currentRoute()
  return (
    <div className="site-shell">
      <NavBar active={route} />
      <div className="site-view">
        {route === '/query' && <QueryView />}
        {route === '/merge' && <MergeView />}
        {route === '/playground' && <PlaygroundView />}
      </div>
    </div>
  )
}
