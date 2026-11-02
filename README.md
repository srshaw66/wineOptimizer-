# VineyardOS — portable local prototype

A local-first React + TypeScript + React Leaflet vineyard explorer with a modular Python FastAPI service. **No accounts, Supabase credentials, or external map tiles are needed.** The demo map uses an SVG background in Leaflet's `CRS.Simple`, with **synthetic coordinates, not GPS coordinates**.

## Requirements
- Node.js 20+ and npm
- Python 3.10+
- macOS, Linux, or Windows with a Unix-compatible shell (on Windows, use Git Bash/WSL, or follow manual commands below).

## Quick start (two terminals)
In terminal 1, from this project folder:

```bash
./scripts/start-backend.sh
```

In terminal 2:

```bash
./scripts/start-frontend.sh
```

Open **http://127.0.0.1:5173**. Local backend docs are at http://127.0.0.1:8000/docs. Initial startup installs packages from the internet once. The app can subsequently run without internet access.

### Manual startup commands

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

For PowerShell on Windows, the virtual environment activation command is `.venv\\Scripts\\Activate.ps1`, then run the `uvicorn` command. Frontend commands are unchanged.

## Features
- Persistent top navigation (Map, Overview, Data, Analytics) and profile placeholder.
- Left expandable **vineyard → block → row → plant** hierarchy; block/row/plant selection colors and matching map highlights.
- Hover names on map and hover previews in hierarchy; click map feature to select and automatically **open the right inspector**.
- Right inspector with Details / Data / History, including an **illustrative** plant photo placeholder.
- Drag/pan, mouse wheel zoom, and smoothly fly to tree-selected features at increasing zoom levels.
- Slide-out left/right panels, matching corner controls and Map Only / Restore Panels button.
- Local HTTP API with stable endpoints and demo records. If the backend is not running, the frontend falls back to embedded mock data.

## Structure
- `frontend/`: React, TypeScript, React Leaflet, CSS; no online tile dependency.
- `backend/app/services/sample_store.py`: replaceable local repository.
- `backend/app/adapters/`: input adapter interface and CSV sample.
- `backend/app/mapping/`: modules for GeoPandas, Folium, Mapclassify, Matplotlib.
- `supabase/migrations/`: placeholder for hosted database, access policies and future authentication.

## Optional geographic Python libraries

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-geo.txt
```

These heavier dependencies are **not required to launch the local prototype**. The modules are staged for later geographic processing, report maps, classification, and charts. Use `/api/geo/status` to see which optional packages are installed.

## API endpoints
- `GET /api/health`
- `GET /api/features`
- `GET /api/observations/plant:A:1:3`
- `GET /api/blocks.geojson`
- `GET /api/geo/status`

## When deploying with accounts later
1. Implement a Supabase repository in place of the mock source and switch the frontend service adapter.
2. Add Supabase Auth, vineyard ownership/membership, PostGIS geometries, and row-level security.
3. Move uploaded drone photographs to private Supabase Storage and use authorized access URLs.
4. Convert mock abstract coordinates to proper geographic CRS/GeoJSON and use licensed satellite maps/tiles.
5. Move data imports and heavy analysis into properly authenticated backend operations.

## Important limitations
This is a working **scaffold**, not a viticultural analysis product. All data, photographs and geography are synthetic. No persistent edits, CSV upload UI, AI image diagnoses, drone control, or real vineyard satellite maps are implemented yet. Folium/Matplotlib produce independent outputs rather than being directly embedded in the React UI. The local project is configured for development use, not public network deployment.
