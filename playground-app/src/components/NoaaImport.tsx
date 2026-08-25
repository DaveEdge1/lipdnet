import { useState } from 'react'
import {
  searchNoaaStudies, noaaStudyToLipd, noaaStudyViaService, noaaFileToLipd, noaaFileViaService,
  NOAA_DATA_TYPES, type NoaaStudy, type NoaaSearchFilters,
} from '../lib/noaa'
import { SEASONALITY } from '../lib/vocabulary'
import type { LipdFile } from '../types/lipd'
import pyleotupsLogo from '../assets/pyleotups_logo.png'

interface Props {
  onLoad: (lipd: LipdFile) => void
}

// ---- result-card display helpers (pure) -------------------------------------

const SMALL_WORDS = new Set(['and', 'of', 'the', 'in', 'for', 'to', 'a', 'on'])
/** Title-case NOAA's ALL-CAPS dataType, e.g. "CORALS AND SCLEROSPONGES". */
function prettyArchive(dataType?: string): string {
  if (!dataType) return 'Dataset'
  return dataType.toLowerCase().split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** NOAA POINT coordinates arrive as [lat, lon] strings → "28.45°S, 113.77°E". */
function fmtCoords(coords?: Array<string | number>): string | null {
  if (!coords || coords.length < 2) return null
  const lat = Number(coords[0]); const lon = Number(coords[1])
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`
}

function timeSpan(s: NoaaStudy): string | null {
  const fmtCE = (y: number) => (y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`)
  const a = s.earliestYearCE, b = s.mostRecentYearCE
  if (a != null && b != null) {
    if (a === b) return fmtCE(a)
    return (a >= 0 && b >= 0) ? `${a}–${b} CE` : `${fmtCE(a)} – ${fmtCE(b)}`
  }
  if (s.earliestYearBP != null && s.mostRecentYearBP != null)
    return `${s.earliestYearBP}–${s.mostRecentYearBP} BP`
  return null
}

function studyLocation(s: NoaaStudy): { label: string | null; coords: string | null; siteCount: number } {
  const sites = s.site ?? []
  const first = sites[0]
  return {
    label: first?.locationName || first?.siteName || null,
    coords: fmtCoords(first?.geo?.geometry?.coordinates),
    siteCount: sites.length,
  }
}

const tableNames = (s: NoaaStudy): string[] =>
  (s.site ?? []).flatMap(si => si.paleoData ?? []).map(pd => pd.dataTableName || '').filter(Boolean)

const siteList = (s: NoaaStudy): Array<{ name: string; coords: string | null }> =>
  (s.site ?? []).map(si => ({
    name: si.locationName || si.siteName || 'Site',
    coords: fmtCoords(si.geo?.geometry?.coordinates),
  }))

interface PubView { citation: string; title?: string; doi?: string; url?: string }
function primaryPub(s: NoaaStudy): PubView | null {
  const p = (s.publication ?? [])[0] as Record<string, unknown> | undefined
  if (!p) return null
  const author = typeof p.author === 'object' && p.author
    ? String((p.author as Record<string, unknown>).name ?? '')
    : (p.author as string | undefined)
  const id = p.identifier as { type?: string; id?: string; url?: string } | undefined
  const citation = [author, p.pubYear && `(${p.pubYear})`].filter(Boolean).join(' ')
  return {
    citation: citation || (p.title as string) || 'Publication',
    title: p.title as string | undefined,
    doi: id?.type === 'doi' ? id.id : undefined,
    url: id?.url,
  }
}

