# Playground — To-do (from Zoom meeting, 2026-07-14)

Captured from memory after the recording failed. Three workstreams plus two
blockers to clear first.

---

## 🎯 Year-3 focus (per NSF Year-2 report, 2026-08)

The NSF Year-2 report reframes priorities: pyleoTUPS (Objectives 1–3) is
"largely achieved"; **Year 3 is dedicated to Objectives 4 (community) and 5
(training)**, and the **LiPD Playground is the primary vehicle** for both.
D. Edge is named as lead on Playground/PyleoTUPS integration.

**Active focus — NOAA data import, two objectives:**
1. **Best-in-class query experience** — bring the Playground's NOAA search up to
   (or past) what pyleoTUPS/NCEI expose, with a UX a bench scientist can drive.
2. **Load data as well or better than pyleoTUPS** — full fidelity of tables,
   columns, values, units, and metadata on import; match or beat the Python
   package's extraction on the same study IDs.

**Objective 1 — shipped so far (no pagination/result-count, by design):**
- [x] **Previewable result cards** — rich cards (title, archive-type tag,
  investigators, location, time span, table count) that expand to a preview
  (coords, table names, sites, keywords, publication + DOI, notes) with an
  explicit "Import to workspace" button; single-hit searches are previewed, not
  auto-imported. Verified headless 11/11.
- [x] **CV autocomplete** — `scripts/generate-noaa-vocab.mjs` extracts NCEI's
  controlled vocab from `study/params.json` into `src/lib/noaaVocab.generated.ts`
  (1156 cvWhats leaves, 301 materials, 100 seasonalities, 360 locations);
  Variable/Material/Seasonality/Location filters now autocomplete from it
  (Seasonality was previously the wrong LiPD vocab). NCEI substring-matches, so
  human-readable leaf terms are valid queries. Verified headless 16/16.
- [x] **Results map** — `NoaaResultsMap.tsx` (react-leaflet + OSM, reusing the
  QueryMap approach) plots a marker per located study from its primary-site
  POINT coords; clicking a marker selects & expands that study's card and
  scrolls it into view. Studies without point coords are noted and omitted.
  Verified headless 18/18.
- [x] **Time controls** — CE/BP basis toggle on the Year filter + a "Time match"
  dropdown (Overlaps range / Spans the whole range / Within the range →
  overAny/entireOver/overEntire). `timeFormat`/`timeMethod` only sent with a year
  bound (NCEI defaults CE + overAny). Semantics confirmed against pyleoTUPS
  ("overlap, envelop, or within") and empirically (overEntire returns a strict
  subset). Verified headless 23/23 (incl. request-param assertion timeFormat=BP,
  timeMethod=overEntire actually reach NCEI).
- [x] **Full pyleoTUPS parity + field tooltips** — the 7 categorical filters
  (investigator, variable, material, seasonality, species, location, keywords)
  are now multi-value chip inputs, each with an AND/OR toggle at 2+ values
  (`<field>AndOr`, only sent when ≥2, NCEI default `or`); values joined with `|`
  (URLSearchParams encodes as %7C). Added the **Keywords** filter (137-term NCEI
  keyword hierarchy — distinct from the free-form scienceKeywords on cards) and a
  **Recently added** toggle (`recent=true`). Every query field now carries an
  InfoTip (search.* keys in tooltips.ts). AndOr wire format confirmed against
  pyleoTUPS validators (`and`/`or`) and the live endpoint. Verified headless
  31/31, incl. a request-param assertion that a 2-value cvWhats + AND + recent +
  BP + overEntire all reach NCEI in one request.
- [x] **Base-search split + combobox consistency** — the single "ID / URL /
  keywords" box became four distinct default-visible inputs: **NOAA study ID**,
  **Study URL**, **Keywords** (searchText), and **Archive type** (now a
  combobox: dropdown + autocomplete over the 17 type names, mapped to
  dataTypeId). Every controlled-vocab field is now the same combobox pattern:
  **Species** gained autocomplete (386 code↔name entries; shows the Latin name,
  submits the 4-letter code). Investigator example → "Rasmussen"; the advanced
  controlled keyword field renamed "Keyword category" to disambiguate from the
  base Keywords search. Verified headless 34/34.
