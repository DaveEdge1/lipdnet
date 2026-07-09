# NOAA → LiPD import service

A small [FastAPI](https://fastapi.tiangolo.com/) service that wraps
[PyleoTUPS](https://github.com/LinkedEarth/PyleoTUPS) so the lipd.net
playground can import NOAA NCEI Paleoclimatology studies with PyleoTUPS's
robust table parsing (Excel, non-standard and standard templates) instead of
the playground's lighter browser-only parser.

It exposes one endpoint that returns a study as normalized JSON; the playground
assembles the LiPD dataset from it. **This service is optional** — when it is
not reachable, the playground automatically falls back to its built-in browser
parser, so the site works with or without it.

## Endpoints

- `GET /health` → `{"status": "ok", ...}`
- `GET /noaa/{study_id}` → normalized JSON:

  ```json
  {
    "studyId": "16055",
    "dataSetName": "...",
    "archiveType": "PALEOCEANOGRAPHY",
    "investigators": "...",
    "geo": { "latitude": 6.3, "longitude": 125.83, "elevation": -2114, "siteName": "MD98-2181" },
    "pub": [ { "author": "...", "title": "...", "year": 2014, "doi": "..." } ],
    "tables": [
      { "tableName": "...", "fileUrl": "...",
        "columns": [ { "variableName": "depth_cm", "units": "centimeter", "values": [ ... ] } ] }
    ],
    "skippedFiles": [ "....fhx" ],
    "metadataOnly": false
  }
  ```

  `metadataOnly` is `true` when no data file could be parsed (e.g. a study with
  only a proprietary `.fhx`/`.rwl` file — PyleoTUPS reads `.txt`/`.xls` only);
  the playground then imports the metadata with an empty starter table.

## Run locally

```
cd noaa-service
python -m venv .venv && . .venv/Scripts/activate   # or .venv/bin/activate on unix
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Run with Docker

```
docker build -t lipdnet-noaa-service .
docker run -p 8000:8000 lipdnet-noaa-service
```

## Wire it to the site

The Express app proxies `GET /api/noaa/:id` to this service when the
`NOAA_SERVICE_URL` environment variable is set:

```
NOAA_SERVICE_URL=http://localhost:8000   # or the deployed service URL
```

If `NOAA_SERVICE_URL` is unset or the service is down, `/api/noaa/:id` returns
503 and the playground uses its browser parser instead. Nothing else needs to
change.
