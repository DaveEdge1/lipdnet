import { useState } from 'react'
import { searchNoaaStudies, noaaStudyToLipd, type NoaaStudy } from '../lib/noaa'
import type { LipdFile } from '../types/lipd'
import pyleotupsLogo from '../assets/pyleotups_logo.png'

interface Props {
  onLoad: (lipd: LipdFile) => void
}

export function NoaaImport({ onLoad }: Props) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<NoaaStudy[] | null>(null)

  const importStudy = async (study: NoaaStudy) => {
    setBusy(`Importing "${study.studyName}"…`)
    setError(null)
    try {
      const { lipd, skippedFiles } = await noaaStudyToLipd(study)
      if (skippedFiles.length) {
        console.warn('NOAA import skipped non-template files:', skippedFiles)
      }
      onLoad(lipd)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  const search = async () => {
    if (!query.trim() || busy) return
    setBusy('Searching NOAA…')
    setError(null)
    setResults(null)
    try {
      const studies = await searchNoaaStudies(query)
      if (!studies.length) {
        setError('No NOAA studies found for that query.')
      } else if (studies.length === 1) {
        await importStudy(studies[0])
        return
      } else {
        setResults(studies)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setBusy(prev => (prev && prev.startsWith('Importing') ? prev : null))
    }
  }

  return (
    <div className="noaa-import">
      <div className="noaa-import-row">
        <a
          className="noaa-import-logo"
          href="https://github.com/LinkedEarth/PyleoTUPS"
          target="_blank"
          rel="noreferrer"
          title="NOAA import based on PyleoTUPS — view on GitHub"
        >
          <img src={pyleotupsLogo} alt="PyleoTUPS" />
        </a>
        <input
          type="text"
          placeholder="Import from NOAA: study ID, study URL, or search terms"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search() }}
          disabled={!!busy}
        />
        <button className="btn" onClick={search} disabled={!!busy || !query.trim()}>
          Import
        </button>
      </div>
      {busy && <p className="noaa-import-status">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {results && (
        <ul className="noaa-import-results">
          {results.map(s => (
            <li key={s.NOAAStudyId}>
              <button onClick={() => importStudy(s)} disabled={!!busy}>
                <span className="noaa-study-name">{s.studyName}</span>
                <span className="noaa-study-meta">
                  {s.dataType ?? ''} · NOAA {s.NOAAStudyId}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
