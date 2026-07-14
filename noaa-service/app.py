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
import tempfile
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

    tables_df = ds.get_tables()

    def units_for(tid: str) -> dict[str, str]:
        out: dict[str, str] = {}
        try:
            vdf = ds.get_variables(dataTableIDs=tid)
        except Exception:
            return out
        if vdf is None:
            return out
        for _, v in vdf.iterrows():
            name = _clean(v.get("cvShortName")) or _clean(v.get("VariableName"))
            unit = _unit_leaf(v.get("cvUnit"))
            if name and unit and name not in out:
                out[name] = unit
        return out

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
                # e.g. proprietary .fhx / .rwl — PyleoTUPS itself only reads .txt
                if file_url:
                    skipped.append(file_url)
                continue
            if not dfs:
                if file_url:
                    skipped.append(file_url)
                continue
            unit_by_name = units_for(tid)
            for df in dfs:
                columns = []
                for col in df.columns:
                    unit = unit_by_name.get(str(col))
                    # Loose match: df column may carry a suffix vs cvShortName
                    if unit is None:
                        for k, u in unit_by_name.items():
                            if str(col).startswith(k):
                                unit = u
                                break
                    columns.append({
                        "variableName": str(col),
                        "units": unit,
                        "values": [_clean(x) for x in df[col].tolist()],
                    })
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


def build_pangaea_payload(study_id: int) -> dict:
    pg = pt.PangaeaDataset()
    pg.search_studies(study_ids=study_id)
    summary = pg.get_summary()
    if summary is None or len(summary) == 0:
        raise HTTPException(status_code=404, detail=f"PANGAEA dataset {study_id} not found")
    row = summary.iloc[0]

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
def pangaea(study_id: int) -> dict:
    try:
        return build_pangaea_payload(study_id)
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
