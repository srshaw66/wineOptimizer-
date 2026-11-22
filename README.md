# VineyardOS: SSU campus vineyard (presentation example)

A web dashboard that opens directly on one example site:
**SSU WINE SPECTATOR CENTER — Campus Vineyard** (Sonoma State University, Rohnert Park, CA).
It shows the campus teaching plot (**Block 1**) on satellite imagery as **site → block → row → row segment**.
Row segments are the clickable, data-bearing entities. Each has example readings, photos, notes, a history
and alerts. Management tools live in one **Options** workspace: *Vineyard layout* (draw and adjust blocks,
rows and segments, and manage the selected item's records) and *Flag types*.

> **Sample-data notice.** The bed outline and three rows are traced from aerial imagery, not surveyed.
> Segment boundaries start evenly spaced (2 / 3 / 4 segments, north to south) and are set by eye, not from
> vegetation analysis. Readings are synthetic values from a fixed past sample window (Oct 14–15, 2026),
> not live measurements, and no sensors are confirmed at this plot. The UI labels all of this.

Stack: React + TypeScript + React Leaflet (Vite) frontend; FastAPI + local SQLite backend.

## Quick start

Requirements: Node.js 20+, Python 3.10+.

**Easiest (macOS):** double-click `scripts/Run VineyardOS.command`. It sets up dependencies on first
run, starts the backend and app on free ports (8000/5173 if available), opens the browser, and stops
both when you close its window. Logs go to `.run-logs/`.

Or start them manually:

Terminal 1 (backend):

```bash
./scripts/start-backend.sh
```

Terminal 2 (frontend):

```bash
./scripts/start-frontend.sh
```

Open **http://127.0.0.1:5173**. API docs: http://127.0.0.1:8000/docs. Or run both with `make run`.

The first run installs packages. After that the app runs offline, except for basemap tiles (see below).

If port 8000 is busy (for example an old backend still running), run the backend on another port
and point the dev proxy at it:

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

```bash
cd frontend && VINEYARD_API_URL=http://127.0.0.1:8001 npm run dev
```

## Presentation behavior

The main screen is the presentation view: a top bar, a sliding **Vineyard** panel on the left, the map in the
centre and a sliding **Inspector** on the right.

- **Top bar:** product name, site name, and one **Options** button. In Options it becomes **← Back to map**.
  There are no persistent status pills. Example status is shown where it matters: every reading says
  *Example reading*, charts say *Example series*, and the footer states that readings are synthetic. When the
  local API is down, the yellow *Local API not reachable* banner with **Retry connection** still appears.
- Opens straight to the SSU site. There is one site; it can hold several blocks. No vineyard chooser.
- **Map:** satellite imagery only. Each row is a dark-cased line divided into segments by white boundary ticks
  and small gaps. There are no plant markers or device pins. A transparent, wider hit area makes segments easy to click.
  Active alerts show as small flags (type icon + count) over their segment, row or block.
- **Left panel:** expandable tree *SSU Campus Vineyard → Block 1 → Row 1–3 → Segment n* with alert badges (⚑n),
  plus **Map layers** (block outlines, rows & segments, alert flags).
- **Highlighting:** hover a tree item and it lights up on the map (block blue, row amber, segment pink). Hover the map
  and the matching tree item lights up. Segment tooltips list active alerts. Tree, map, Inspector and the Options
  panel share one selection and the same ids (`block:<id>`, `row:<id>`, `seg:<id>`).
- **Inspector:** **Alerts** first, where alerts can be added, edited, resolved and reopened. Then tabs:
  - Segment: *Details* (representative photo with add/replace, readings with unit, time and *Example reading* label,
    position, data source, linked devices marked *not connected*, lineage, segment ID), *Trend* (48-hour chart),
    *History* (photos, observation and correction notes, alert events, recent readings; add a note here too).
  - Block / row / site: *Details* (counts, area or length, geometry provenance, layout version) and *Segments*.
- **Row 3 · Segment 4** has no readings on purpose, to show the empty state.
- **Backend down?** The banner appears, the original seed layout renders read-only from a bundled copy, and alerts,
  photos and Options → Vineyard layout say they need the local API.
- **Imagery offline?** A notice says the satellite tiles could not load; the geometry stays visible over a plain
  neutral background. There is no street-map fallback.

## Options workspace

Open it with **Options** (top right) and return with **← Back to map**. The map is never unmounted, so your
selection and map view are kept.

- **Vineyard layout:** the satellite map stays visible with the hierarchy on the left and a contextual panel on the
  right. Selecting an item in the tree highlights it and flies the map to it. The panel has two tabs:
  - **Layout:** geometry and structure for the selected item (see *Editing the layout*).
  - **Records:** alerts for the selected site, block, row or segment. For segments it also has photos (add or
    replace, edit caption and date, with full dated history), notes (add or edit observations, or *correction notes*
    about a reading), a description, data-source/device labels, and the readings, **read-only** with their provenance.
- **Flag types:** the one place to edit reusable alert types. Edit the examples (Disease, Pest, Irrigation, Damage,
  Other) or add your own with a name, icon, colour and default severity. A used type can be edited but not deleted.
  Edits apply everywhere the type appears.

Records use the same components and API calls in the Inspector and in Options, so there is a single copy of each
record and a single edit path.

## Satellite basemap

- Default: **Esri World Imagery** tiles
  (`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, up to zoom 20 here),
  with the attribution *Powered by Esri | Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community*
  shown on the map.
- Licence: the layer's ArcGIS item states it is licensed under the **Esri Master License Agreement**
  (item 10df2279f9684e4a9f6a7f08febac2a9; terms: <https://goto.arcgisonline.com/maps/World_Imagery>).
  The item page also says the layer is not intended for exporting tiles for offline use; this app only displays
  tiles live and never caches or copies them. Before any use beyond this presentation, confirm SSU's
  usage is covered (for example through an ArcGIS account or a campus Esri licence). Esri's newer
  basemap services may require an access token.
- Why not public-domain imagery: USGS *The National Map* imagery is public domain but at this location only
  serves to zoom 16 (~1 m/pixel), far too coarse for a 16 m bed.
- To switch to licensed campus or other imagery, set `VITE_BASEMAP_URL`, `VITE_BASEMAP_ATTRIBUTION` and
  `VITE_BASEMAP_MAX_NATIVE_ZOOM` in `frontend/.env.local` (see `frontend/.env.example`). These ship to the
  browser, so never put secret tokens there. A token-protected source should be proxied by the backend
  with the token in a backend environment variable.
- Google Maps screenshots supplied by the team were used only for orientation. They are not tiles, overlays
  or shipped files, because their licence has not been confirmed.

## Map assumptions (read before presenting)

- **Verified:** the Wine Spectator Learning Center building location, from OpenStreetMap
  (way 362188591, about 38.34157 N, −122.67369 W). Shown as a labelled reference point.
- **Bed outline: traced from imagery, not surveyed (about ±1–2 m).** The planting bed south of the building
  (about 16 m × 7 m) was identified from the team's screenshot and their east-tip point (38.341339, −122.673446)
  and hand-traced on Esri World Imagery. It follows the uneven edge and excludes the concrete pad.
- **Rows:** three east–west rows from the same tracing. Row 1 is the northernmost (verified by latitude);
  it is shorter because it starts east of the pad.
- **Segments:** Row 1 → 2, Row 2 → 3, Row 3 → 4, evenly spaced as a starting point. Adjust the boundaries
  in Options → Vineyard layout to match the canopy you see; the app does not estimate density.
- Geometry edited or drawn in the app is labelled *edited* / *drawn* (not surveyed) in the Inspector.
- All geometry is GeoJSON/WGS84 (`[lng, lat]`). The seed lives in `data/examples/ssu-wsc-campus.example.json`
  (generated by `scripts/generate_example_site.py`). Saved edits live in SQLite and take precedence.

## Editing the layout (Options → Vineyard layout)

1. Open **Options → Vineyard layout** (needs the local API). Handles appear only here, for the selected item, and all
   changes are a **draft**. The bar on the map shows *Draft · unsaved changes* with **Save** and **Cancel**.
2. **Add a block:** press **+ Add block** under the tree (or select the site → *+ Add block*). Click around the block
   edge on the map, using as many points as you need. Click the first point or press *Finish*, and the filled outline appears.
   Then name it: the name defaults to the next free *Block N* (e.g. **Block 2**) and can be changed. Press **Continue to rows**.
3. **Add rows:** with the block selected, choose *+ Draw row* (click along the row, then *Finish*) or
   *+ Straight row* (click start and end; it connects automatically). Each new row then asks for its **name** and
   **number of segments** (− / +, default 1). Press *Done*.
4. **Segments:** select a row (or one of its segments) to change the count with − / +. Drag the round pink boundary
   handles along the row, or use the keyboard-accessible sliders. *Even spacing* resets them.
5. **Edit existing geometry, including Block 1:** select a block or row and drag its square vertex handles. Click a "+"
   midpoint to insert a point. Double-click or right-click a point (or select it and press Delete) to remove it.
   Blocks and rows can be renamed or removed.
6. **Save** writes a new layout version to SQLite, so it survives restarts, and you keep editing from that version.
   **Cancel** (with a confirmation) restores the last saved layout. Leaving Options or the Layout section with unsaved
   changes asks first. If the layout was saved elsewhere meanwhile, Save is refused instead of overwriting.
7. A segment's description and data-source labels (in *Records*) are part of the layout, so they are kept with **Save**.

**Block 1:** the original *Teaching plot* is now displayed as **Block 1**. Its id (`teaching-plot`), geometry, rows,
2/3/4 segments and all records are unchanged. A database saved by the previous version is upgraded once, on first load,
by writing one new layout version that only changes the display name.

## Records, lineage and alerts

- **Where to edit records:** the Inspector (alerts; *Details → Add/Replace photo*; *History → Add note*) or
  **Options → Vineyard layout → Records** (everything, including editing captions, dates and notes, and the
  segment's description and data sources).
- **Photos:** JPEG/PNG/WebP/GIF, ≤10 MB, with date taken and caption. *Replace photo* uploads a new photo that
  becomes the representative one. Earlier photos stay in the dated history; image files are never overwritten.
  Files are stored in `backend/data/photos/`. No example photos are shipped.
- **Notes:** observations, or **correction notes** that say which reading looks wrong and why. Notes can be edited
  (an *edited* time is recorded).
- **Readings are immutable:** there is no edit path for measured values or their timestamps, in the UI or the API.
  Corrections are separate notes stored beside the reading, with their own provenance.
- **Lineage:** dragging boundaries keeps segment identities. Changing a count creates new segments when you save.
  Each new segment records the previous segments it overlaps (`parent_ids`; a merge keeps all of them). Earlier readings,
  photos, notes and alerts then appear on the new segments labelled **Inherited from Row 2 · Segment 1 (before v2 edit)**,
  with their original timestamps, units and layout version. They are looked up through the lineage and are not
  copied, so they are never shown as new measurements. New records attach only to current segments.
- **Alerts** (site, block, row or segment) sit at the top of the Inspector. *Add alert* takes a type, an optional
  severity (low / medium / high) and a description. Alerts can be edited, resolved (the flag disappears, the alert
  stays under *Resolved* and in *History*) and reopened. They are never deleted from the UI. Alert types:
  editable examples *Disease, Pest, Irrigation, Damage, Other*, plus your own (name, colour, icon, default
  severity) via *Manage alert types*. A type that has been used can be edited but not deleted. Alerts are manual
  records only: there is no automatic diagnosis, image inference or treatment advice.

## Persistence

SQLite at `backend/data/vineyard.sqlite3` (override with `VINEYARD_DB_PATH`), shared with the importer.
Tables: `site_layouts` (every saved version), `segment_lineage`, `alerts`, `alert_types`, `segment_photos`,
`segment_notes`. On first run the layout is seeded from the example file as version 1. To start over, stop the
backend and delete `backend/data/vineyard.sqlite3` and `backend/data/photos/`. That also clears imports.

## API

The full endpoint list (layout, segments, history, records, photos, notes, alerts, alert types) is in
`docs/sensor-integration.md`; interactive docs are at `/docs` on the backend.

## Data import (hidden)

The CSV/XLSX importer is **not shown anywhere in the UI** in this build. Its code is intact: the frontend feature
`frontend/src/features/data-import/` (still type-checked, not bundled) and the backend routes (`POST /api/imports/preview`,
`/confirm`, `GET /api/imports/{id}`, `/api/vineyards/{id}/observations`, `/data-types`) plus `backend/app/ingestion/`. To
bring it back later, render `DataImportPage` from `App.tsx` behind an Options section. Saving the layout keeps the
importer's block list in step (Block 1 = `teaching-plot`), so imports can target any block.

## Structure

- `frontend/src/App.tsx`: shell, Options view and sections, shared selection/hover state, layout draft with Save/Cancel, add-block flow, alert actions.
- `frontend/src/components/SiteMap.tsx`: satellite map; blocks, divided rows, hit targets, alert flags, camera.
- `frontend/src/components/MapEditor.tsx`: edit handles (vertices, midpoints, segment boundaries) and drawing.
- `frontend/src/components/EditPanel.tsx`: layout controls (block naming step, row name + segment counter, sliders, add/remove) and the segment metadata editor.
- `frontend/src/components/OptionsLayoutPanel.tsx`: Options → Vineyard layout panel (Layout / Records tabs).
- `frontend/src/components/SegmentRecords.tsx`: shared photo, note, reading and timeline components plus `useSegmentRecords` (used by Inspector and Options).
- `frontend/src/components/FlagTypes.tsx`: Options → Flag types. `Inspector.tsx`, `AlertsPanel.tsx`, `Sparkline.tsx`.
- `frontend/src/lib/layout.ts`: layout types and plot-scale geometry (slice, project, ticks).
  `lib/hierarchy.ts`: site → block → row → segment tree. `lib/alerts.ts`, `lib/api.ts`, `lib/geo.ts`.
- `frontend/src/features/data-import/`: isolated Data import section (hidden in this build).
- `frontend/legacy/`: the old plant-level prototype, kept for reference only and **not built**.
- `backend/app/store/`: SQLite layout versions + lineage (`layout.py`), alerts/types/photos/notes (`records.py`).
- `backend/app/sensors/`: normalized models, provider boundary, example provider, ThingsBoard placeholder.
- `backend/app/routes/sites.py`: site, layout, segment, record and alert endpoints.
- `docs/sensor-integration.md`: data shapes, lineage rules, full API list, adding a provider, ThingsBoard checklist.

## Tests and build

```bash
cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q tests
```

```bash
cd frontend && npm run build
```

Backend tests use a temporary database. They cover the 2/3/4 seed, north-to-south order, Block 1 naming and the one-time
rename migration, split and merge lineage, inherited records without copies, stale-version conflicts, coordinate
validation, alerts, custom types, photo upload and editing, note and correction editing, read-only readings, segment
descriptions and provider errors. If your existing `backend/.venv` predates this change, install the new test-only
dependency first:

```bash
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

## Future live-data integration

Live sensors are **not connected**. A provider boundary exists (`VINEYARD_SENSOR_PROVIDER`, default
`example`); `thingsboard` deliberately returns an error until it is implemented. Remaining work before real data:
written access to SSU's ThingsBoard (or other) tenant and its documented API; device IDs, telemetry keys, units and
intervals; the device → segment mapping (the segment *Data sources* fields are ready for it); surveyed row and plot
geometry; and freshness windows per metric. See `docs/sensor-integration.md`. Credentials belong in backend environment
variables only.

## Out of scope for this presentation build

Accounts and auth, multiple vineyards in the UI, drone or imagery workflows, imagery-derived
vegetation analysis, AI diagnosis or treatment advice, and any claim of live data.
