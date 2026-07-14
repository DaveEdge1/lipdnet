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

**To do:**
- [ ] Confirm each NOAA param maps onto the NCEI paleo-search API our browser
  call uses (vs. needing to route NOAA search through the service like PANGAEA).
  `cv_materials`/`cv_seasonalities`/`locations` come from controlled
  vocabularies — get their allowed values (from PyleoTUPS or NCEI).
- [ ] NOAA: add the missing filters to `NoaaSearchFilters` + `searchNoaaStudies`
  + the `NoaaImport` "More filters" UI (variable name, elevation range,
  reconstruction toggle; species for tree-ring, materials/seasonality/location
  as vocab dropdowns).
- [ ] PANGAEA: add an advanced-filters panel to `PangaeaImport.tsx` (bounding
  box, investigators, variable name, topic) and extend the service
  `/pangaea-search` endpoint + `pangaeaSearch()` client to pass them through to
  `PangaeaDataset.search_studies`. Add `skip`/paging for the slow keyword path.
- [ ] Keep the two panels visually consistent (reuse the NOAA "More filters"
  layout/CSS).
- [ ] Add headless coverage for the new filters.

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

**To do:**
- [ ] Export the sheets and generate a versioned `src/lib/synonyms.ts` (mirroring
  how `vocabulary.ts` is generated) — a per-field `normalize(raw) → lipdName`
  lookup, keyed on a case/space-normalized synonym.
- [ ] **Clean the data on generation:** skip `deleteMe`, `needsToBeChanged`,
  `NA`, `missing`, and blank targets; unwrap the merge-artifact markers seen in
  some cells (`((( … ))) x /// y`); collapse dup rows. Don't ship those verbatim.
- [ ] Apply the map in the import path (`serviceToLipd` in `lib/noaa.ts`, and the
  browser NOAA/file parser) to normalize `units`, `variableName`, `archiveType`,
  `proxy`. This supersedes today's hand-built `ARCHIVE_MAP`.
- [ ] **`proxyGeneral` is autogenerated, not user-facing** — derive it from the
  (normalized) `proxy` via the `paleoData_proxy` sheet's proxyGeneral column /
  the `paleoData_proxyGeneral` sheet. It has been removed from the editable UI
  (was a select in `ColumnEditor`); keep it in the data model as a derived field.
- [ ] Surface as a review-flagged suggestion in the metadata & column editors
  (e.g. "map to `degC`?") rather than silently rewriting the user's value.
- [ ] Only offer targets that exist in `vocabulary.ts`; log/keep the original as
  a fallback when a synonym has no confident match.
- [ ] Tests: an import that previously produced non-vocab terms (e.g. units
  "deg C", "per mil"; archive "Lake"/"Cave"; var "SST") now maps to `degC`,
  `permil`, `LakeSediment`/`Speleothem`, `temperature`.

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
