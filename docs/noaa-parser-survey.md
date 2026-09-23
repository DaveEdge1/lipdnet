# NOAA data-file parsing: what works, what doesn't, and what's left

A survey run on 2026-09-23 to find out how often a NOAA study fails to import,
and why. It exists because study 5982 turned out to be perfectly readable and
still imported as metadata-only, which raised the obvious question: how many
more are there?

## How the survey was done

1. **Harvest.** The NCEI search API caps at 25 results with no paging, so
   breadth came from varying the query: every archive type, crossed with six
   time slices and a recently-added flag, plus ten keyword sweeps. 170 queries
   returned **1080 distinct studies** and **3840 distinct data files** (2997 of
   them `.txt`/`.csv`/`.tsv`/`.dat`).
2. **Classify.** A 400-file sample, spread evenly across the 19 archive types,
   was downloaded and run through each parsing strategy in turn.
3. **Ground truth.** The file-level pass assumes "not a NOAA template means
   PyleoTUPS fails", which is *not* true — PyleoTUPS has more than a template
   parser. So every study the file pass predicted was stranded was then fetched
   from the running service and checked for real. 39 of 40 predictions held;
   one (Baffin Island 14C) PyleoTUPS had already handled.

## Where the files land

| Outcome | Files | Who handles it |
|---|---|---|
| NOAA template | 278 | PyleoTUPS' own parser |
| Numeric block | 68 | our fallback, strategy 1 |
| Delimited table | 3 | our fallback, strategy 2 |
| Fixed-width table | 3 | our fallback, strategy 3 |
| Unrecovered | 48 | nothing |

Of the 48 unrecovered, **44 contain no table at all** — they are readmes,
"Additional Site Information" companions to a binary data file, and file
manifests. Skipping those is correct behaviour, not a gap. Only 4 held a
table-shaped block, and 3 of those are now recovered.

## What that means for a user

**39 of 196 studies in the sample (20%) import as metadata-only.** That number
is what matters; per-file failure rates overstate the problem, because a study
is only stranded when *every* one of its files fails.

| Archive type | Stranded studies | Why |
|---|---|---|
| Fire history | 22 | data is in `.fhx`; the `.txt` is prose site info |
| Plant macrofossils | 8 | NAPMD ASCII, a custom format |
| Paleoclimatic modelling | 5 | data is in NetCDF; the `.txt` is a readme |
| Lake levels / limnology | 2 | hierarchical record format, not a table |
| Other | 2 | one-offs |

## The conclusion that matters

**The text fallback is close to its ceiling.** Three strategies now cover every
shape in the sample that is recognisably a table. The remaining 39 stranded
studies are not failing because our heuristics are too weak; they are failing
because the data is in a format no general text parser can read.

The two worthwhile targets are both **format parsers, not heuristics**:

- **FHX (fire-scar), ~56% of stranded studies.** A documented FHAES format: a
  year-by-tree matrix of event codes. Maps cleanly onto a LiPD table (a year
  column plus one column per tree). Biggest single lever by a wide margin.
- **NAPMD ASCII (plant macrofossils), ~21%.** A specified format with a `#`
  metadata block, a numbered taxon legend, and per-sample presence rows.

Neither is a fallback heuristic, and neither should be bolted onto one.

## The three strategies, in order

`_fallback_parse` runs only when PyleoTUPS returns nothing, and tries:

1. **Numeric block** — the dominant run of rows where nearly every field is a
   number. The classic proxy table wrapped in prose. Names come from a
   `Column N:` legend, a header line, or PyleoTUPS' variable metadata.
2. **Delimited table** (`_delimited_table`) — tab-separated, dominant field
   count, mostly-textual first row as the header, at least one numeric column.
   Tabs are required because splitting text columns on whitespace is ambiguous.
   Covers study 5982.
3. **Fixed-width table** (`_fixed_width_table`) — character columns blank in
   every data row become the cut points. This is the only strategy that handles
   cells and headers containing spaces: `Field ID`, `22.4 ± 0.6`,
   `Northeast Alaska Range`. Header words are assigned to the column they
   overlap most, because header labels rarely align exactly with their data.

Guards that keep strategy 3 honest: line lengths must be consistent (prose
varies), no field wider than 60 characters, at least one numeric column, and no
cell may contain a run of two or more spaces — that last one means the split
failed and several columns are jammed into one, which is what rejects the
Oxford lake-level file.

## Reproducing it

The survey scripts are not committed; they were throwaway. The shape was:
harvest URLs from the search API, download a stratified sample, run each
strategy, then confirm predictions against the live service. Rerunning is worth
it after any parser change, since the sample is large enough to catch a
regression that the fixture-based suite would miss.

Regression fixtures for the cases found here live in
`noaa-service/test_tutorial_examples.mjs`: 5982 (delimited), 11179
(fixed-width with a spaced header, and the duplicate-table guard), 11921
(fixed-width with spaces inside cells), 2493 (numeric block).
