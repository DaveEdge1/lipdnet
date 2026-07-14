# Playground — To-do (from Zoom meeting, 2026-07-14)

Captured from memory after the recording failed. Three workstreams plus two
blockers to clear first.

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

- [ ] Work through each tutorial example (NOAA studies + PANGAEA datasets) via
  the "NOAA to LiPD" / "PANGAEA to LiPD" cards; note any that fail to import or
  produce garbage tables. Known example IDs from the tutorials so far: NOAA
  **13156**, PANGAEA **830587**, NOAA data-type IDs 18 (tree ring), 4 (corals),
  1 (boreholes). Pull the rest from the "Doing Science with PyleoTUPS" pages.
- [ ] File the failures against `noaa-service/app.py` (or upstream PyleoTUPS) —
  same pattern as the GRIP-6085 fix.
- [ ] Curate a short list of "known-good example IDs" for QA and a demo/tutorial
  page (candidates already in the test suite: NOAA 16055, 6085, 13156;
  PANGAEA 830587).
- [ ] Consider adding these examples to the headless verify suite as regression
  cases.

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