- [x] **Grouped filters + clearer time match** — the advanced panel is now
  organized into labeled groups (Proxy & material / Location / Time / Study);
  Year and the time-match control sit together in the Time group so their link
  is obvious. "Time match" reworded as a sentence ("Studies must **span the
  whole Year range** / overlap / fall within") and its default changed to
  **span the whole range** (`entireOver`; was overlap). Verified headless 37/37.
- [ ] Remaining: numeric-range validation; server-side search proxy fallback
  (CORS resilience). Optionally archive-type-scoped CV suggestions (params.json
  is scoped by dataTypeId).

**Objective 2 — load fidelity (match/beat pyleoTUPS):**
- [x] **Per-variable cv* metadata → LiPD proxy + more.** The service used to keep
  only the units leaf and drop the rest of PyleoTUPS' per-variable block. Now
  `noaa-service` threads name/unit/**proxy (cvWhat leaf)**/material (cvMaterial)/
  method (cvMethod)/seasonality/description through for both the normal and
  fallback paths (age/depth/sampling columns get no proxy). Column↔variable
  matching: exact name → prefix → positional (guarded on equal count; safe in the
  normal path since PyleoTUPS parses data + variable block from the same
  template). Client `serviceToLipd` populates `proxy` (normalized via synonyms),
  auto-derives `proxyGeneral`, and sets description / measurementMaterial /
  method. Added NOAA's space-form isotope leaves (`delta 18O`→d18O, etc.) to the
  proxy synonyms. Verified: 27490/2429 columns import with proxy+units+material;
  headless 38/38 asserts an imported column carries proxy=d18O, proxyGeneral=
  isotopic (read back from the autosaved session). Limitation: studies PyleoTUPS
  mis-parses (mismatched column/variable counts, e.g. 1003965) still get no
  proxy.
- [x] **Chron/paleo table separation.** Neither PyleoTUPS nor NCEI flags this
  (PyleoTUPS has no ChronData concept; NCEI puts everything under paleoData), so
  it's a conservative heuristic in the service: a chron table is one whose NAME
  matches chron/age-model/radiocarbon/14C/dating/… OR one with NO proxy column
  but age-control-style columns. Biased toward paleo so a real proxy table is
  never stranded. `serviceToLipd` routes `kind === 'chron'` tables into
  `chronData` (separate filenames), the rest into `paleoData`. Verified: 33213 →
  7 paleoData + 1 chronData ("U1446 Age Model"); 27490/2429 all paleo; headless
  42/42 (chron routed correctly, read back from the autosaved session). Note:
  the cleanest signal, NCEI's `>age control` keyword, isn't exposed by PyleoTUPS
  to the service — a future refinement could fetch it. Measured its prevalence
  against the live NCEI API (500-study sample, 1990–2026): `NOAAKeywords` is
  ~100% populated, but only ~6% of studies carry an age-control table and only
  ~40% of those are age-control-ONLY (true standalone chronology) — the rest mix
  age control with a proxy keyword and must stay paleo. So the keyword is a
  high-precision / low-prevalence signal; with user re-designation as the safety
  net it's optional, not required.
- [x] **User re-designation of chron/paleo after import.** The heuristic guess is
  now correctable: `moveTableToSection()` (lib/lipd.ts) + a "Make chron" / "Make
  paleo" toolbar button in the DataEditor move any measurement table between
  paleoData and chronData, keeping tableName + data, relabeling only the
  filename prefix, and pruning an emptied source section. Verified headless
  46/46: reclassifying 33213's Age Model flips 7p/1c → 8p/0c, all 87 columns
  preserved, filenames relabeled paleo0..7.
- [x] **Geo site-point (not the coverage-box SW corner).** `build_payload` used
  the SW corner of the summary's coverage box (`cov[S]`, `cov[W]`), which is the
  envelope across ALL of a study's sites — so multi-site studies mislocated to a
  corner nowhere near a real site (AICC2012/15076's box spans Antarctica→
  Greenland; the old geo was ~-78.47,-42.32 in the South Atlantic). Now it uses
  the real per-site point from `get_tables()` (MinLat/MaxLat midpoint, consistent
  with siteName/elevation already taken from the first site), with the box CENTER
  as fallback. Point studies (Min==Max) are unchanged. Verified: 15076 → Vostok
  (-78.47, 106.8); 2429/33213 unchanged; service suite 15/15.
- [x] **Study-level metadata (funding / abstract / dataset DOI).** PyleoTUPS
  drops these; now `build_payload` carries `StudyNotes` → `metadata.notes` (the
  NOAA "Description_Notes_and_Keywords" the exporter round-trips), `Funding`
  ([{fundingAgency, fundingGrant}] → [{agency, grant}], feeding the existing
  funding editor), and the dataset landing-page DOI → `metadata.datasetDOI`
  (validated + editable). The DOI isn't in the PyleoTUPS summary/metadata/
  to_dict, so the service reads it from the NCEI search record directly (best-
  effort, never fails the import). Verified: 33213 → 4 funding entries + DOI +
  notes; 2429 → DOI + 977-char abstract + empty funding; service suite 17/17,
  headless 47/47 (metadata read back from the imported session).
- [x] **Seasonality → column interpretation block.** NOAA cvSeasonality is
  hierarchical ("non-calendric period>summer", "1-month period>Jul"); the service
  now returns the leaf ("summer", "Jul") via `_cv_leaf` (like material), and
  `serviceToLipd` puts it in the LiPD-native home — `column.interpretation =
  [{ seasonality }]` — canonicalizing onto the LiPD SEASONALITY vocab casing via
  a new `normalizeSeasonality` (annual→Annual, summer→Summer, …; 79/100 NOAA
  leaves match exactly, 8 differ only in case), keeping the leaf verbatim when
  there's no vocab entry. Verified: 5466 (Baffin summer temp) → Temp_degC with
  interpretation.seasonality "Summer"; service 18/18, headless 48/48.

**Objective 2 is complete** — load fidelity now matches or beats PyleoTUPS:
per-variable proxy/material/method/description, chron/paleo separation with user
re-designation, real site-point geo, study-level funding/abstract/DOI, and
seasonality interpretation. (The parked items — PANGAEA time search,
NOAA-not-in-LiPDverse gap discovery — remain for later.)

### 📌 Parked (revisit after the NOAA-import focus)
- **PANGAEA time-period search.** Report flags time as "a very important query
  parameter for paleoclimatologists"; PANGAEA has no native time filter, so it
  needs a client-side earliest/latest-year filter on results (extends workstream
  B's deferred paging/time UI).
- **"Datasets in NOAA but not yet in LiPDverse" (gap-dataset discovery).** From
  Deborah's 2026-06-22 Hydroclimate2k demo — flag whether a NOAA/PANGAEA record
  already exists in LiPDverse to surface import-worthy gaps.

## ⚠️ Blockers / missing inputs
- [x] ~~PyleoTUPS tutorial link~~ → <https://linked.earth/pyleotupsTutorials/>
  (tutorial DOI 10.5281/ZENODO.16923278). Structure: `a-dataset`,
  `b-dataprovider`, `c-pyleotupsdesign`, `a-noaaobject`,
  `d-pangaeacredentialsetup`, plus "Doing Science with PyleoTUPS" pages.
- [ ] **Google Drive synonyms folder needs re-auth** — the Drive connection
  token has expired, so the synonyms work
  ([folder](https://drive.google.com/drive/u/0/folders/1jAcODUu4Fotm59C5cLeObz2QNwYjT9KH))
  couldn't be read yet (workstream C). Re-authorize Google Drive, then I can
  review it.
- [ ] **Check PANGAEA credential requirements** — there's a
  `d-pangaeacredentialsetup` tutorial page; confirm whether our deployed
  `noaa-service` needs PANGAEA credentials for any datasets (affects B and the
  container config).

---

## A. PyleoTUPS tutorials → test examples in the Playground
Goal: run the tutorial examples through the Playground and confirm they import
cleanly; use failures to harden the `noaa-service` / PyleoTUPS path.
Tutorials: <https://linked.earth/pyleotupsTutorials/>

- [x] Enumerated all 11 tutorial pages and built a regression matrix (all example
  IDs + expectations). Test script committed at
  `noaa-service/test_tutorial_examples.mjs` (run the service, then
  `node test_tutorial_examples.mjs`).
- [x] Ran every concrete example through the service — **10/10 pass**: NOAA
  13156 (metadata-only), **33213 (8 tables, TEX86H+SST)**, 27490 (coral,
  age+d18O), 10420 (13 tables, multi-site), 36778; PANGAEA 965772, 830587,
  868935. No parsing failures / garbage tables.
- [x] **PANGAEA collection expansion — done.** `/pangaea/{id}` now detects a
  collection (via `CollectionMembers`) and returns a member pick-list; the
  PangaeaImport UI shows the members plus an "Import all N together" button.
  `?expand=1` merges the members into one dataset (one table each, capped at 25
  with a truncation note), metadata/geo from the parent + first member. Verified:
  830589 → 3-member picker, "import all" → 3 merged tables (isotopes + age +
  Pb-210, site MD98-2177); 971943 → 48-member picker. Headless suite now 84
  checks.
- [ ] Consider adding NOAA 33213 (8-table flagship) to the headless verify suite
  as an end-to-end regression case.
- [x] **Fallback parser for legacy WDC text files** — some old NOAA files (e.g.
  study **2493**, GICC05 Greenland ice-core chronology) use a prose preamble +
  "Column N: name (unit)" legend + a numeric block that PyleoTUPS returns
  *nothing* for (no error, just empty) — so clean, importable data was stranded
  as "metadata only". `noaa-service/app.py` now runs a conservative recovery
  when PyleoTUPS yields no table for a `.txt/.dat/.csv/.tsv` file: find the
  dominant contiguous numeric block, name columns from the legend (or a header
  line), extract units from the legend parens. Binary/proprietary formats
  (.xls/.rwl/.fhx) still fall through to metadata-only. Verified: 2493 → 1 table,
  6 named columns + units, 2088 rows; regression suite 12/12 (13156 still
  metadata-only, all pyleoTUPS-parsed studies unchanged). Follow-up: port the
  same heuristic to the browser fallback parser (lib/noaa.ts) for when the
  service is unavailable.
- [x] **Fallback column naming from PyleoTUPS variable metadata** — for files the
  fallback recovers, PyleoTUPS often still parsed the per-variable metadata
  (names/units) even though it returned no data. The fallback now names columns
  from that metadata when the column count matches, aligning the age/time column
  by value shape (metadata order isn't always the file's column order). Header
  detection is now comma-aware and off-by-one tolerant for old WDC files. Fixes
  study **2429** (Camp Century, our example): its d18O tables import as
  `ice age [year Common Era]` / `delta 18O [per mil SMOW]` and `age_CE` / `d18O`
  instead of Var1/Var2. Regression suite 13/13.
- [x] **Human-in-the-loop review for heuristically-named tables.** Fallback naming
  is inherently prone to error on messy files, so the service now flags a table
  `review: true` when its names came from a heuristic (guessed header line or
  generic VarN) — but NOT when they came from PyleoTUPS variable metadata or an
  explicit "Column N:" legend. On import, `NoaaReviewDialog` shows each flagged
  table with a link to the **original file** and an editable name + value-preview
  per column (generic VarN highlighted); the user confirms or renames before the
  dataset loads. E.g. 2429's messy CC-1 table is flagged; its two clean d18O
  tables are not. Verified headless 40/40 (dialog appears with source link +
  editable columns, confirming loads the workspace, proxy metadata intact).

## B. Extend NOAA + PANGAEA advanced search filters to match PyleoTUPS
Goal: bring our "More filters" (advanced) search options up to parity with what
PyleoTUPS/its backends expose.

**PyleoTUPS `search_studies()` parameters (the target to match):**
- _Shared (NOAA + PANGAEA):_ `search_text`, `min_lat`/`max_lat`,
  `min_lon`/`max_lon`, `investigators`, `variable_name`, `limit`, `skip`.
- _NOAA-only:_ `noaa_id`, `data_type_id`, `locations` (hierarchical geo),
  `species` (4-letter tree codes), `cv_materials`, `cv_seasonalities`,
  `earliest_year`/`latest_year`, `min_elevation`/`max_elevation`,
  `reconstruction` (bool).
- _PANGAEA-only:_ `topic`.

**Current state (baseline):**
- NOAA advanced filters today (`NoaaSearchFilters` in `lib/noaa.ts`,
  `NoaaImport.tsx`): investigators, data type, lat/lon bbox, earliest/latest
  year. Runs against the NOAA NCEI paleo-search API directly from the browser.
  → **Missing vs PyleoTUPS:** `variable_name`, `locations`, `species`,
  `cv_materials`, `cv_seasonalities`, `min_elevation`/`max_elevation`,
  `reconstruction`.
- PANGAEA today (`PangaeaImport.tsx`): **no advanced filters at all** — just one
  box for ID / DOI / keywords. Search runs server-side via PyleoTUPS
  `PangaeaDataset.search_studies(search_text, limit)`.
  → **Missing vs PyleoTUPS:** `min_lat`/`max_lat`, `min_lon`/`max_lon`,
  `investigators`, `variable_name`, `topic`, `skip` (paging).

**Done (commit pending):**
- [x] NOAA: added variable (`cvWhats`), material (`cvMaterials`), seasonality
  (`cvSeasonalities`), species, location (`locations`), elevation range
  (`minElev`/`maxElev`), and a reconstructions-only toggle to `NoaaSearchFilters`
  + `searchNoaaStudies` + the `NoaaImport` "More filters" UI. **Also fixed a bug:
  we were sending `dataType` where NCEI expects `dataTypeId`, and omitting
  `dataPublisher=NOAA`.** Note: `cvWhats` uses NOAA's own vocabulary (e.g. "Sea
  Surface Temperature"), NOT LiPD variable names — the field is free-text with an
  NCEI-style hint, no LiPD datalist.
- [x] PANGAEA: added an advanced-filters panel to `PangaeaImport.tsx`
  (investigators → `author:`, variable → `parameter:`, topic dropdown from the 15
  PyleoTUPS topics, lat/lon bbox) and extended the service `/pangaea-search`
  endpoint + Express proxy + `pangaeaSearch()` client to pass them through to
  `PangaeaDataset.search_studies`.
- [x] Panels share the NOAA "More filters" layout/CSS.
- [x] Headless coverage added (parity-labels check, live cvWhats search, PANGAEA
  advanced-panel render). Suite now 81 checks.
- [ ] (Deferred) `skip`/paging UI for the slow keyword path — endpoint accepts
  `skip`, no UI control yet.

## C. Autofill LiPD metadata from NOAA metadata (synonyms work)
Goal: reuse the prior synonyms/controlled-vocabulary mapping so a NOAA/PANGAEA
import lands on valid LiPD vocabulary instead of raw source strings.

**What's in the Drive folder** ([link](https://drive.google.com/drive/u/0/folders/1jAcODUu4Fotm59C5cLeObz2QNwYjT9KH)):
one Google Sheet per LiPD field, each mapping observed raw strings → the
canonical LiPD name. Common columns: `…_pastName, …_pastId, lipdName, synonym,
definition`. The `synonym → lipdName` pair is the payload.

| Sheet | Maps to | Sheet ID |
|---|---|---|
| archiveType | `archiveType` | `16OxSagfVVp7KO3jrbjh5npWDNVOMCIZr4ToVgHvZgJE` |
| paleoData_variableName | `variableName` | `18KBNY_x6lZ90k_NF_Cw-6RZ6VhMRR97bzXy49qtq6IU` |
| paleoData_units | `units` | `1a_QLvT-im7RZmW-vpJg-RnE4Ecu500pc9fua5u1R1zc` |
| paleoData_proxy | `proxy` | `1-SonhUl_yhZRnmBDDACY9sByl7jt-Ov5b6n21PXPzXQ` |
| paleoData_proxyGeneral | `proxyGeneral` | `1Dy5OTMxatanGQlibQL0I0tenJ_pmf3dL_GMornVq_U8` |
| paleoData_measurementMaterial | `measurementMaterial` | `11ehg3P4G3lX5VtsJDzx1T0YQp2FTi7tZu0rqgHFqGa0` |
| interpretation_seasonality | `interpretation.seasonality` | `1UPJoHh9cSKEIrTXAGonGgNcCzGRGWo4FYalfEtgiXDw` |
| interpretation_variable | `interpretation.variable` | `1qwewgHin2YLVkZS9E66i6E8A7EBrm9VKj3y-vyBYgCs` |
| lipd key standardization | top-level metadata keys | `11WjpY8PtdwoX98n5MK8VhwgqSSB0ubS42spj06nVq9o` |

Also a `Dave-Seasonality work` subfolder and a `LiPD-PaST alignment directory`
shortcut.

**Done (commit pending):**
- [x] Generated a curated `src/lib/synonyms.ts` from the archiveType, units, and
  proxy sheets — per-field `normalize(raw) → lipdName` lookups on a
  case/space-normalized key. Cleaned out `deleteMe`/`needsToBeChanged`/`NA`,
  merge-artifact `((( … )))` synonyms, and unit-conversion errors (e.g.
  kelvin→degC).
- [x] Applied in the import path: `serviceToLipd` (NOAA + PANGAEA) and the
  browser NOAA parsers now normalize `units` and `archiveType`. archiveType
  tries the synonyms first, then falls back to the NOAA data-type `ARCHIVE_MAP`.
- [x] **`proxyGeneral` is autogenerated** — `ColumnEditor` derives it from the
  (normalized) `proxy` via `proxyGeneralFor()` and shows it read-only; not
  user-editable. Kept in the data model.
- [x] Normalization is conservative: only maps on a known synonym, else keeps
  the original string (the validation panel still flags remaining non-vocab
  terms for review).
- [x] Tests: 14 direct spot-checks of the maps (Marine→MarineSediment,
  Cave→Speleothem, "deg C"→degC, "per mil"→permil, "cal years BP"→yr BP,
  Mg/Ca→elemental, …) + headless proxyGeneral-autogen check. Suite now 82 checks.

**Follow-up:**
- [x] **variableName synonyms** — done via a generator: `scripts/generate-synonyms.mjs`
  reads `scripts/synonym-sheets/paleoData_variableName.csv` (committed Sheets
  export), cleans it (drops deleteMe/needsToBeChanged/NA/blank targets,
  merge-artifacts, assemblage taxa, exact-identity rows; blocklist for
  known-bad pairs), and emits `src/lib/synonyms.varnames.generated.ts` (1581
  entries). `normalizeVariableName()` applied in `serviceToLipd` with a
  **collision guard** so it never collapses two columns onto one name. To
  refresh: re-download the sheet as CSV into scripts/synonym-sheets/ and re-run.
- [ ] Extend the generator to also emit `measurementMaterial`,
  `interpretation_seasonality`, `interpretation_variable` (same pipeline; drop
  their CSVs into scripts/synonym-sheets/).
- [ ] Consider an explicit "review normalized terms" step rather than
  apply-on-import, if users want to see what changed.

## D. Field tooltips for metadata terms (port from the old Playground)
Goal: restore the per-field help tooltips the old AngularJS Playground had on
nearly every metadata field.

**Source text already in the repo:** the old tooltip strings live in
`website/public/modules/ng_create.js` → the `tooltipLibrary` object (~line 1479),
keyed by `section` then `key` (e.g. `root.dataSetName` = "Please use the format
'Name.Location.Year'…"; `root.archiveType` = "Which ProxyArchive underlies this
ProxySystem?"; sections include root, noaa, funding, pub, geo, paleoData,
chronData, misc). The old view called `getTooltip(section, key)` per field.

- [ ] Extract `tooltipLibrary` into a versioned data file for the SPA (e.g.
  `src/lib/tooltips.ts`), dropping `"NA"`/placeholder entries.
- [ ] Add a small tooltip/`<abbr>`-style helper (hover + keyboard-focus
  accessible) and attach it to field labels across `MetadataPanel`,
  `ColumnEditor`, and the `NewDatasetWizard`.
- [ ] Cover the fields the React app added that the old one lacked
  (interpretation block, proxyGeneral, the NOAA submission fields) — write new
  tooltip text for those.
- [ ] Keep it lightweight and consistent with the current light theme; no
  Angular-Material `md-tooltip` (that was the Format-page header bug).

---

_Priority suggestion: clear the remaining blocker (re-auth done ✓; still need
PANGAEA credential check). **D** is a quick, self-contained win (the text already
exists). **B** is the next most shippable. **C** delivers the most user value but
is the biggest build. **A** is ongoing QA that also feeds B and C._
