import { useEffect, useMemo, useState } from 'react'
import {
  searchNoaaStudies, noaaStudyToLipd, noaaStudyViaService, noaaFileToLipd, noaaFileViaService,
  NOAA_DATA_TYPES, NOAA_SEARCH_LIMIT, type NoaaStudy, type NoaaSearchFilters, type NoaaMultiKey, type AndOr,
} from '../lib/noaa'
import {
  NOAA_CV_WHATS, NOAA_CV_MATERIALS, NOAA_CV_SEASONALITIES, NOAA_LOCATIONS, NOAA_KEYWORDS, NOAA_SPECIES,
} from '../lib/noaaVocab.generated'
import { NoaaResultsMap } from './NoaaResultsMap'
import { NoaaReviewDialog, reviewTables } from './NoaaReviewDialog'
import { InfoTip } from './InfoTip'
import { tip } from '../lib/tooltips'
import type { LipdFile } from '../types/lipd'
import pyleotupsLogo from '../assets/pyleotups_logo.png'

// A snapshot of the whole search state (inputs + results + selection), lifted so
// the Playground can restore "back to search results" after a dataset is opened.
// Transient status (busy/error/spinner) is intentionally excluded.
export interface NoaaSearchSession {
  studyId: string; studyUrl: string; keywords: string; archiveName: string
  results: NoaaStudy[] | null
  selectedId: string | null
  showAdvanced: boolean
  multi: Record<NoaaMultiKey, string[]>
  andOr: Partial<Record<NoaaMultiKey, AndOr>>
  minLat: string; maxLat: string; minLon: string; maxLon: string
  minElevation: string; maxElevation: string
  earliestYear: string; latestYear: string
  timeFormat: 'CE' | 'BP'; timeMethod: string
  recent: boolean; reconstructionOnly: boolean
}

interface Props {
  onLoad: (lipd: LipdFile) => void
  // When set, seed the search state from a prior session (restore-on-remount).
  initialSession?: NoaaSearchSession | null
  // Called with the current snapshot whenever it changes, so the parent can
  // hold onto it and pass it back as initialSession after the workspace closes.
  onSession?: (session: NoaaSearchSession) => void
}

// The multi-value filter fields, in display order, with label / tooltip /
// autocomplete list / placeholder. Keys match NoaaSearchFilters multi-value keys.
const MVF_CONFIG: Array<{ key: NoaaMultiKey; label: string; tipKey: string; listId?: string; placeholder: string }> = [
  { key: 'investigators',   label: 'Investigator', tipKey: 'search.investigators', placeholder: 'e.g. Dansgaard' },
  { key: 'variableName',    label: 'Variable',     tipKey: 'search.variable',      listId: 'noaa-cv-whats',         placeholder: 'e.g. delta 18O' },
  { key: 'cvMaterials',     label: 'Material',     tipKey: 'search.material',      listId: 'noaa-cv-materials',     placeholder: 'e.g. bulk ice' },
  { key: 'cvSeasonalities', label: 'Seasonality',  tipKey: 'search.seasonality',   listId: 'noaa-cv-seasonalities', placeholder: 'e.g. annual' },
  { key: 'species',         label: 'Species',      tipKey: 'search.species',       listId: 'noaa-species',          placeholder: 'e.g. Picea glauca' },
  { key: 'locations',       label: 'Location',     tipKey: 'search.location',      listId: 'noaa-locations',        placeholder: 'e.g. Continent>North America>Greenland' },
  { key: 'keywords',        label: 'Keyword category', tipKey: 'search.keywords',  listId: 'noaa-keywords',         placeholder: 'e.g. climate forcing' },
]

