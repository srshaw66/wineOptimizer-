# Sensor data: row segments, providers, and connecting a real source

Status: **only the built-in example provider is implemented.** Nothing in this repository connects
to ThingsBoard or any vendor. Every reading in the presentation is synthetic.

## Model

`site → block → row → row segment`. A **row segment** is the data-bearing map entity: readings,
photos, observation notes and alerts attach to a segment id. Physical devices are **not** map
entities; a segment lists its data sources as metadata (`sources: [{provider, device_id, external_id}]`,
editable in Options → Vineyard layout → Records) so a documented live provider can be attached later.

## Where things live

| What | Where |
|---|---|
| Example seed (layout, per-segment metrics, sample series) | `data/examples/ssu-wsc-campus.example.json` |
| Generator for that file | `scripts/generate_example_site.py` |
| Saved layouts (versioned), segment lineage, alerts, alert types, photos, notes | SQLite, `backend/app/store/` (`VINEYARD_DB_PATH`) |
| Photo files | `backend/data/photos/` (next to the database) |
| Normalized sensor models (Pydantic) | `backend/app/sensors/models.py` |
| Provider contract + freshness rules | `backend/app/sensors/providers/base.py` |
| Example provider | `backend/app/sensors/providers/example.py` |
| ThingsBoard placeholder (raises, never fetches) | `backend/app/sensors/providers/thingsboard.py` |
| Provider selection (`VINEYARD_SENSOR_PROVIDER`) | `backend/app/sensors/registry.py` |
| API routes (incl. lineage resolution) | `backend/app/routes/sites.py` |
| Frontend types | `frontend/src/lib/sensors.ts`, `frontend/src/lib/layout.ts` |
| Frontend offline copy (reads the same JSON; seed layout, read-only) | `frontend/src/data/embeddedExample.ts` |

## Normalized shapes

Coordinates are GeoJSON, WGS84, **`[longitude, latitude]`**. Leaflet wants `[lat, lng]`; the frontend
converts only via `frontend/src/lib/geo.ts`. Segments are stored as fractions of their row's length.

```jsonc
// Layout (GET/PUT /api/sites/{site}/layout); every save is a new version
{"site_id": "ssu-wsc-campus", "version": 2, "saved_at": "…Z", "blocks": [{
  "id": "teaching-plot", "name": "Block 1", "accuracy": "traced",   // traced | edited | drawn
  "outline": [[-122.67355, 38.34139], …],
  "rows": [{"id": "teaching-plot:row-01", "name": "Row 1", "accuracy": "traced",
            "line": [[lng, lat], [lng, lat]],
            "segments": [{"id": "teaching-plot:row-01:s1", "name": "Segment 1", "start": 0, "end": 0.5,
                          "parent_ids": [], "sources": [{"provider": "example-local", "device_id": null, "external_id": null}]}]}]}]}

// Segment summary (GET /api/sites/{site}/segments)
{"segment_id": "seg-d81d…", "status": "example",      // example | ok | stale | no_data | error
 "inherited_only": true, "ancestors": ["teaching-plot:row-02:s1", "teaching-plot:row-02:s2"],
 "metrics": [{"metric": "soil_moisture_vwc", "label": "Soil moisture (VWC)", "unit": "%"}],
 "latest": [Reading, …]}

// Reading: segment_id is the segment the value was RECORDED for (its origin)
{"segment_id": "teaching-plot:row-02:s1", "metric": "soil_moisture_vwc", "value": 22.6, "unit": "%",
 "observed_at": "2026-10-16T06:00:00Z", "quality": "example",   // example | ok | stale | missing | suspect
 "source": "example-local", "device_id": null, "is_example": true,
 "inherited": true}                                              // shown on a later segment via lineage
```

Freshness rules (`classify()` in `providers/base.py`): no value or timestamp means `missing`. Example
providers always produce `example`. Live values older than the provider's freshness window are
`stale`. The UI labels every state in words, never with color alone.

## Lineage (split / merge)

- Dragging a boundary keeps segment ids.
- Changing a row's segment count creates new segment ids on Save. The backend links each new
  segment to every previous segment of that row whose span overlaps it (`parent_ids`), and retires the old ones
  (`segment_lineage.retired_version`). A merge therefore keeps the ids of all its sources.
- Records are never copied. Views walk the lineage: a segment's readings, photos, notes and alerts
  include its ancestors' records, each labelled *Inherited from …* with its original segment id,
  timestamp, unit and layout version. New records can only be added to current segments.
