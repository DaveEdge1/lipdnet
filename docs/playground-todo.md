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
- [x] **Cross-field boolean logic (issue #17).** The per-field any/all toggle only
  ever combined values *within* one field; there was no way to say "variable X
  AND material Y **OR** location Z". NCEI ANDs its params and offers no
  cross-field OR, so the expression is compiled client-side: a **Combine
  filters** bar appears once two categorical filters are filled, showing one
  chip per filled field with an AND/OR select between them plus a plain-English
  summary of what will be matched. `buildBooleanTerms` / `toAndSegments`
  (lib/noaa.ts) compile the chain to disjunctive normal form — OR binds loosest,
  so "A AND B OR C" is "(A AND B) OR C" — and each AND-segment becomes one NCEI
  request whose results are unioned by study id, first-branch-first. A single
  segment is still exactly one request, so nothing regresses. Joins are keyed to
  the field, not the position, so adding a filter doesn't reshuffle the operators
  already chosen. A bare study id/URL short-circuits to a single lookup rather
  than fanning out. Non-categorical filters (free text, archive type, lat/lon
  box, year range, recent/reconstruction) are global and apply to every branch.
  One failing branch doesn't lose the others. Because NCEI caps each request at
  25 with no paging, a multi-branch result carries a notice saying how many
  searches ran and that a broad branch may be truncated. Verified: 9/9 on
  segmentation + summary phrasing; live NCEI confirms cross-param AND (a branch
  of 14 ∧ a saturated branch → 9, all inside the 14); 18/18 headless on the UI;
  end-to-end through the built app, Investigator Petit AND Location Africa → 1,
  same two filters with OR → 39 plus the multi-branch notice.
- [x] **Every filter joins the combiner, and the summary tells the truth.** The
  first cut of the cross-field logic only admitted the seven vocabulary fields;
  everything else was hard-ANDed and, worse, left out of the summary sentence
  entirely, so a latitude bound silently narrowed the query with nothing on
  screen to say so (reported from the beta, 2026-09-22). Now every filled-in
  filter becomes a term — free text, archive type, the lat/lon/elevation bounds,
  the year range with its basis and match mode, and the two flags — each with a
  readable detail string ("at least 20°", "1800 to 2000 CE, spanning the whole
  range"). Because a linear chain cannot express "(A OR B) AND C", terms carry a
  **scope**: the Combine bar has an **Every result** zone whose terms are merged
  into every branch, and a **Match** zone holding the AND/OR chain, with an arrow
  on each chip to move it between them. Defaults reproduce the previous
  behaviour exactly — vocabulary fields in the chain, everything else
  constraining all branches — so no existing query changes meaning. The summary
  zones were labelled **Always** and **Combine** here, each gloss inline rather
  than buried in a tooltip, since the distinction is what people trip on; both
  were renamed shortly afterwards (next entry). The full-sentence
  summary under the bar was dropped at the user's request once the chips and
  glosses carried the same information. Verified 20/20 on the term model
  (coverage, detail strings, segmentation, per-branch params, free text as its
  own branch, exact-lookup bypass) and 9/9 through the built UI on the reported
  case, including that moving latitude between zones flips it between one branch
  and all of them.
- [x] **Name the zones for what they do, and draw one box per OR group.** The
  names were the problem: asked whether Always/Combine were just AND/OR, the
  honest answer is no — Always is AND, but Combine holds *both* operators, so
  the zones are really "outside the parentheses" and "inside them". Renamed to
  **Required** ("every result matches these") and **Subfilter groups** ("a
  result matches any one group"), which say the thing directly. The chain is no
  longer drawn as one flat row: it is split at every OR and each alternative
  gets its own white box, with the OR on a rule between boxes, so "match any one
  of these" is visible in the layout rather than inferable from a dropdown.
  Every join stays reachable and reversible — the separator select belongs to
  the following group's leading term, so setting it to AND folds that group back
  into the one above, and switching an in-group join to OR splits the box.
  `toAndSegments` already produced exactly these segments for the search, so the
  UI and the query cannot disagree. Tooltip cut from 47 words to 34. Verified
  14/14 through the built UI: the names, one box per group, the white
  background, split and merge in both directions, and the regression that
  Required terms still reach every branch (both branches carried `minLat=20`).
- [x] **Show the AND between the zones, and cap the union at 25 in total.** Two
  follow-ups. The join between Required and the groups was implied but never
  drawn, so the expression read as two unrelated lists: there is now a black
  **AND** on a rule between them, plain text rather than a select because it is
  the one join that cannot be anything else (the OR between groups is a
  dropdown and keeps that control's colour). Second, each branch was capped at
  25 independently, so a two-group OR could return 50 rows and a four-group one
  100 — the cap belongs on what comes back, not on each request. The union now
  takes from the branches **in turn** and stops at 25. Round-robin rather than
  draining each branch in order is what makes the shared cap fair: a broad
  alternative would otherwise spend the whole budget and the alternative you
  added it for would never appear at all. NCEI's own ranking still holds within
  a branch. Verified 10/10 through the built UI, including the case that proves
  it: two alternatives returning 25 rows each, 50 available, 25 shown.
- [x] **Budget the load an OR puts on NCEI.** Capping the union at 25 fixed what
  was *shown* but not what was *sent*: every group was still a request for 25
  rows, all fired at once, so a four-group OR meant four simultaneous requests
  for 100 rows to display 25. Two budgets now, both about being a good citizen
  of someone else's API. **Requests:** at most `NOAA_MAX_BRANCHES` (6) per
  search, at most 3 in flight; groups beyond the sixth are not searched and the
  notice says so plainly, since silently dropping an alternative would return a
  wrong answer with a confident face. **Rows:** each branch asks only for its
  share of the 25 — `ceil(25 / branches)` — so bytes pulled stay flat at ~25–30
  however many groups are added, instead of growing by 25 a group. A single
  group is untouched: one request for 25, exactly as before. The trade is that
  heavily overlapping groups can return slightly fewer than 25 after dedupe;
  that is the honest cost of not over-fetching, and a second round of requests
  to top up would defeat the point. Verified 18/18 against the library with a
  stubbed fetch (exact request counts, per-request limits, peak concurrency)
  plus the live UI suites: nine OR groups used to mean 9 requests for 225 rows,
  now 6 requests for 30.
- [x] **Say when overlap, not scarcity, shortened the page.** Asking each branch
  for only its share of the cap has a visible consequence: a study matching two
  groups is fetched twice and listed once, so the page can stop short of 25
  with no explanation on screen — indistinguishable from "NOAA only has this
  many". The union now reports `duplicatesDropped` and `moreAvailable`, and the
  notice fires only when all four conditions hold (more than one group, page
  under the cap, duplicates actually dropped, and some branch came back full):
  *"Showing 13 of 25: 13 studies match more than one group and are listed once.
  NOAA has more — narrow a group, or join two with AND, to fill the page."*
  Overlap is counted **before** the cap is applied, or a page that filled up
  would report duplicates it never reached. `moreAvailable` is what keeps the
  message honest: without it, a genuinely small result would be blamed on
  deduplication. Verified 12/12 on three stubbed shapes — total overlap (warns),
  no overlap (fills, silent), and small-but-complete (short, silent, because
  that is the true answer).
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

- [x] **Multi-site studies keep their structure (issue #14).** The service kept
  only the first site, so a 7-site study imported as one flat dataset pinned to
  one core. `build_payload` now reports the site behind every table plus a
  study-level `sites` list, and the client offers the two shapes that actually
  make sense:
  - **One dataset per site** - N LiPD datasets, each a clean single-site file
    with its own Point geo and a name suffixed by the site. All are written to
    the browser library so none is lost; the first opens for editing.
  - **Collapse into one dataset** - one dataset, one PaleoData object per site,
    located by the convex hull of the site points (a Polygon `geo`), with
    constant `latitude`/`longitude`/`elevation` columns appended to every table
    so a row still traces back to its site.

  A study with one site is untouched on both paths - same Point geo, same
  filenames, no extra columns - so nothing regresses for the common case. A
  `SiteChoiceDialog` lists every site with coordinates and table count and asks
  before importing; the answer is applied to the payload already fetched, since
  the service call is far too slow to repeat. Because a Polygon footprint would
  otherwise be misread as a coordinate pair, `geoPosition`/`geoBounds`
  (lib/lipd.ts) now back the site map, validation and the NOAA exporter: a
  footprint validates and maps on its centroid, and exports its true
  Northernmost/Southernmost/Easternmost/Westernmost envelope instead of one
  point repeated four times. The metadata panel says when a location is an area
  and warns that editing a coordinate flattens it. Verified: 23/23 on the build
  logic against live study 10420 (7 sites, 13 tables) and 2429 (single site),
  plus an end-to-end run of both answers through the built UI.

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