export function NoaaImport({ onLoad }: Props) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [results, setResults] = useState<NoaaStudy[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [investigators, setInvestigators] = useState('')
  const [dataTypeId, setDataTypeId] = useState('')
  const [variableName, setVariableName] = useState('')
  const [cvMaterials, setCvMaterials] = useState('')
  const [cvSeasonalities, setCvSeasonalities] = useState('')
  const [species, setSpecies] = useState('')
  const [locations, setLocations] = useState('')
  const [minLat, setMinLat] = useState(''); const [maxLat, setMaxLat] = useState('')
  const [minLon, setMinLon] = useState(''); const [maxLon, setMaxLon] = useState('')
  const [minElevation, setMinElevation] = useState(''); const [maxElevation, setMaxElevation] = useState('')
  const [earliestYear, setEarliestYear] = useState(''); const [latestYear, setLatestYear] = useState('')
  const [reconstructionOnly, setReconstructionOnly] = useState(false)

  const importStudy = async (study: NoaaStudy) => {
    setBusy(`Importing "${study.studyName}"…`)
    setError(null)
    setNotice(null)
    try {
      // Prefer the PyleoTUPS service (better parsing); fall back to the
      // browser parser when it isn't deployed.
      const viaService = await noaaStudyViaService(study.NOAAStudyId)
      const { lipd, skippedFiles, metadataOnly } = viaService ?? await noaaStudyToLipd(study)
      if (skippedFiles.length) {
        console.warn('NOAA import skipped files:', skippedFiles)
      }
      if (metadataOnly) {
        const names = skippedFiles.map(f => f.split('/').pop()).join(', ')
        if (!window.confirm(
          `The data file(s) in this study (${names}) aren't in a format that can be ` +
          `converted automatically. Import the study metadata with an empty data table? ` +
          `You can add the values in the Data tab via "Import CSV/TSV" or "Paste data".`
        )) {
          setBusy(null)
          return
        }
      }
      onLoad(lipd)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  const openLocalNoaaFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(`Reading ${file.name}…`)
    setError(null)
    try {
      const text = await file.text()
      // Prefer the PyleoTUPS service (handles old/non-standard formats too)
      const viaService = await noaaFileViaService(text, file.name)
      if (viaService.status === 'ok') {
        onLoad(viaService.result.lipd)
        return
      }
      if (viaService.status === 'error') {
        setError(viaService.message)
        return
      }
      // Service unavailable → browser parser (standard NOAA templates only)
      onLoad(noaaFileToLipd(text, file.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file')
    } finally {
      setBusy(null)
    }
  }

  const search = async () => {
    if (busy) return
    const numOr = (s: string) => (s.trim() === '' ? undefined : Number(s))
    const filters: NoaaSearchFilters = {
      investigators: investigators || undefined,
      dataTypeId: dataTypeId || undefined,
      variableName: variableName || undefined,
      cvMaterials: cvMaterials || undefined,
      cvSeasonalities: cvSeasonalities || undefined,
      species: species || undefined,
      locations: locations || undefined,
      minLat: numOr(minLat), maxLat: numOr(maxLat),
      minLon: numOr(minLon), maxLon: numOr(maxLon),
      minElevation: numOr(minElevation), maxElevation: numOr(maxElevation),
      earliestYear: numOr(earliestYear), latestYear: numOr(latestYear),
      reconstructionOnly: reconstructionOnly || undefined,
    }
    const anyFilter = Object.values(filters).some(v => v !== undefined)
    if (!query.trim() && !anyFilter) return
    setBusy('Searching NOAA…')
    setError(null)
    setNotice(null)
    setResults(null)
    setSelectedId(null)
    try {
      const studies = await searchNoaaStudies(query, filters)
      if (!studies.length) {
        setNotice('No NOAA studies matched. Try broadening your search terms or clearing a filter.')
      } else {
        setResults(studies)
        // A single hit is shown expanded for review — never auto-imported.
        if (studies.length === 1) setSelectedId(studies[0].NOAAStudyId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setBusy(null)
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
          placeholder="NOAA study ID, study URL, or keywords"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search() }}
          disabled={!!busy}
        />
        <button className="btn" onClick={search} disabled={!!busy}>
          Search
        </button>
      </div>

      <div className="noaa-import-secondary">
        <button
          className="noaa-advanced-toggle"
          onClick={() => setShowAdvanced(s => !s)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? '▾' : '▸'} More filters
        </button>
        <label className="noaa-file-link" title="Open a NOAA-templated .txt file from your computer">
          or open a local NOAA .txt file
          <input
            type="file"
            accept=".txt,.csv,.tsv,.dat,text/plain"
            style={{ display: 'none' }}
            onChange={e => { openLocalNoaaFile(e.target.files?.[0]); e.target.value = '' }}
          />
        </label>
      </div>

      {showAdvanced && (
        <div className="noaa-advanced">
          <label className="query-field">
            <span>Investigator</span>
            <input value={investigators} onChange={e => setInvestigators(e.target.value)}
              placeholder="e.g. Khider" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Archive type</span>
            <select value={dataTypeId} onChange={e => setDataTypeId(e.target.value)}>
              <option value="">Any</option>
              {NOAA_DATA_TYPES.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="query-field">
            <span>Variable</span>
            {/* NOAA's cvWhats uses its own vocabulary (not LiPD names), e.g. "Sea Surface Temperature" */}
            <input value={variableName} onChange={e => setVariableName(e.target.value)}
              placeholder="e.g. Sea Surface Temperature" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Material</span>
            <input value={cvMaterials} onChange={e => setCvMaterials(e.target.value)}
              placeholder="e.g. calcite" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Seasonality</span>
            <input list="noaa-seasonality-list" value={cvSeasonalities} onChange={e => setCvSeasonalities(e.target.value)}
              placeholder="e.g. Annual" onKeyDown={e => { if (e.key === 'Enter') search() }} />
            <datalist id="noaa-seasonality-list">{SEASONALITY.map(v => <option key={v} value={v} />)}</datalist>
          </label>
          <label className="query-field">
            <span>Species <em>(4-letter code)</em></span>
            <input value={species} onChange={e => setSpecies(e.target.value)}
              placeholder="e.g. PCGL" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <label className="query-field">
            <span>Location</span>
            <input value={locations} onChange={e => setLocations(e.target.value)}
              placeholder="e.g. Continent>Africa" onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </label>
          <div className="noaa-range">
            <span className="noaa-range-title">Latitude</span>
            <input type="number" step="any" placeholder="min" value={minLat} onChange={e => setMinLat(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={maxLat} onChange={e => setMaxLat(e.target.value)} />
          </div>
          <div className="noaa-range">
            <span className="noaa-range-title">Longitude</span>
            <input type="number" step="any" placeholder="min" value={minLon} onChange={e => setMinLon(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={maxLon} onChange={e => setMaxLon(e.target.value)} />
          </div>
          <div className="noaa-range">
            <span className="noaa-range-title">Elevation (m)</span>
            <input type="number" step="any" placeholder="min" value={minElevation} onChange={e => setMinElevation(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={maxElevation} onChange={e => setMaxElevation(e.target.value)} />
          </div>
          <div className="noaa-range">
            <span className="noaa-range-title">Year (CE)</span>
            <input type="number" step="any" placeholder="from" value={earliestYear} onChange={e => setEarliestYear(e.target.value)} />
            <input type="number" step="any" placeholder="to" value={latestYear} onChange={e => setLatestYear(e.target.value)} />
          </div>
          <label className="noaa-check">
            <input type="checkbox" checked={reconstructionOnly} onChange={e => setReconstructionOnly(e.target.checked)} />
            Reconstructions only
          </label>
        </div>
      )}

      {busy && <p className="noaa-import-status" aria-live="polite">{busy}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="noaa-import-empty" aria-live="polite">{notice}</p>}
      {results && (
        <div className="noaa-results-wrap">
          <p className="noaa-results-hint">Select a study to preview it, then import.</p>
          <ul className="noaa-results">
            {results.map(s => {
              const selected = selectedId === s.NOAAStudyId
              const loc = studyLocation(s)
              const span = timeSpan(s)
              const names = tableNames(s)
              const pub = primaryPub(s)
              return (
                <li key={s.NOAAStudyId} className={selected ? 'noaa-result selected' : 'noaa-result'}>
                  <button
                    type="button"
                    className="noaa-result-head"
                    onClick={() => setSelectedId(selected ? null : s.NOAAStudyId)}
                    aria-expanded={selected}
                  >
                    <span className="noaa-result-title">{s.studyName}</span>
                    <span className="noaa-result-tags">
                      <span className="noaa-tag">{prettyArchive(s.dataType)}</span>
                      {s.reconstruction === 'Y' && <span className="noaa-tag noaa-tag-alt">Reconstruction</span>}
                    </span>
                    <span className="noaa-result-summary">
                      {s.investigators && <span>{s.investigators}</span>}
                      {loc.label && <span>{loc.label}{loc.siteCount > 1 ? ` +${loc.siteCount - 1} sites` : ''}</span>}
                      {span && <span>{span}</span>}
                      {names.length > 0 && <span>{names.length} {names.length === 1 ? 'table' : 'tables'}</span>}
                      <span className="noaa-result-id">NOAA {s.NOAAStudyId}</span>
                    </span>
                  </button>

                  {selected && (
                    <div className="noaa-result-detail">
                      <dl className="noaa-detail-grid">
                        {s.investigators && (<><dt>Investigators</dt><dd>{s.investigators}</dd></>)}
                        {loc.label && (
                          <><dt>Location</dt><dd>{loc.label}{loc.coords ? ` · ${loc.coords}` : ''}</dd></>
                        )}
                        {span && (<><dt>Time span</dt><dd>{span}</dd></>)}
                        {names.length > 0 && (
                          <><dt>Data tables</dt>
                            <dd>{names.length}{names.length ? ` — ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}` : ''}</dd></>
                        )}
                        {s.contributionDate && (<><dt>Contributed</dt><dd>{s.contributionDate}</dd></>)}
                      </dl>

                      {loc.siteCount > 1 && (
                        <div className="noaa-detail-block">
                          <span className="noaa-detail-label">Sites</span>
                          <ul className="noaa-detail-sites">
                            {siteList(s).map((site, i) => (
                              <li key={i}>{site.name}{site.coords ? ` · ${site.coords}` : ''}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {s.scienceKeywords && s.scienceKeywords.length > 0 && (
                        <div className="noaa-detail-keywords">
                          {s.scienceKeywords.map((k, i) => <span key={i} className="noaa-keyword">{k}</span>)}
                        </div>
                      )}

                      {pub && (
                        <p className="noaa-detail-pub">
                          {pub.citation}{pub.title ? `. ${pub.title}` : ''}
                          {pub.doi && (
                            <> · <a href={pub.url || `https://doi.org/${pub.doi}`} target="_blank" rel="noreferrer">doi:{pub.doi}</a></>
                          )}
                        </p>
                      )}

                      {s.studyNotes && <p className="noaa-detail-notes">{s.studyNotes}</p>}

                      <div className="noaa-result-actions">
                        <button type="button" className="btn" onClick={() => importStudy(s)} disabled={!!busy}>
                          Import to workspace
                        </button>
                        {s.onlineResourceLink && (
                          <a className="noaa-ext-link" href={s.onlineResourceLink} target="_blank" rel="noreferrer">
                            View at NOAA ↗
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
