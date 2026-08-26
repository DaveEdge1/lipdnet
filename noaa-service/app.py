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
        "seasonality": _clean(v.get("cvSeasonality")),
        "description": _clean(v.get("cvDetail")) or _clean(v.get("cvAdditionalInfo")),
        "is_age": bool(re.search(r"\bage\b|year|chronolog", str(name or "").lower())
                       or "age variable" in what or "time unit" in unit_raw),
    }


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


def _fetch_text(url: str) -> str:
    r = requests.get(url, timeout=45)
    r.raise_for_status()
    if len(r.content) > _FALLBACK_MAX_BYTES:
        raise ValueError("file too large for fallback parser")
    return r.content.decode("utf-8", errors="replace")


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
    if len(numeric) < 5:
        return None
    ncol = Counter(len(t) for _, t in numeric).most_common(1)[0][0]
    if ncol < 2:
        return None
    block = [t for _, t in numeric if len(t) == ncol]
    if len(block) < 5:
        return None
    start_idx = next(i for i, t in numeric if len(t) == ncol)
    if variables and len(variables) == ncol:
        col_vars = _align_variables(block, variables, year_ranges or [])
        source = "variables"
    else:
        names, units, source = _column_names(lines, start_idx, ncol)
        col_vars = [{"name": names[i], "unit": units[i]} for i in range(ncol)]
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
        series = pd.to_numeric(df[uniq[idx]].astype(str).str.replace(",", "", regex=False), errors="coerce")
        cols.append(_column_dict(uniq[idx], [_clean(x) for x in series.tolist()], cv))
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

    # Geo from the coverage box (point studies have min == max)
    cov = row.get("Coverage [S, N, W, E]") or (None, None, None, None)
    lat = _clean(cov[0]) if len(cov) > 0 else None
    lon = _clean(cov[2]) if len(cov) > 2 else None

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

    if tables_df is not None:
        for _, t in tables_df.iterrows():
            tid = str(t["DataTableID"])
            file_url = _clean(t.get("FileURL"))
            site_name = site_name or _clean(t.get("SiteName"))
            elevation = elevation if elevation is not None else _clean(t.get("MinElevation"))
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
                    tables.append({
                        "tableName": _clean(t.get("DataTableName")) or (file_url.split("/")[-1] if file_url else None),
                        "fileUrl": file_url,
                        "columns": fb_cols,
                        "parser": "fallback",
                        # Heuristic naming → ask the user to confirm/edit the columns.
                        "review": fb_review,
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
                    tables.append({
                        "tableName": _clean(t.get("DataTableName")) or (file_url.split("/")[-1] if file_url else None),
                        "fileUrl": file_url,
                        "columns": columns,
                    })

    return {
        "studyId": str(study_id),
        "dataSetName": _clean(row.get("StudyName")),
        "archiveType": _clean(row.get("DataType")),
        "investigators": _clean(row.get("Investigators")),
        "originalDataUrl": None,
        "geo": {
            "latitude": lat,
            "longitude": lon,
            "elevation": _num(elevation),
            "siteName": site_name,
        },
        "pub": _publications(row.get("Publications")),
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