- Alerts on a retired segment apply to its current descendants (`applies_to`), so an active issue
  still flags the right part of the row after a split.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/sites/{site}` | Site metadata, reference features (landmark), active provider |
| `GET` / `PUT /api/sites/{site}/layout` | Current layout + lineage registry / save a new version (`base_version` required; 409 if stale, 400 if invalid) |
| `GET /api/sites/{site}/geometry.geojson` | Saved layout as GeoJSON (blocks, rows, segments) |
| `GET /api/sites/{site}/segments` | Per-segment latest readings, own or inherited. **502 with a message** if the provider fails |
| `GET /api/sites/{site}/segments/{id}/history?metric=…` | Series for the segment and each ancestor that has the metric |
| `GET /api/sites/{site}/segments/{id}/records` | Photos and observation notes (own + inherited) |
| `POST /api/sites/{site}/segments/{id}/photos` · `…/notes` | Add a dated photo (JPEG/PNG/WebP/GIF, ≤10 MB) or note (`kind`: observation \| correction, optional `refers_to`) |
| `PATCH /api/photos/{id}` · `PATCH /api/notes/{id}` | Edit a photo's caption/date or a note. There is deliberately **no** endpoint that changes readings |
| `GET` / `POST /api/sites/{site}/alerts`, `PATCH /api/alerts/{id}`, `POST /api/alerts/{id}/resolve` · `/reopen` | Alerts |
| `GET` / `POST /api/alert-types`, `PATCH` / `DELETE /api/alert-types/{id}` | Reusable alert types (delete refused while used) |

## Adding a provider

1. Create `backend/app/sensors/providers/<name>.py` implementing `SensorProvider`
   (`info`, `list_sources`, `latest`, `history`) and returning only the normalized models, keyed by segment id.
2. Resolve devices to segments from the segment `sources` metadata (provider + device id) or a backend
   configuration file. Keep credentials in backend environment variables. Never put them in `VITE_*` variables,
   request parameters, or committed files. Raise `ProviderError` on any failure.
3. Keep the source's units and timestamps; convert timestamps to UTC ISO-8601.
4. Register it in `registry.py` and select it with `VINEYARD_SENSOR_PROVIDER=<name>`.
5. Set `is_example=false` only for real measurements; the inspector then shows *Live reading* / *Stale*
   instead of *Example reading*.

Map and UI components do not change.

## Before connecting ThingsBoard (must be verified, not assumed)

- [ ] Which ThingsBoard instance/tenant holds **SSU** devices, and written permission from its owner to read them.
- [ ] Authentication method supported for server-to-server use (user login → JWT, or API key) and who issues the credentials.
- [ ] The **documented** REST endpoints for that server version. The public dashboard at
      `thingsboard.nrp-nautilus.io` reports ThingsBoard v4.3.1.3, but a dashboard URL is not an API
      contract. Use the instance's own Swagger/OpenAPI docs.
- [ ] Device IDs, telemetry keys, units (e.g. °F vs °C, VWC as % vs fraction), sampling interval, timestamp format (ThingsBoard telemetry uses ms since epoch).
- [ ] Physical install location for each device (surveyed coordinates, row/block), so `location_accuracy` can be `surveyed`.
- [ ] A freshness window per metric (e.g. 2× the reporting interval) to drive `stale`.
- [ ] Rate limits and caching on the backend; the browser should never call ThingsBoard directly.

## What the reference projects showed (public pages only, inspected 2026-11-21)

- **ThingsBoard example dashboard** ("Iron Horse Vineyards – Sensor Map"): a Leaflet map on Esri
  World Imagery with many sensor markers. Clicking one opened a "CO2 Sensors" state with one card per
  device (e.g. `EM500-CO2-915M-1`). Each card showed a time-series chart plus Avg/Latest for CO2 (ppm),
  temperature (°F), humidity (%) and barometric pressure (mb). Five of the eight devices showed no
  values, which is why this app has explicit no-data and stale states. These are **Iron Horse**
  readings and must never be shown as SSU data.
- **IHV/CENIC map** ("IHV-CENIC Precision Agriculture Project"): a dark layer workspace with
  Scout / Imagery / Boundaries / Sensors groups, per-layer opacity, dated NDVI orthomosaics, and a
  capture timeline. The basemap did not render in the inspection browser; the layer list did.

No APIs behind either page were called or inferred.
