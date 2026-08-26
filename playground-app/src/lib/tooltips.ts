// Field help text for the metadata editors. The bulk is ported verbatim from
// the old AngularJS Playground's tooltipLibrary
// (website/public/modules/ng_create.js); entries marked "new" cover fields the
// React app added. Keyed by a flat, dotted name the components pass to <InfoTip>.
// "NA" placeholder tips from the old library are intentionally dropped.

export const TOOLTIPS: Record<string, string> = {
  // ---- Dataset (root) ----
  dataSetName: "Please use the format 'Name.Location.Year' for your dataset name.",
  archiveType: 'Which ProxyArchive underlies this ProxySystem?',
  investigators: 'Use the format: LastName, FirstName; LastName, FirstName; …',
  createdBy: 'Where did this file originate from? How was the LiPD file created?',
  notes: 'Anything you would like the user to know about this dataset, including keywords — anything you cannot fit elsewhere and want to document.',
  datasetId: 'A unique identifier for this dataset, assigned automatically.', // new

  // ---- Site (geo) ----
  siteName: 'The name of the site where the dataset was collected.', // new
  latitude: 'The latitude value in decimal degrees, from -90 to 90.',
  longitude: 'The longitude value in decimal degrees, from -180 to 180.',
  elevation: 'Elevation value in meters.',
  location: 'A named location for the site (e.g. a water body, region, or GCMD term such as OCEAN>ATLANTIC OCEAN>NORTH ATLANTIC OCEAN).',

  // ---- Publication ----
  'pub.title': 'What is the title of the publication?',
  'pub.author': 'Who wrote (created) the resource? Use the format: LastName, FirstName; separate authors with semicolons.',
  'pub.journal': 'What is the name of the journal in which the resource can be found?',
  'pub.year': 'What year was the publication issued?',
  'pub.volume': 'In which volume of the publication does the reference appear?',
  'pub.pages': 'On what pages of the publication can the reference be found?',
  'pub.doi': 'The digital object identifier associated with the resource. Example: 10.1000/sample123.',
  'pub.abstract': 'The publication abstract (recommended for a NOAA submission).', // new

  // ---- Funding ----
  'funding.agency': 'Which entity funded the dataset?',
  'funding.grant': 'What was the funding source (grant number) for the dataset?',
  'funding.investigator': 'Who was the lead on the source of funding for the dataset?',
  'funding.country': 'Which nation funded the dataset?',

  // ---- NOAA submission ----
  earliestYear: "Oldest year in the 'time unit' specified.",
  mostRecentYear: "Youngest year in the 'time unit' specified.",
  timeUnit: 'The standard measure of the dimension in which events occur in sequence (where applicable, 1950 CE is present). E.g. "cal yr BP".',
  datasetDOI: 'The digital object identifier associated with this dataset, if one exists. Example: 10.1000/sample123.',
  originalDataUrl: 'The URL of the original source of this dataset (e.g. the NOAA study landing page).', // new
  onlineResource: 'A URL for a related online resource. For details request the NOAA LiPD Guide via paleo@noaa.gov.',

  // ---- Column ----
  variableName: 'Description of what was measured. Controlled values are required for NOAA (request the NOAA LiPD Guide via paleo@noaa.gov).',
  units: 'In what unit of measure is the variable expressed? Controlled values are required for NOAA. Use "unitless" if units do not apply.',
  description: 'What additional details would you give about this variable?',
  proxy: 'What type of proxy observation is this variable? (e.g. Mg/Ca, d18O, pollen). We derive the general proxy category from this automatically.', // new
  tsid: 'Time Series ID — a unique identifier for this column, assigned automatically.',

  // ---- Interpretation ----
  interpretation: 'Metadata describing which phenomena drove variability in this variable (e.g. environmental drivers).',
  'interp.variable': 'The climate or environmental variable this column is interpreted to record (e.g. temperature, precipitation).', // new
  'interp.variableDetail': 'Additional detail about the interpreted variable (e.g. season, water mass, source region).', // new
  'interp.seasonality': 'The part of the annual cycle the interpretation applies to (e.g. Annual, JJA, growing season).', // new
  'interp.direction': 'As the measured value increases, does the interpreted variable increase (positive) or decrease (negative)?',
  'interp.scope': 'The scope of the interpretation — climate or isotope.', // new
  'interp.basis': 'The basis or reasoning for this interpretation.', // new

  // ---- NOAA study search ----
  'search.studyId': 'Fetch one study directly by its NOAA/NCEI study id (e.g. 2429). Overrides the keyword and filter search.',
  'search.studyUrl': 'Paste a NOAA study landing-page URL (…/paleo-search/study/2429) to fetch that study directly.',
  'search.text': 'Free-text keyword search across a study\'s title, abstract, and metadata. Combine with the filters below to narrow results.',
  'search.investigators': 'Author / principal investigator, as "LastName, Initials" (e.g. "Dansgaard, W."). Add several to match any (or all) of them.',
  'search.archiveType': 'The kind of paleoclimate archive the data come from (coral, ice core, tree ring, speleothem, …).',
  'search.variable': 'What was measured, using NOAA\'s PaST vocabulary (e.g. "surface temperature", "delta 18O") — not LiPD variable names. Pick from the list; NOAA matches on the term.',
  'search.material': 'The material analysed, from NOAA\'s vocabulary (e.g. "aragonite", "wood", "planktic foraminifer").',
  'search.seasonality': 'The part of the year the record represents (e.g. "annual", "5-month period>May-Sep"), from NOAA\'s seasonality vocabulary.',
  'search.species': 'A 4-letter species code (mainly tree-ring taxa), e.g. "PCGL" for Picea glauca.',
  'search.location': 'A hierarchical place, e.g. "Continent>Africa>Eastern Africa>Tanzania". Pick from the list to match the exact term NOAA expects.',
  'search.keywords': 'NOAA\'s controlled science-keyword hierarchy (e.g. "earth science>paleoclimate>climate forcing"). Different from the free-form keywords shown on result cards.',
  'search.latitude': 'Latitude bounds in decimal degrees (-90 to 90). A study can span sites in more than one region — check results.',
  'search.longitude': 'Longitude bounds in decimal degrees (-180 to 180).',
  'search.elevation': 'Site elevation bounds in metres (negative for below sea level).',
  'search.year': 'Time span to match. Use the CE/BP toggle to switch between calendar years (CE) and years before present (BP).',
  'search.timeMatch': 'How a study must relate to the Year range above: span the whole range (its data covers all of it — the default), overlap the range (any overlap), or fall within the range (its record lies entirely inside it).',
  'search.recent': 'Show only recently-added studies (about the last two years), newest first.',
  'search.reconstruction': 'Show only climate reconstructions (derived climate series), not raw proxy measurements.',
  'search.andOr': 'When a field has more than one value: match studies with ANY of them, or only those with ALL of them.',
}

export function tip(key: string): string | undefined {
  return TOOLTIPS[key]
}
