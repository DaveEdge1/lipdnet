"""
NOAA -> LiPD import microservice for the lipd.net playground.

Wraps PyleoTUPS (https://github.com/LinkedEarth/PyleoTUPS) to fetch a NOAA
NCEI Paleoclimatology study and return it as normalized JSON. PyleoTUPS does
the hard part — robustly parsing NOAA's many text/Excel table formats into
clean columns — which is far more thorough than the playground's built-in
browser parser. The playground assembles the JSON into a LiPD dataset and
falls back to its browser parser when this service is unavailable.

Run locally:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8000
Then point the Express app at it:
    NOAA_SERVICE_URL=http://localhost:8000
"""
from __future__ import annotations

import math
import os
import re
import statistics
import tempfile
from collections import Counter
from typing import Any

import pandas as pd
import pyleotups as pt
import requests
from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="lipd.net NOAA import service", version="1.0.0")

# CORS so the service can be called directly in dev; in production the Express
# app proxies it same-origin, so this is only a convenience.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _clean(v: Any) -> Any:
    """JSON-safe scalar: NaN/NaT -> None, numpy types -> plain Python."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    try:
        if pd.isna(v):
            return None
    except (ValueError, TypeError):
        pass
    if hasattr(v, "item"):  # numpy scalar
        return v.item()
    return v


def _unit_leaf(cv_unit: Any) -> str | None:
    """"length unit>centimeter" -> "centimeter"."""
    if not cv_unit or (isinstance(cv_unit, float) and math.isnan(cv_unit)):
        return None
    return str(cv_unit).split(">")[-1].strip() or None


def _cv_leaf(cv: Any) -> str | None:
    """Leaf of a controlled-vocabulary hierarchy, e.g.
    "biological material>tissue>wood>latewood" -> "latewood"."""
    v = _clean(cv)
    if v is None:
        return None
    s = str(v).split(">")[-1].strip()
    return s or None


# cvWhat categories that describe an axis/metadata column, not a proxy observation.
_NON_PROXY_WHAT = ("age variable", "depth variable", "sampling metadata",
                   "sample identification", "position variable")


def _proxy_from_what(cv_what: Any) -> str | None:
    """The proxy observation from a cvWhat, or None for age/depth/coordinate/
    sampling columns (which shouldn't carry a proxy type)."""
    s = str(_clean(cv_what) or "").lower()
    if not s or s.startswith(_NON_PROXY_WHAT):
        return None
    return _cv_leaf(cv_what)


def _extract_var(v) -> dict:
    """Per-variable metadata from a get_variables row: the pieces LiPD can use."""
    name = _clean(v.get("cvShortName")) or _clean(v.get("VariableName"))
    what = str(_clean(v.get("cvWhat")) or "").lower()
    unit_raw = str(_clean(v.get("cvUnit")) or "").lower()
    return {
        "name": name,
        "unit": _unit_leaf(v.get("cvUnit")),
        "proxy": _proxy_from_what(v.get("cvWhat")),
        "material": _cv_leaf(v.get("cvMaterial")),
        "method": _clean(v.get("cvMethod")),
        # cvSeasonality is hierarchical ("3-month period>Dec-Feb", "1-month
        # period>Apr"); the leaf ("Dec-Feb", "Apr") is the LiPD seasonality form.
        "seasonality": _cv_leaf(v.get("cvSeasonality")),
        "description": _clean(v.get("cvDetail")) or _clean(v.get("cvAdditionalInfo")),
        "is_age": bool(re.search(r"\bage\b|year|chronolog", str(name or "").lower())
                       or "age variable" in what or "time unit" in unit_raw),
    }


# A table is a chronology/age-model (chronData) rather than a measurement
# (paleoData) table. NCEI/PyleoTUPS don't flag this, so it's a conservative
# heuristic: an explicit chron-ish table name, or a table with NO proxy column
# but age-control-style columns (radiocarbon/14C/calibrated age/tie points).
# Biased toward "paleo" so a real proxy table is never stranded in chronData.
_CHRON_NAME = re.compile(
    r"chron|age[\s_-]?model|age[\s_-]?depth|age[\s_-]?control|radiocarbon|\b14c\b|\bams\b"
    r"|dating|tie[\s_-]?point|age[\s_-]?determination", re.I)
_CHRON_COL = re.compile(
    r"radiocarbon|\b14c\b|calibrat|reservoir|\bdated\b|lab[\s_-]?code|tie[\s_-]?point|cal[\s_-]?age", re.I)


def _classify_table(name: str | None, columns: list[dict]) -> str:
    if name and _CHRON_NAME.search(name):
        return "chron"
    has_proxy = any(c.get("proxy") for c in columns)
    has_age_control = any(_CHRON_COL.search(str(c.get("variableName") or "")) for c in columns)
    if not has_proxy and has_age_control:
        return "chron"
    return "paleo"


def _column_dict(name: str, values: list, meta: dict) -> dict:
    """One normalized-JSON column, carrying the LiPD-relevant per-variable
    metadata (units + proxy/material/method/seasonality/description)."""
    return {
        "variableName": str(name),
        "units": meta.get("unit"),
        "proxy": meta.get("proxy"),
        "material": meta.get("material"),
        "method": meta.get("method"),
        "seasonality": meta.get("seasonality"),
        "description": meta.get("description"),
        "values": values,
    }


def _site_of(t) -> dict:
    """The site a NOAA data table belongs to, from the get_tables row.

    A NOAA study can span many sites (a compilation, a transect, a drilling
    campaign). The payload used to keep only the first one, which is fine for
    the single-site common case but throws away the structure a multi-site
    study actually has. Min/Max are equal for a point site, so the midpoint is
    the site itself; a site declared as a box collapses to its centre.
    """
    return {
        "siteName": _clean(t.get("SiteName")),
        "latitude": _midpoint(t.get("MinLatitude"), t.get("MaxLatitude")),
        "longitude": _midpoint(t.get("MinLongitude"), t.get("MaxLongitude")),
        "elevation": _num(_clean(t.get("MinElevation"))),
    }


def _site_key(site: dict) -> str:
    """Identity for grouping tables by site. Name first (NOAA is consistent
    about it within a study); coordinates disambiguate same-named sites and
    cover the case where the name is missing."""
    name = (site.get("siteName") or "").strip().lower()
    lat, lon = site.get("latitude"), site.get("longitude")
    coord = f"{lat},{lon}" if lat is not None and lon is not None else ""
    return name or coord or "unnamed"


def _publications(pubs: list[dict]) -> list[dict]:
    out = []
    for p in pubs or []:
        out.append({
            "author": _clean(p.get("Author")),
            "title": _clean(p.get("Title")),
            "journal": _clean(p.get("Journal")),
            "year": _clean(p.get("Year")),
            "volume": _clean(p.get("Volume")),
            "pages": _clean(p.get("Pages")),
            "doi": _clean(p.get("DOI")),
        })
    return out


def _funding(items: Any) -> list[dict]:
    """NOAA funding ([{fundingAgency, fundingGrant}]) -> LiPD ([{agency, grant}]),
    matching the shape the playground's funding editor already uses."""
    out = []
    if not isinstance(items, list):
        return out
    for f in items:
        if not isinstance(f, dict):
            continue
        agency = _clean(f.get("fundingAgency"))
        grant = _clean(f.get("fundingGrant"))
        if agency or grant:
            out.append({"agency": agency, "grant": grant})
    return out


_SEARCH_URL = "https://www.ncei.noaa.gov/access/paleo-search/study/search.json"


def _study_doi(study_id: int) -> str | None:
    """The study's landing-page DOI (e.g. https://doi.org/10.25921/...). PyleoTUPS
    doesn't surface it (it's not in the summary, NOAAStudy.metadata, or to_dict),
    so read it from the NCEI search record. Best-effort — a failure here must
    never break the import."""
    try:
        r = requests.get(_SEARCH_URL, params={"NOAAStudyId": study_id}, timeout=20)
        r.raise_for_status()
        studies = (r.json() or {}).get("study") or []
        return _clean(studies[0].get("doi")) if studies else None
    except Exception:
        return None


# --- Generic fallback parser for legacy WDC text files -----------------------
# Many older NOAA/WDC files use a prose preamble + a "Column N: name (unit)"
# legend + a whitespace/tab-delimited numeric block. PyleoTUPS sometimes returns
# nothing for these (no error — just an empty result), which would strand clean,
# importable data as "metadata only". When PyleoTUPS yields no table for a text
# file, we do a conservative recovery: find the dominant contiguous numeric
# block, name the columns from the legend (or a header line), and return it. If
# there's no real numeric block (binary/Excel/tree-ring formats) we return None
# and the file is reported as unparseable, exactly as before.

_FALLBACK_MAX_BYTES = 8_000_000
_MISSING_TOKENS = {"", "na", "n/a", "nan", "null", "nd", "-", "--"}


def _looks_text(url: str | None) -> bool:
    if not url:
        return False
    path = str(url).lower().split("?", 1)[0]
    return path.endswith((".txt", ".dat", ".csv", ".tsv"))


def _decode_text(data: bytes) -> str:
    """Decode a NOAA text file. Legacy files predate UTF-8 and are usually
    Latin-1: decoding those as UTF-8 with errors="replace" turned every degree
    sign into U+FFFD, so coordinates like "20 degrees;14/16w" arrived corrupted.
    Try strict UTF-8 first, then the single-byte encodings; Latin-1 accepts any
    byte, so this always terminates."""
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _fetch_text(url: str) -> str:
    r = requests.get(url, timeout=45)
    r.raise_for_status()
    if len(r.content) > _FALLBACK_MAX_BYTES:
        raise ValueError("file too large for fallback parser")
    return _decode_text(r.content)


def _split_row(line: str) -> list[str]:
    line = line.rstrip("\r\n")
    return [c.strip() for c in line.split("\t")] if "\t" in line else line.split()


def _is_num(tok: str) -> bool:
    t = tok.strip()
    if t.lower() in _MISSING_TOKENS:
        return True  # a missing marker inside an otherwise-numeric row
    try:
        float(t.replace(",", ""))
        return True
    except ValueError:
        return False


def _row_is_numeric(toks: list[str]) -> bool:
    if len(toks) < 2:
        return False
    numeric = sum(1 for t in toks if _is_num(t))
    return numeric >= max(2, len(toks) - 1)  # tolerate one label/flag column


def _is_missing(tok: str) -> bool:
    return str(tok).strip().lower() in _MISSING_TOKENS


def _is_strict_num(tok: str) -> bool:
    """Unlike _is_num, a missing marker is NOT a number here - used to judge
    whether a whole column is numeric, where blanks shouldn't count either way."""
    t = str(tok).strip()
    if _is_missing(t):
        return False
    try:
        float(t.replace(",", ""))
        return True
    except ValueError:
        return False


def _mostly_numeric(vals: list[str]) -> bool:
    present = [v for v in vals if not _is_missing(v)]
    if not present:
        return False
    return sum(1 for v in present if _is_strict_num(v)) >= len(present) * 0.8


def _delimited_table(lines: list[str]) -> tuple[list[str], list[list[str]]] | None:
    """Recover a plain tab-delimited table with a header row.

    The numeric-block strategy above only finds blocks where nearly every field
    is a number, which is the shape of a classic proxy table. Some NOAA files
    are ordinary spreadsheets exported as TSV, where most columns are text - a
    radiocarbon date list, say, with columns for location, material and
    laboratory. Those were reported as unparseable despite being about as
    machine-readable as a file gets. See NOAA study 5982 / sahara.txt.

    Requires tabs (splitting text columns on whitespace is ambiguous), a
    dominant field count, a mostly-textual first row to use as the header, and
    at least one predominantly numeric column so tab-indented prose isn't
    mistaken for data.
    """
    # Trailing separators are inconsistent in real files: some rows end with a
    # tab and some don't, which would otherwise split one table into two runs of
    # differing width. Strip trailing empties so a row's width reflects its
    # content, then pad short rows back out - the only reason a row is short
    # here is a missing value at the end.
    parsed: list[list[str]] = []
    for ln in lines:
        if "\t" not in ln:
            continue
        toks = [c.strip() for c in ln.rstrip("\r\n").split("\t")]
        while toks and _is_missing(toks[-1]):
            toks.pop()
        if len(toks) >= 2:
            parsed.append(toks)
    if len(parsed) < 6:
        return None

    width = Counter(len(t) for t in parsed).most_common(1)[0][0]
    if width < 2:
        return None
    block = [t + [""] * (width - len(t)) for t in parsed if len(t) <= width]
    if len(block) < 6:  # a header plus at least five data rows
        return None

    header, data = block[0], block[1:]
    if sum(1 for t in header if _is_strict_num(t)) > len(header) // 2:
        return None  # too numeric to be a header
    if len(data) < 5:
        return None
    if not any(_mostly_numeric(list(c)) for c in zip(*data)):
        return None  # no numeric column: prose, not a table

    names = [(header[i].strip() or "Var" + str(i + 1)) for i in range(width)]
    return names, [list(r) for r in data]


# ---- fixed-width recovery ---------------------------------------------------
# Many legacy NOAA files are column-aligned rather than delimited. Splitting
# those on whitespace breaks any cell that contains a space -- a site name, a
# "22.4 +/- 0.6" value, a two-word header like "Field ID". Instead, find the
# character columns that are blank in every data row and cut there.

_FW_MIN_ROWS = 10
_FW_MIN_GAP = 2      # a column break is >= 2 consecutive blank character columns
_FW_MAX_FIELD = 60   # a field wider than this smells like prose


def _fw_blocks(lines: list[str]) -> list[tuple[int, int]]:
    """Runs of consecutive non-blank lines, longest first."""
    out: list[tuple[int, int]] = []
    start = None
    for i, ln in enumerate(list(lines) + [""]):
        if ln.strip():
            if start is None:
                start = i
        else:
            if start is not None and i - start >= _FW_MIN_ROWS:
                out.append((start, i))
            start = None
    return sorted(out, key=lambda be: be[0] - be[1])


def _fw_trim(rows: list[str]) -> tuple[list[str], int]:
    """Drop stray short lines at the edges: a "DATA:" label or a footnote sits
    flush against the table and would otherwise wreck the width check."""
    if not rows:
        return rows, 0
    med = statistics.median(len(r.rstrip()) for r in rows)
    lo, hi = 0, len(rows)
    while lo < hi and len(rows[lo].rstrip()) < 0.5 * med:
        lo += 1
    while hi > lo and len(rows[hi - 1].rstrip()) < 0.5 * med:
        hi -= 1
    return rows[lo:hi], lo


def _fw_slices(rows: list[str]) -> list[tuple[int, int]]:
    width = max(len(r) for r in rows)
    padded = [r.ljust(width) for r in rows]
    blank = [all(p[c] == " " for p in padded) for c in range(width)]
    out: list[tuple[int, int]] = []
    start, c = None, 0
    while c < width:
        if blank[c]:
            run = c
            while run < width and blank[run]:
                run += 1
            if run - c >= _FW_MIN_GAP and start is not None:
                out.append((start, c))
                start = None
            c = run
        else:
            if start is None:
                start = c
            c += 1
    if start is not None:
        out.append((start, width))
    return out


def _fw_header_names(head: str, slices: list[tuple[int, int]]) -> list[str]:
    """Assign each header word to the column it overlaps most. Header labels are
    rarely aligned exactly with their data, so slicing the header at the data's
    own column edges chops words in half ("Latitude" becomes "atitude")."""
    names = ["" for _ in slices]
    for m in re.finditer(r"\S+", head):
        best_i, best_ov = None, 0
        for i, (a, b) in enumerate(slices):
            ov = min(m.end(), b) - max(m.start(), a)
            if ov > best_ov:
                best_ov, best_i = ov, i
        if best_i is None:  # sits wholly in a gap: attach to the nearest column
            best_i = min(
                range(len(slices)),
                key=lambda i: min(abs(slices[i][0] - m.end()), abs(m.start() - slices[i][1])),
            )
        names[best_i] = (names[best_i] + " " + m.group()).strip()
    return names


def _fw_looks_like_data(row: str, slices, cols, width: int) -> bool:
    """True when a candidate header carries a number in every column that is
    otherwise numeric -- it is really the first data row."""
    cells = [row.ljust(width)[a:b].strip() for a, b in slices]
    numeric_cols = [i for i, c in enumerate(cols) if _mostly_numeric(list(c))]
    if not numeric_cols:
        return False
    return all(_is_strict_num(cells[i]) for i in numeric_cols)


def _fw_under_split(cells: list[list[str]]) -> bool:
    """A cell holding a run of two or more spaces means we failed to split there:
    several columns are jammed into one, so this is not really a table."""
    bad = sum(1 for row in cells for c in row if re.search(r"\s{2,}", c))
    return bad > max(2, 0.02 * sum(len(r) for r in cells))


def _fixed_width_table(lines: list[str]) -> tuple[list[str], list[list[str]]] | None:
    for s, e in _fw_blocks(lines):
        rows, _ = _fw_trim(lines[s:e])
        if len(rows) < _FW_MIN_ROWS:
            continue
        lens = [len(r.rstrip()) for r in rows]
        if max(lens) - min(lens) > max(20, 0.5 * max(lens)):
            continue  # prose: line lengths vary too much

        # Columns come from the body. Try with the first row held back as a
        # possible header, then fall back to treating every row as data.
        for head_row, body in ((rows[0], rows[1:]), (None, rows)):
            if len(body) < _FW_MIN_ROWS - 1:
                continue
            sl = _fw_slices(body)
            if len(sl) < 2 or any(b - a > _FW_MAX_FIELD for a, b in sl):
                continue
            width = max(len(r) for r in body)
            cells = [[r.ljust(width)[a:b].strip() for a, b in sl] for r in body]
            cols = list(zip(*cells))
            if not any(_mostly_numeric(list(c)) for c in cols):
                continue
            if _fw_under_split(cells):
                continue
            if head_row is not None and _fw_looks_like_data(head_row, sl, cols, width):
                continue  # that was data: retry with it included as a row
            names = None
            if head_row is not None:
                cand = _fw_header_names(head_row, sl)
                if any(cand) and sum(1 for t in cand if _is_strict_num(t)) <= len(cand) // 2:
                    names = [t or f"Var{i+1}" for i, t in enumerate(cand)]
            if names is None:
                names = [f"Var{i+1}" for i in range(len(sl))]
            return names, cells
    return None


def _name_unit(desc: str) -> tuple[str, str | None]:
    desc = desc.strip()
    m = re.match(r"^(.*?)\s*\(([^)]*)\)", desc)
    if m:
        name = m.group(1).strip().rstrip(".") or "Var"
        unit = m.group(2).strip()
        return name, (unit if 0 < len(unit) <= 20 and "=" not in unit else None)
    return (desc.rstrip(".").strip() or "Var"), None


def _column_names(lines: list[str], start_idx: int, ncol: int) -> tuple[list[str], list[str | None], str]:
    """Returns (names, units, source) where source is how the names were derived:
    "legend" (explicit "Column N:" descriptions), "header" (a heuristic header
    line — lower confidence), or "generic" (no names found)."""
    # 1) a "Column N: description (unit)" legend anywhere above the data block
    legend: dict[int, tuple[str, str | None]] = {}
    pat = re.compile(r"^\s*column\s+(\d+)\s*[:.\)]\s*(.+?)\s*$", re.I)
    for ln in lines[:start_idx]:
        m = pat.match(ln)
        if m:
            legend[int(m.group(1))] = _name_unit(m.group(2))
    if len(legend) >= ncol:
        names = [legend.get(i + 1, (f"Var{i+1}", None))[0] for i in range(ncol)]
        units = [legend.get(i + 1, (None, None))[1] for i in range(ncol)]
        return names, units, "legend"
    # 2) a mostly-non-numeric header line within a few lines above the block.
    #    Try comma-delimited too (old WDC files use it), and tolerate an
    #    off-by-one column count (pad/truncate with generic names).
    for j in range(start_idx - 1, max(-1, start_idx - 8), -1):
        raw = lines[j].strip()
        if not raw:
            continue
        toks = [t for t in ([c.strip() for c in raw.split(",")] if "," in raw else _split_row(lines[j])) if t]
        if not (ncol - 1 <= len(toks) <= ncol + 1):
            continue
        if sum(1 for t in toks if _is_num(t)) > len(toks) // 2:
            continue  # too numeric to be a header
        return [(toks[i] if i < len(toks) and toks[i] else f"Var{i+1}") for i in range(ncol)], [None] * ncol, "header"
    # 3) generic
    return [f"Var{i+1}" for i in range(ncol)], [None] * ncol, "generic"


def _col_nums(col: list[str]) -> list[float]:
    out = []
    for v in col:
        try:
            out.append(float(str(v).replace(",", "")))
        except ValueError:
            continue
    return out


def _in_declared_span(col: list[str], year_ranges: list[tuple]) -> bool:
    """True if the column is the study's age/time axis: most of its values fall
    within a declared temporal span (CE and/or BP) AND the column *covers* most
    of that span. Grounding it in the study metadata (rather than integer-ness or
    monotonicity) works for decimal ages, BP scales, and depth-free files; the
    coverage test rejects a proxy whose values merely happen to land inside a
    narrow near-zero BP range (e.g. d18O of −30 inside a 0–700 BP span)."""
    nums = _col_nums(col)
    if len(nums) < 5:
        return False
    cmin, cmax = min(nums), max(nums)
    for lo, hi in year_ranges:
        if lo is None or hi is None:
            continue
        lo2, hi2 = (lo, hi) if lo <= hi else (hi, lo)
        span = hi2 - lo2
        if span <= 0:
            continue
        pad = max(1.0, span * 0.05)
        frac_in = sum(1 for n in nums if lo2 - pad <= n <= hi2 + pad) / len(nums)
        coverage = max(0.0, min(cmax, hi2) - max(cmin, lo2)) / span
        if frac_in >= 0.9 and coverage >= 0.15:
            return True
    return False


def _align_variables(block: list[list[str]], variables: list[dict], year_ranges: list[tuple]) -> list[dict]:
    """Assign PyleoTUPS variable metadata to positional data columns, returning one
    metadata dict per column. The metadata order isn't always the file's column
    order, so pin the age/time column by matching it to the study's declared year
    span, then place the remaining variables in order. If that's ambiguous (no or
    multiple matching columns), keep the metadata order rather than guess."""
    ncol = len(variables)
    cols = [[row[j] for row in block] for j in range(ncol)]
    age_cols = [j for j in range(ncol) if _in_declared_span(cols[j], year_ranges)]
    age_vars = [i for i, v in enumerate(variables) if v.get("is_age")]
    order = list(range(ncol))  # data-column index -> variable index
    if len(age_cols) == 1 and len(age_vars) == 1 and age_cols[0] != age_vars[0]:
        ac, av = age_cols[0], age_vars[0]
        rest_cols = [j for j in range(ncol) if j != ac]
        rest_vars = [i for i in range(ncol) if i != av]
        order[ac] = av
        for col_j, var_i in zip(rest_cols, rest_vars):
            order[col_j] = var_i
    return [variables[order[j]] for j in range(ncol)]


def _fallback_parse(file_url: str, variables: list[dict] | None = None,
                    year_ranges: list[tuple] | None = None) -> tuple[list[dict], bool] | None:
    """Recover a table from a legacy text file PyleoTUPS couldn't parse. Returns
    (columns, review) where `review` is True when the column names came from a
    heuristic (a guessed header line, or generic VarN) and so warrant a human
    check. Confidently-named tables (PyleoTUPS variable metadata, or an explicit
    "Column N:" legend) return review=False."""
    try:
        text = _fetch_text(file_url)
    except Exception:
        return None
    lines = text.splitlines()
    numeric = [(i, toks) for i, toks in ((k, _split_row(ln)) for k, ln in enumerate(lines)) if _row_is_numeric(toks)]

    block: list[list[str]] | None = None
    ncol = 0
    start_idx = 0
    if len(numeric) >= 5:
        ncol = Counter(len(t) for _, t in numeric).most_common(1)[0][0]
        if ncol >= 2:
            cand = [t for _, t in numeric if len(t) == ncol]
            if len(cand) >= 5:
                block = cand
                start_idx = next(i for i, t in numeric if len(t) == ncol)

    if block is not None:
        if variables and len(variables) == ncol:
            col_vars = _align_variables(block, variables, year_ranges or [])
            source = "variables"
        else:
            names, units, source = _column_names(lines, start_idx, ncol)
            col_vars = [{"name": names[i], "unit": units[i]} for i in range(ncol)]
    else:
        # No numeric block. Two more shapes worth trying, cheapest first: a
        # plain delimited table whose columns are mostly text, then a
        # column-aligned (fixed-width) table.
        tabular = _delimited_table(lines) or _fixed_width_table(lines)
        if tabular is None:
            return None
        names, block = tabular
        ncol = len(names)
        col_vars = [{"name": n, "unit": None} for n in names]
        source = "header"
    # de-duplicate column names
    seen: dict[str, int] = {}
    uniq: list[str] = []
    for cv in col_vars:
        n = cv.get("name") or "Var"
        if n in seen:
            seen[n] += 1
            uniq.append(f"{n}_{seen[n]}")
        else:
            seen[n] = 0
            uniq.append(n)
    df = pd.DataFrame(block, columns=uniq)
    cols = []
    for idx, cv in enumerate(col_vars):
        vals_raw = df[uniq[idx]].astype(str).tolist()
        if _mostly_numeric(vals_raw):
            series = pd.to_numeric(
                pd.Series(vals_raw).str.replace(",", "", regex=False), errors="coerce"
            )
            values = [_clean(x) for x in series.tolist()]
        else:
            # A text column (site name, material, laboratory) was coerced to
            # all-NaN and silently emptied. Keep it, mapping blanks to null.
            values = [None if _is_missing(v) else v for v in vals_raw]
        cols.append(_column_dict(uniq[idx], values, cv))
    # Flag for human review when naming was a heuristic or any column is generic.
    review = source in ("header", "generic") or any(re.match(r"^Var\d+$", str(c["variableName"])) for c in cols)
    return cols, review


def build_payload(study_id: int) -> dict:
    ds = pt.NOAADataset()
    found = ds.search_studies(noaa_id=study_id)
    summary = ds.get_summary()
    if summary is None or len(summary) == 0:
        raise HTTPException(status_code=404, detail=f"NOAA study {study_id} not found")
    row = summary.iloc[0]

    # Geo: prefer the actual site point (get_tables carries per-site
    # coordinates), falling back to the CENTER of the study's coverage box.
    # The summary's "Coverage [S, N, W, E]" is the envelope across ALL of a
    # study's sites, so its SW corner (the old cov[S], cov[W]) mislocates any
    # multi-site study — e.g. the AICC2012 ice-core compilation, whose box
    # spans Antarctica to Greenland — to a corner that is nowhere near a real
    # site. Per-site Min/Max are equal for the common single-point study, so
    # this is a no-op there and a correctness fix for boxed/multi-site studies.
    cov = row.get("Coverage [S, N, W, E]") or (None, None, None, None)
    box_lat = _midpoint(cov[0], cov[1]) if len(cov) > 1 else None
    box_lon = _midpoint(cov[2], cov[3]) if len(cov) > 3 else None
    site_lat = site_lon = None

    # The study's declared temporal span (CE and BP) — used by the fallback
    # parser to identify the age/time column by the data it actually contains.
    year_ranges = [
        (_num(row.get("EarliestYearCE")), _num(row.get("MostRecentYearCE"))),
        (_num(row.get("EarliestYearBP")), _num(row.get("MostRecentYearBP"))),
    ]

    tables_df = ds.get_tables()

    def variables_for(tid: str) -> list[dict]:
        """Ordered per-variable metadata for a table (name, unit, proxy, material,
        method, seasonality, description, is-age) — used both to enrich the normal
        columns and to name/enrich columns the fallback parser recovers."""
        try:
            vdf = ds.get_variables(dataTableIDs=tid)
        except Exception:
            return []
        if vdf is None:
            return []
        return [_extract_var(v) for _, v in vdf.iterrows()]

    site_name = None
    elevation = None
    tables: list[dict] = []
    skipped: list[str] = []
    # Every distinct site in the study, in first-seen order, keyed for grouping.
    sites_by_key: dict[str, dict] = {}
    # NOAA sometimes lists several files under ONE DataTableID -- a .txt and the
    # same data as .xls, say. PyleoTUPS keys on the id, so asking about either
    # row returns the same frame, and we used to emit it once per row. Track
    # which ids have already produced tables and skip the repeats. (The fallback
    # path is keyed by URL instead, so distinct files there are still parsed
    # separately -- that is how study 5982 skips its readme and keeps its data.)
    emitted_tids: set[str] = set()

    if tables_df is not None:
        for _, t in tables_df.iterrows():
            tid = str(t["DataTableID"])
            file_url = _clean(t.get("FileURL"))
            # Per-table site, so a multi-site study keeps its structure (#14).
            site = _site_of(t)
            skey = _site_key(site)
            if skey not in sites_by_key:
                sites_by_key[skey] = site
            site_name = site_name or _clean(t.get("SiteName"))
            elevation = elevation if elevation is not None else _clean(t.get("MinElevation"))
            if site_lat is None:
                site_lat = _midpoint(t.get("MinLatitude"), t.get("MaxLatitude"))
            if site_lon is None:
                site_lon = _midpoint(t.get("MinLongitude"), t.get("MaxLongitude"))
            try:
                dfs = ds.get_data(dataTableIDs=tid)
            except Exception:
                dfs = None
            if not dfs:
                # PyleoTUPS produced no table. For a plain-text file this is
                # often a legacy WDC layout its parser can't segment — try our
                # generic recovery before giving up. Proprietary/binary formats
                # (.fhx/.rwl/.xls) fall through to skipped, as before.
                fb = _fallback_parse(file_url, variables_for(tid), year_ranges) if _looks_text(file_url) else None
                if fb:
                    fb_cols, fb_review = fb
                    fb_name = _clean(t.get("DataTableName")) or (file_url.split("/")[-1] if file_url else None)
                    tables.append({
                        "tableName": fb_name,
                        "fileUrl": file_url,
                        "columns": fb_cols,
                        "site": site,
                        "siteKey": skey,
                        "parser": "fallback",
                        # Heuristic naming → ask the user to confirm/edit the columns.
                        "review": fb_review,
                        "kind": _classify_table(fb_name, fb_cols),
                    })
                elif file_url:
                    skipped.append(file_url)
                continue
            var_list = variables_for(tid)
            meta_by_name = {v["name"]: v for v in var_list if v.get("name")}
            for df in dfs:
                ncols = len(df.columns)
                columns = []
                for ci, col in enumerate(df.columns):
                    meta = meta_by_name.get(str(col))
                    # Loose match: df column may carry a suffix vs the cv name
                    if meta is None:
                        for k, m in meta_by_name.items():
                            if str(col).startswith(k) or k.startswith(str(col)):
                                meta = m
                                break
                    # Positional fallback: pyleoTUPS parses the data and the
                    # variable block from the same NOAA template, so column i lines
                    # up with variable i. Guarded on an exact count match.
                    if meta is None and ncols == len(var_list):
                        meta = var_list[ci]
                    columns.append(_column_dict(str(col), [_clean(x) for x in df[col].tolist()], meta or {}))
                if columns:
                    if tid in emitted_tids:
                        continue
                    name = _clean(t.get("DataTableName")) or (file_url.split("/")[-1] if file_url else None)
                    tables.append({
                        "tableName": name,
                        "fileUrl": file_url,
                        "columns": columns,
                        "site": site,
                        "siteKey": skey,
                        "kind": _classify_table(name, columns),
                    })
                    emitted_tids.add(tid)

    return {
        "studyId": str(study_id),
        "dataSetName": _clean(row.get("StudyName")),
        "archiveType": _clean(row.get("DataType")),
        "investigators": _clean(row.get("Investigators")),
        "studyNotes": _clean(row.get("StudyNotes")),
        "funding": _funding(row.get("Funding")),
        "datasetDOI": _study_doi(study_id),
        "originalDataUrl": None,
        "geo": {
            "latitude": site_lat if site_lat is not None else box_lat,
            "longitude": site_lon if site_lon is not None else box_lon,
            "elevation": _num(elevation),
            "siteName": site_name,
        },
        "pub": _publications(row.get("Publications")),
        # Every distinct site, so the client can offer per-site import or a
        # collapsed dataset with a real footprint instead of one site's point.
        "sites": [{"key": k, **v} for k, v in sites_by_key.items()],
        "tables": tables,
        "skippedFiles": skipped,
        "metadataOnly": len(tables) == 0,
    }


def _num(v: Any) -> Any:
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _midpoint(a: Any, b: Any) -> Any:
    """Center of two coordinates; tolerates a missing endpoint. 0.0 is a valid
    coordinate, so this is careful never to treat it as absent."""
    a, b = _num(a), _num(b)
    if a is None:
        return b
    if b is None:
        return a
    return (a + b) / 2


# Convert a column of a PyleoTUPS DataFrame into a normalized-JSON column
def _column(df: pd.DataFrame, col: Any, unit_by_name: dict[str, str]) -> dict:
    unit = unit_by_name.get(str(col))
    if unit is None:
        for k, u in unit_by_name.items():
            if str(col).startswith(k):
                unit = u
                break
    return {
        "variableName": str(col),
        "units": unit,
        "values": [_clean(x) for x in df[col].tolist()],
    }


# Max collection members to fetch+merge in one expand request (keeps latency
# and payload size sane; large compilations are flagged as truncated).
PANGAEA_EXPAND_MAX = 25


def build_pangaea_payload(study_id: int, expand: bool = False) -> dict:
    pg = pt.PangaeaDataset()
    pg.search_studies(study_ids=study_id)
    summary = pg.get_summary()
    if summary is None or len(summary) == 0:
        raise HTTPException(status_code=404, detail=f"PANGAEA dataset {study_id} not found")
    row = summary.iloc[0]

    # A PANGAEA collection has no directly-importable data; PyleoTUPS exposes its
    # child datasets via CollectionMembers. Without expand, return the member
    # list so the user can pick one; with expand, merge members into one dataset.
    members = row.get("CollectionMembers")
    member_ids = [str(m) for m in members] if isinstance(members, (list, tuple)) and len(members) else []
    if member_ids and not expand:
        return {
            "studyId": str(study_id),
            "dataSetName": _clean(row.get("StudyName")),
            "originalDataUrl": f"https://doi.pangaea.de/10.1594/PANGAEA.{study_id}",
            "collection": True,
            "members": [{"id": mid} for mid in member_ids],
        }
    if member_ids and expand:
        return _expand_collection(study_id, row, member_ids)

    # Geo
    lat = lon = elev = site_name = None
    try:
        geo_df = pg.get_geo()
        if geo_df is not None and len(geo_df):
            g = geo_df.iloc[0]
            lat = _clean(g.get("MinLatitude"))
            lon = _clean(g.get("MinLongitude"))
            elev = _num(_clean(g.get("Elevation")))
            site_name = _clean(g.get("SiteName"))
    except Exception:
        pass

    # ShortName -> Unit map
    unit_by_name: dict[str, str] = {}
    try:
        vdf = pg.get_variables(study_id)
        if vdf is not None:
            for _, v in vdf.iterrows():
                name = _clean(v.get("ShortName")) or _clean(v.get("VariableName"))
                unit = _clean(v.get("Unit"))
                if name and unit and name not in unit_by_name:
                    unit_by_name[name] = unit
    except Exception:
        pass

    dfs = pg.get_data(study_id)
    if not isinstance(dfs, list):
        dfs = [dfs] if dfs is not None else []
    tables = []
    for i, df in enumerate(dfs):
        if df is None or not len(df.columns):
            continue
        columns = [_column(df, c, unit_by_name) for c in df.columns]
        if columns:
            tables.append({
                "tableName": _clean(row.get("StudyName")) or f"table{i}",
                "fileUrl": None,
                "columns": columns,
            })

    # Publications may be a full DataFrame; fall back to none
    pubs: list[dict] = []
    try:
        pr = pg.get_publications()
        pdf = pr[1] if isinstance(pr, tuple) else pr
        if pdf is not None and hasattr(pdf, "iterrows"):
            pubs = _publications([r.to_dict() for _, r in pdf.iterrows()])
    except Exception:
        pass

    return {
        "studyId": str(study_id),
        "dataSetName": _clean(row.get("StudyName")),
        "archiveType": None,  # PANGAEA has no NOAA-style dataType; user sets it
        "investigators": _clean(row.get("Investigators")),
        "originalDataUrl": f"https://doi.pangaea.de/10.1594/PANGAEA.{study_id}",
        "geo": {"latitude": lat, "longitude": lon, "elevation": elev, "siteName": site_name},
        "pub": pubs,
        "tables": tables,
        "skippedFiles": [],
        "metadataOnly": len(tables) == 0,
    }


def _expand_collection(study_id: int, row, member_ids: list[str]) -> dict:
    """Merge a PANGAEA collection's member datasets into one payload: each
    member becomes one or more measurement tables. Metadata (name, site,
    publications) is taken from the parent, falling back to the first member."""
    use_ids = member_ids[:PANGAEA_EXPAND_MAX]
    truncated = len(member_ids) - len(use_ids)

    tables: list[dict] = []
    notes: list[str] = []
    geo = {"latitude": None, "longitude": None, "elevation": None, "siteName": None}
    pubs: list[dict] = []
    for mid in use_ids:
        try:
            mp = build_pangaea_payload(int(mid), expand=False)
        except Exception as e:  # noqa: BLE001 — one bad member shouldn't fail the whole import
            notes.append(f"PANGAEA {mid}: {e}")
            continue
        mname = mp.get("dataSetName") or f"PANGAEA {mid}"
        m_tables = mp.get("tables", [])
        for j, t in enumerate(m_tables):
            # Label each merged table with its source member so they stay distinct.
            # A member usually has one table already named after the study; only
            # add an index when a member contributes several.
            t = dict(t)
            base = t.get("tableName") or mname
            t["tableName"] = base if len(m_tables) == 1 else f"{base} ({j + 1})"
            tables.append(t)
        # First member with coordinates seeds the dataset geo / publications
        mg = mp.get("geo") or {}
        if geo["latitude"] is None and mg.get("latitude") is not None:
            geo = mg
        if not pubs and mp.get("pub"):
            pubs = mp["pub"]

    if truncated:
        notes.append(f"+{truncated} more collection members not imported (limit {PANGAEA_EXPAND_MAX}).")

    return {
        "studyId": str(study_id),
        "dataSetName": _clean(row.get("StudyName")),
        "archiveType": None,
        "investigators": _clean(row.get("Investigators")),
        "originalDataUrl": f"https://doi.pangaea.de/10.1594/PANGAEA.{study_id}",
        "geo": geo,
        "pub": pubs,
        "tables": tables,
        "skippedFiles": notes,
        "metadataOnly": len(tables) == 0,
    }


# Run PyleoTUPS on raw NOAA file text. PyleoTUPS reads by URL/path: its
# detection step and StandardParser use requests.get, while NonStandardParser
# reads local paths via open(). So write the text to a temp file AND shim
# requests.get to return it — covering both parser types.
def parse_text(text: str) -> list[pd.DataFrame]:
    class _Resp:
        def __init__(self, t: str):
            self.text = t
            self.content = t.encode("utf-8")
            self.status_code = 200
            self.encoding = "utf-8"

        def raise_for_status(self) -> None:
            pass

    fd, path = tempfile.mkstemp(suffix=".txt")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    orig_get = requests.get
    requests.get = lambda url, *a, **k: _Resp(text)  # type: ignore[assignment]
    try:
        ds = pt.NOAADataset()
        return ds.get_data(file_urls=[path]) or []
    finally:
        requests.get = orig_get
        try:
            os.unlink(path)
        except OSError:
            pass


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "noaa-lipd"}