// A chip-style filter: several values, each removable, with an AND/OR toggle
// shown once there are two or more. Optional datalist for autocomplete.
function MultiValueField({ label, tipText, values, onChange, andOr, onAndOr, listId, placeholder }: {
  label: string; tipText?: string
  values: string[]; onChange: (v: string[]) => void
  andOr: AndOr; onAndOr: (v: AndOr) => void
  listId?: string; placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const v = raw.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setDraft('')
  }
  const removeAt = (i: number) => onChange(values.filter((_, j) => j !== i))
  return (
    <div className="query-field mvf">
      <span className="mvf-label">
        {label}{tipText && <InfoTip text={tipText} />}
        {values.length >= 2 && (
          <span className="mvf-andor" role="group" aria-label={tip('search.andOr')}>
            <button type="button" className={andOr !== 'and' ? 'on' : ''} onClick={() => onAndOr('or')} title="Match ANY of these">any</button>
            <button type="button" className={andOr === 'and' ? 'on' : ''} onClick={() => onAndOr('and')} title="Match ALL of these">all</button>
          </span>
        )}
      </span>
      <div className="mvf-box">
        {values.map((v, i) => (
          <span key={v} className="mvf-chip">
            <span className="mvf-chip-text" title={v}>{v}</span>
            <button type="button" onClick={() => removeAt(i)} aria-label={`Remove ${v}`}>×</button>
          </span>
        ))}
        <input
          list={listId}
          value={draft}
          placeholder={values.length ? '' : placeholder}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft) }
            else if (e.key === 'Backspace' && !draft && values.length) removeAt(values.length - 1)
          }}
          onBlur={() => add(draft)}
        />
      </div>
    </div>
  )
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