@app.post("/parse")
def parse(text: str = Body(..., media_type="text/plain")) -> dict:
    """Parse an uploaded NOAA file's text into normalized tables via PyleoTUPS."""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        dfs = parse_text(text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not parse file: {e}") from e
    tables = []
    for i, df in enumerate(dfs):
        columns = [_column(df, c, {}) for c in df.columns]
        if columns:
            tables.append({
                "tableName": _clean(df.attrs.get("StudyName")) or f"table{i}",
                "fileUrl": None,
                "columns": columns,
            })
    if not tables:
        raise HTTPException(status_code=422, detail="No data table found in this file")
    return {
        "studyId": "",
        "dataSetName": _clean(dfs[0].attrs.get("StudyName")) if dfs else None,
        "archiveType": None,
        "investigators": None,
        "originalDataUrl": None,
        "geo": {"latitude": None, "longitude": None, "elevation": None, "siteName": None},
        "pub": [],
        "tables": tables,
        "skippedFiles": [],
        "metadataOnly": False,
    }


@app.get("/noaa/{study_id}")
def noaa(study_id: int) -> dict:
    try:
        return build_payload(study_id)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — surface any PyleoTUPS failure as 502
        raise HTTPException(status_code=502, detail=f"PyleoTUPS error: {e}") from e


@app.get("/pangaea/{study_id}")
def pangaea(study_id: int, expand: bool = False) -> dict:
    try:
        return build_pangaea_payload(study_id, expand=expand)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"PyleoTUPS error: {e}") from e