export function NoaaImport({ onLoad, initialSession, onSession }: Props) {
  // Seed persisted fields from a prior session (read once, on mount) so
  // "back to search results" restores the inputs, results, and selection.
  const s0 = initialSession
  // Base search: three distinct inputs (id / url / keywords) + archive type.
  const [studyId, setStudyId] = useState(() => s0?.studyId ?? '')
  const [studyUrl, setStudyUrl] = useState(() => s0?.studyUrl ?? '')
  const [keywords, setKeywords] = useState(() => s0?.keywords ?? '')
  const [archiveName, setArchiveName] = useState(() => s0?.archiveName ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [results, setResults] = useState<NoaaStudy[] | null>(() => s0?.results ?? null)
  const [selectedId, setSelectedId] = useState<string | null>(() => s0?.selectedId ?? null)
  const [review, setReview] = useState<LipdFile | null>(null)  // human-in-the-loop for heuristic tables
  const [importingId, setImportingId] = useState<string | null>(null)  // study currently importing (spinner)

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(() => s0?.showAdvanced ?? false)
  const [multi, setMulti] = useState<Record<NoaaMultiKey, string[]>>(() => s0?.multi ?? {
    investigators: [], variableName: [], cvMaterials: [], cvSeasonalities: [], species: [], locations: [], keywords: [],
  })
  const [andOr, setAndOr] = useState<Partial<Record<NoaaMultiKey, AndOr>>>(() => s0?.andOr ?? {})
  const setValues = (key: NoaaMultiKey, v: string[]) => setMulti(m => ({ ...m, [key]: v }))
  const setFieldAndOr = (key: NoaaMultiKey, v: AndOr) => setAndOr(a => ({ ...a, [key]: v }))
  const [minLat, setMinLat] = useState(() => s0?.minLat ?? ''); const [maxLat, setMaxLat] = useState(() => s0?.maxLat ?? '')
  const [minLon, setMinLon] = useState(() => s0?.minLon ?? ''); const [maxLon, setMaxLon] = useState(() => s0?.maxLon ?? '')
  const [minElevation, setMinElevation] = useState(() => s0?.minElevation ?? ''); const [maxElevation, setMaxElevation] = useState(() => s0?.maxElevation ?? '')
  const [earliestYear, setEarliestYear] = useState(() => s0?.earliestYear ?? ''); const [latestYear, setLatestYear] = useState(() => s0?.latestYear ?? '')
  const [timeFormat, setTimeFormat] = useState<'CE' | 'BP'>(() => s0?.timeFormat ?? 'CE')
  const [timeMethod, setTimeMethod] = useState(() => s0?.timeMethod ?? 'entireOver') // default: study spans the whole range
  const [recent, setRecent] = useState(() => s0?.recent ?? false)
  const [reconstructionOnly, setReconstructionOnly] = useState(() => s0?.reconstructionOnly ?? false)

  // Report the current snapshot up whenever any persisted field changes, so the
  // parent always holds the latest state to restore after the workspace closes.
  useEffect(() => {
    onSession?.({
      studyId, studyUrl, keywords, archiveName, results, selectedId, showAdvanced,
      multi, andOr, minLat, maxLat, minLon, maxLon, minElevation, maxElevation,
      earliestYear, latestYear, timeFormat, timeMethod, recent, reconstructionOnly,
    })
  }, [
    onSession, studyId, studyUrl, keywords, archiveName, results, selectedId, showAdvanced,
    multi, andOr, minLat, maxLat, minLon, maxLon, minElevation, maxElevation,
    earliestYear, latestYear, timeFormat, timeMethod, recent, reconstructionOnly,
  ])

  // NOAA controlled-vocabulary autocompletes. The option lists are large
  // (~2000 total), so build the <option> elements once rather than per keystroke.
  const whatOpts = useMemo(() => NOAA_CV_WHATS.map(v => <option key={v} value={v} />), [])
  const materialOpts = useMemo(() => NOAA_CV_MATERIALS.map(v => <option key={v} value={v} />), [])
  const seasonOpts = useMemo(() => NOAA_CV_SEASONALITIES.map(v => <option key={v} value={v} />), [])
  const locationOpts = useMemo(() => NOAA_LOCATIONS.map(v => <option key={v} value={v} />), [])
  const keywordOpts = useMemo(() => NOAA_KEYWORDS.map(v => <option key={v} value={v} />), [])
  // Species: submit the 4-letter code, show the Latin name as the option label.
  const speciesOpts = useMemo(() => NOAA_SPECIES.map(s => <option key={s.code} value={s.code} label={`${s.code} — ${s.name}`} />), [])
  // Archive type is a combobox (dropdown + autocomplete) over the type names.
  const archiveOpts = useMemo(() => NOAA_DATA_TYPES.map(d => <option key={d.id} value={d.name} />), [])

  const importStudy = async (study: NoaaStudy) => {
    setBusy(`Importing "${study.studyName}"…`)
    setImportingId(study.NOAAStudyId)
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
      // Fallback-parsed tables with guessed column names get a review step first.
      if (reviewTables(lipd).length) {
        setReview(lipd)
        return
      }
      onLoad(lipd)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(null)
      setImportingId(null)
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
    const hasYear = earliestYear.trim() !== '' || latestYear.trim() !== ''
    const arr = (v: string[]) => (v.length ? v : undefined)
    // A study id or URL is an exact lookup; otherwise search by keywords.
    const q = studyId.trim() || studyUrl.trim() || keywords.trim()
    // Archive type is entered as a name; map it to the NCEI numeric dataTypeId.
    const dataTypeId = NOAA_DATA_TYPES.find(d => d.name.toLowerCase() === archiveName.trim().toLowerCase())?.id
    const filters: NoaaSearchFilters = {
      investigators: arr(multi.investigators),
      variableName: arr(multi.variableName),
      cvMaterials: arr(multi.cvMaterials),
      cvSeasonalities: arr(multi.cvSeasonalities),
      species: arr(multi.species),
      locations: arr(multi.locations),
      keywords: arr(multi.keywords),
      andOr,
      dataTypeId: dataTypeId || undefined,
      minLat: numOr(minLat), maxLat: numOr(maxLat),
      minLon: numOr(minLon), maxLon: numOr(maxLon),
      minElevation: numOr(minElevation), maxElevation: numOr(maxElevation),
      earliestYear: numOr(earliestYear), latestYear: numOr(latestYear),
      // timeFormat/timeMethod only apply to a year bound — omit them otherwise.
      timeFormat: hasYear ? timeFormat : undefined,
      timeMethod: hasYear && timeMethod ? timeMethod : undefined,
      recent: recent || undefined,
      reconstructionOnly: reconstructionOnly || undefined,
    }
    const anyFilter =
      Object.values(multi).some(v => v.length > 0) || !!dataTypeId || recent || reconstructionOnly ||
      [minLat, maxLat, minLon, maxLon, minElevation, maxElevation, earliestYear, latestYear].some(s => s.trim() !== '')
    if (!q && !anyFilter) return
    setBusy('Searching NOAA…')
    setError(null)
    setNotice(null)
    setResults(null)
    setSelectedId(null)
    try {
      const studies = await searchNoaaStudies(q, filters)
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

  const renderMVF = (key: NoaaMultiKey) => {
    const cfg = MVF_CONFIG.find(c => c.key === key)!
    return (
      <MultiValueField
        label={cfg.label} tipText={tip(cfg.tipKey)}
        values={multi[key]} onChange={v => setValues(key, v)}
        andOr={andOr[key] ?? 'or'} onAndOr={v => setFieldAndOr(key, v)}
        listId={cfg.listId} placeholder={cfg.placeholder}
      />
    )
  }

  return (
    <div className="noaa-import">
      <div className="noaa-base-grid">
        <label className="query-field">
          <span>NOAA study ID<InfoTip text={tip('search.studyId')} /></span>
          <input inputMode="numeric" placeholder="e.g. 2429" value={studyId}
            onChange={e => setStudyId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }} disabled={!!busy} />
        </label>
        <label className="query-field">
          <span>Study URL<InfoTip text={tip('search.studyUrl')} /></span>
          <input placeholder="…/paleo-search/study/2429" value={studyUrl}
            onChange={e => setStudyUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }} disabled={!!busy} />
        </label>
        <label className="query-field">
          <span>Keywords<InfoTip text={tip('search.text')} /></span>
          <input placeholder="e.g. Camp Century oxygen isotope" value={keywords}
            onChange={e => setKeywords(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }} disabled={!!busy} />
        </label>
        <label className="query-field">
          <span>Archive type<InfoTip text={tip('search.archiveType')} /></span>
          <input list="noaa-archive-types" placeholder="e.g. Ice cores" value={archiveName}
            onChange={e => setArchiveName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }} disabled={!!busy} />
          <datalist id="noaa-archive-types">{archiveOpts}</datalist>
        </label>
      </div>

      <div className="noaa-import-secondary">
        <button className="btn" onClick={search} disabled={!!busy}>
          Search
        </button>
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
        <a
          className="noaa-import-logo"
          href="https://github.com/LinkedEarth/PyleoTUPS"
          target="_blank"
          rel="noreferrer"
          title="NOAA import based on PyleoTUPS — view on GitHub"
        >
          <img src={pyleotupsLogo} alt="PyleoTUPS" />
        </a>
      </div>

      {showAdvanced && (
        <div className="noaa-advanced">
          <fieldset className="noaa-group">
            <legend>Proxy &amp; material</legend>
            <div className="noaa-group-grid">
              {renderMVF('variableName')}
              {renderMVF('cvMaterials')}
              {renderMVF('cvSeasonalities')}
              {renderMVF('species')}
            </div>
          </fieldset>

          <fieldset className="noaa-group">
            <legend>Location</legend>
            <div className="noaa-group-grid">
              {renderMVF('locations')}
              <div className="noaa-range">
                <span className="noaa-range-title">Latitude<InfoTip text={tip('search.latitude')} /></span>
                <input type="number" step="any" placeholder="min" value={minLat} onChange={e => setMinLat(e.target.value)} />
                <input type="number" step="any" placeholder="max" value={maxLat} onChange={e => setMaxLat(e.target.value)} />
              </div>
              <div className="noaa-range">
                <span className="noaa-range-title">Longitude<InfoTip text={tip('search.longitude')} /></span>
                <input type="number" step="any" placeholder="min" value={minLon} onChange={e => setMinLon(e.target.value)} />
                <input type="number" step="any" placeholder="max" value={maxLon} onChange={e => setMaxLon(e.target.value)} />
              </div>
              <div className="noaa-range">
                <span className="noaa-range-title">Elevation (m)<InfoTip text={tip('search.elevation')} /></span>
                <input type="number" step="any" placeholder="min" value={minElevation} onChange={e => setMinElevation(e.target.value)} />
                <input type="number" step="any" placeholder="max" value={maxElevation} onChange={e => setMaxElevation(e.target.value)} />
              </div>
            </div>
          </fieldset>

          <fieldset className="noaa-group">
            <legend>Time</legend>
            <div className="noaa-time-group">
              <div className="noaa-range">
                <span className="noaa-range-title">
                  Year
                  <select className="noaa-time-basis" value={timeFormat}
                    onChange={e => setTimeFormat(e.target.value as 'CE' | 'BP')} aria-label="Year basis (CE or years BP)">
                    <option value="CE">CE</option>
                    <option value="BP">BP</option>
                  </select>
                  <InfoTip text={tip('search.year')} />
                </span>
                <input type="number" step="any" placeholder={timeFormat === 'BP' ? 'oldest' : 'from'} value={earliestYear} onChange={e => setEarliestYear(e.target.value)} />
                <input type="number" step="any" placeholder={timeFormat === 'BP' ? 'youngest' : 'to'} value={latestYear} onChange={e => setLatestYear(e.target.value)} />
              </div>
              <label className="query-field noaa-time-match">
                <span>Studies must<InfoTip text={tip('search.timeMatch')} /></span>
                <select value={timeMethod} onChange={e => setTimeMethod(e.target.value)}>
                  <option value="entireOver">span the whole Year range</option>
                  <option value="overAny">overlap the Year range</option>
                  <option value="overEntire">fall within the Year range</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="noaa-group">
            <legend>Study</legend>
            <div className="noaa-group-grid">
              {renderMVF('investigators')}
              {renderMVF('keywords')}
            </div>
            <div className="noaa-checks">
              <label className="noaa-check">
                <input type="checkbox" checked={recent} onChange={e => setRecent(e.target.checked)} />
                Recently added<InfoTip text={tip('search.recent')} />
              </label>
              <label className="noaa-check">
                <input type="checkbox" checked={reconstructionOnly} onChange={e => setReconstructionOnly(e.target.checked)} />
                Reconstructions only<InfoTip text={tip('search.reconstruction')} />
              </label>
            </div>
          </fieldset>

          {/* Shared autocomplete lists (referenced by the fields above via list=). */}
          <datalist id="noaa-cv-whats">{whatOpts}</datalist>
          <datalist id="noaa-cv-materials">{materialOpts}</datalist>
          <datalist id="noaa-cv-seasonalities">{seasonOpts}</datalist>
          <datalist id="noaa-locations">{locationOpts}</datalist>
          <datalist id="noaa-keywords">{keywordOpts}</datalist>
          <datalist id="noaa-species">{speciesOpts}</datalist>
        </div>
      )}

      {busy && <p className="noaa-import-status" aria-live="polite">{busy}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="noaa-import-empty" aria-live="polite">{notice}</p>}
      {results && (
        <div className="noaa-results-wrap">
          <NoaaResultsMap
            results={results}
            selectedId={selectedId}
            onSelect={id => {
              setSelectedId(id)
              setTimeout(() => document.getElementById(`noaa-result-${id}`)?.scrollIntoView({ block: 'nearest' }), 60)
            }}
          />
          <p className="noaa-results-hint">Select a study on the map or in the list to preview it, then import.</p>
          {results.length >= NOAA_SEARCH_LIMIT && (
            <p className="noaa-results-capped" role="note">
              Showing the first {NOAA_SEARCH_LIMIT} matches — there may be more.
              Add filters or search terms to narrow the results.
            </p>
          )}
          <ul className="noaa-results">
            {results.map(s => {
              const selected = selectedId === s.NOAAStudyId
              const loc = studyLocation(s)
              const span = timeSpan(s)
              const names = tableNames(s)
              const pub = primaryPub(s)
              return (
                <li key={s.NOAAStudyId} id={`noaa-result-${s.NOAAStudyId}`} className={selected ? 'noaa-result selected' : 'noaa-result'}>
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
                        <button
                          type="button"
                          className="btn"
                          onClick={() => importStudy(s)}
                          disabled={!!busy}
                          aria-busy={importingId === s.NOAAStudyId}
                        >
                          {importingId === s.NOAAStudyId ? (
                            <>
                              <svg className="btn-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                                <circle cx={12} cy={12} r={9} strokeOpacity={0.3} />
                                <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
                              </svg>
                              Importing…
                            </>
                          ) : 'Import to workspace'}
                        </button>
                        {importingId === s.NOAAStudyId && (
                          <span className="noaa-import-hint" aria-live="polite">Fetching &amp; parsing from NOAA — this can take up to ~20&nbsp;seconds.</span>
                        )}
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

      {review && (
        <NoaaReviewDialog
          lipd={review}
          onConfirm={lipd => { setReview(null); onLoad(lipd) }}
          onCancel={() => setReview(null)}
        />
      )}
    </div>
  )
}