@app.get("/pangaea-search")
def pangaea_search(
    q: str = "",
    limit: int = 20,
    investigators: str | None = None,
    variable_name: str | None = None,
    topic: str | None = None,
    min_lat: float | None = None,
    max_lat: float | None = None,
    min_lon: float | None = None,
    max_lon: float | None = None,
    skip: int = 0,
) -> dict:
    """PANGAEA search → list of {id, name} for the user to pick from. Mirrors the
    PyleoTUPS search_studies() filters (free text, investigators, variable/
    parameter, topic, geographic bounds)."""
    # Build kwargs, omitting empty ones so PyleoTUPS applies its own defaults.
    kwargs: dict = {"limit": min(limit, 50), "skip": skip}
    if q.strip():
        kwargs["search_text"] = q.strip()
    if investigators:
        kwargs["investigators"] = investigators
    if variable_name:
        kwargs["variable_name"] = variable_name
    if topic:
        kwargs["topic"] = topic
    if None not in (min_lat, max_lat, min_lon, max_lon):
        kwargs.update(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)
    # Need at least one non-geographic term or a full bounding box
    has_bbox = "min_lat" in kwargs
    if not any(k in kwargs for k in ("search_text", "investigators", "variable_name", "topic")) and not has_bbox:
        return {"results": []}
    try:
        pg = pt.PangaeaDataset()
        pg.search_studies(**kwargs)
        summary = pg.get_summary()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"PyleoTUPS error: {e}") from e
    results = []
    if summary is not None:
        for _, r in summary.iterrows():
            sid = _clean(r.get("StudyID"))
            if sid is None:
                continue
            # Skip collections (no directly-importable data)
            if _clean(r.get("CollectionMembers")):
                continue
            results.append({"id": str(sid), "name": _clean(r.get("StudyName")) or f"PANGAEA {sid}"})
    return {"results": results}
