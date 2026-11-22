#!/usr/bin/env python3
"""Generate the SSU campus *example* site file used by the backend and the frontend fallback.

Output: data/examples/ssu-wsc-campus.example.json

Provenance:
  * Wine Spectator Learning Center building centroid: OpenStreetMap way 362188591
    (ODbL, (c) OpenStreetMap contributors).
  * Bed outline and three row lines: traced by hand (2026-11-21) from georeferenced
    Esri World Imagery (zoom 20, ~0.12 m/pixel), matched to the project team's
    screenshot of the bed and their east-tip point (38.341339, -122.673446).
    Not surveyed; expect roughly +/-1-2 m. The concrete pad at the bed's NW corner
    is excluded. Row count (3) is from the project team's screenshot.
  * Rows are split into 2 / 3 / 4 evenly spaced segments (north to south) as a starting
    point; boundaries are not inferred from imagery. No sensors are confirmed at this plot.
  * Sensor readings are deterministic synthetic values in a fixed past window.
    They are not live and not measured.

Edit BED_OUTLINE / ROW_LINES / SEGMENT_COUNTS below. In-app edits are stored in SQLite and
override this seed (see README). To regenerate the seed, re-run, and commit the JSON:
    python3 scripts/generate_example_site.py
"""
from __future__ import annotations

import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "examples" / "ssu-wsc-campus.example.json"

SITE_ID = "ssu-wsc-campus"
BLOCK_ID = "teaching-plot"

# Verified landmark (OpenStreetMap way 362188591, approximate building centroid). GeoJSON order: [lng, lat].
LANDMARK_LNG_LAT = (-122.67369, 38.34157)

# Planting bed outline, GeoJSON [lng, lat], clockwise from the NE corner of the concrete pad.
# Follows the bed's uneven edge and rounded east end; the concrete pad (NW notch) is outside it.
BED_OUTLINE = [
    (-122.6735558, 38.3413890), (-122.6735061, 38.3413901), (-122.6734726, 38.3413890),
    (-122.6734552, 38.3413848), (-122.6734444, 38.3413774), (-122.6734391, 38.3413669),
    (-122.6734377, 38.3413543), (-122.6734418, 38.3413438), (-122.6734498, 38.3413364),
    (-122.6734659, 38.3413312), (-122.6735061, 38.3413259), (-122.6735598, 38.3413228),
    (-122.6735933, 38.3413228), (-122.6736081, 38.3413270), (-122.6736148, 38.3413354),
    (-122.6736161, 38.3413490), (-122.6736148, 38.3413617), (-122.6735558, 38.3413627),
]

# Three east-west vine rows, north to south: [west end, east end]. Row 1 is short (it starts east of the pad).
ROW_LINES = [
    [(-122.6735397, 38.3413732), (-122.6734686, 38.3413732)],
    [(-122.6736000, 38.3413575), (-122.6734538, 38.3413575)],
    [(-122.6735947, 38.3413438), (-122.6734592, 38.3413438)],
]

# Initial segment counts per row, north to south (project team's request: 2 / 3 / 4).
# Boundaries start evenly spaced; adjust them in the app (Options → Vineyard layout) to match the canopy.
SEGMENT_COUNTS = [2, 3, 4]

# Segment that deliberately has no readings, to demonstrate the empty / offline state.
NO_DATA_SEGMENT = f"{BLOCK_ID}:row-03:s4"

METRIC_LABELS = {
    "soil_moisture_vwc": ("Soil moisture (VWC)", "%"),
    "soil_temperature": ("Soil temperature", "°F"),
    "leaf_wetness": ("Leaf wetness", "%"),
}


def row_id(i: int) -> str:
    return f"{BLOCK_ID}:row-{i:02d}"


def segment_id(row: int, n: int) -> str:
    return f"{row_id(row)}:s{n}"


def build_layout() -> dict:
    """Seed layout (version 1). The backend stores later edits as new versions in SQLite."""
    rows = []
    for i, (line, count) in enumerate(zip(ROW_LINES, SEGMENT_COUNTS), start=1):
        segments = [
            {
                "id": segment_id(i, n),
                "name": f"Segment {n}",
                "start": round((n - 1) / count, 6),
                "end": round(n / count, 6),
                "parent_ids": [],
                # Where readings for this segment would come from. Example data only; no physical device.
                "sources": [{"provider": "example-local", "device_id": None, "external_id": None}],
            }
            for n in range(1, count + 1)
        ]
        rows.append({"id": row_id(i), "name": f"Row {i}", "line": [list(p) for p in line], "accuracy": "traced", "segments": segments})
    return {
        "blocks": [
            {
                "id": BLOCK_ID,
                # Displayed as "Block 1"; the id stays "teaching-plot" so saved records keep their links.
                "name": "Block 1",
                "outline": [list(p) for p in BED_OUTLINE],
                "accuracy": "traced",
                "rows": rows,
            }
        ]
    }


def build_geometry() -> dict:
    """Reference features that are not part of the editable layout."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": f"{SITE_ID}:landmark:wslc",
                "properties": {
                    "kind": "landmark",
                    "name": "Wine Spectator Learning Center",
                    "accuracy": "mapped",
                    "source": "OpenStreetMap way 362188591",
                },
                "geometry": {"type": "Point", "coordinates": list(LANDMARK_LNG_LAT)},
            }
        ],
    }


def segment_specs() -> list[dict]:
    specs = []
    for r, count in enumerate(SEGMENT_COUNTS, start=1):
        for n in range(1, count + 1):
            sid = segment_id(r, n)
            metrics = ["soil_moisture_vwc", "soil_temperature"] + (["leaf_wetness"] if r == 1 else [])
            specs.append({"id": sid, "metrics": metrics, "no_data": sid == NO_DATA_SEGMENT})
    return specs


# Fixed, past sample window so nothing can be mistaken for "now".
WINDOW_END = datetime(2026, 10, 16, 6, 0, tzinfo=timezone.utc)  # 2026-10-15 23:00 PDT
WINDOW_HOURS = 48


def series_for(metric: str, seed: int) -> list[list]:
    rng = random.Random(seed)
    points = []
    for h in range(WINDOW_HOURS):
        t = WINDOW_END - timedelta(hours=WINDOW_HOURS - 1 - h)
        local_hour = (t.hour - 7) % 24
        day = math.sin((local_hour - 9) / 24 * 2 * math.pi)  # peak ~15:00 local
        noise = rng.uniform(-1, 1)
        if metric == "soil_moisture_vwc":
            v = 27.0 - 0.06 * h + 0.25 * noise - (seed % 3) * 0.8
        elif metric == "soil_temperature":
            lag = math.sin((local_hour - 12) / 24 * 2 * math.pi)
            v = 60.5 + 2.2 * lag + 0.2 * noise
        elif metric == "leaf_wetness":
            # Wet overnight (dew), dry by late morning.
            v = max(0.0, min(100.0, 45.0 - 60.0 * day + 4.0 * noise))
        else:
            v = 0.0
        points.append([t.isoformat().replace("+00:00", "Z"), round(v, 1)])
    return points


def main() -> None:
    geometry = build_geometry()
    segment_data, series = {}, {}
    for i, spec in enumerate(segment_specs()):
        segment_data[spec["id"]] = {
            "provider": "example-local",
            "device_id": None,
            "description": "Example soil moisture / temperature readings (illustrative depth 30 cm)."
            + (" Includes an example leaf-wetness series." if "leaf_wetness" in spec["metrics"] else "")
            + (" Deliberately has no readings in the sample window, to show the empty / offline state." if spec["no_data"] else ""),
            "metrics": [{"metric": m, "label": METRIC_LABELS[m][0], "unit": METRIC_LABELS[m][1]} for m in spec["metrics"]],
        }
        series[spec["id"]] = {m: ([] if spec["no_data"] else series_for(m, i * 10 + j)) for j, m in enumerate(spec["metrics"])}

    payload = {
        "schema_version": 2,
        "_notice": "ILLUSTRATIVE EXAMPLE DATA. Bed outline and rows are traced from imagery, not surveyed. "
        "Row segments are evenly spaced starting points. Readings are synthetic and not live. Generated by scripts/generate_example_site.py.",
        "site": {
            "id": SITE_ID,
            "name": "SSU WINE SPECTATOR CENTER — Campus Vineyard",
            "short_name": "SSU Campus Vineyard",
            "institution": "Sonoma State University",
            "timezone": "America/Los_Angeles",
            "is_example": True,
            "geometry_accuracy": "approximate",
            "geometry_notes": [
                "Anchored to the Wine Spectator Learning Center building as mapped in OpenStreetMap (way 362188591).",
                "Bed outline traced from georeferenced aerial imagery (Esri World Imagery) and matched to the project "
                "team's screenshot: about 16 m × 7 m just south of the building, following the bed's uneven edge and "
                "rounded east end. The concrete pad at its north-west corner is excluded. Not surveyed (about ±1–2 m).",
                "Three east–west vine rows, traced from the same imagery and screenshot.",
                "Rows are divided into 2, 3 and 4 segments (north to south), evenly spaced as a starting point. "
                "Segment boundaries are not derived from vegetation density; adjust them in Options → Vineyard layout.",
                "No sensors are confirmed at this plot; per-segment readings are synthetic examples.",
            ],
            "primary_block_id": BLOCK_ID,
        },
        "provider": {"id": "example-local", "name": "Built-in example data", "kind": "example"},
        "sample_window": {
            "start": series_for("soil_temperature", 0)[0][0],
            "end": WINDOW_END.isoformat().replace("+00:00", "Z"),
            "interval_minutes": 60,
        },
        "geometry": geometry,
        "layout": build_layout(),
        "segment_data": segment_data,
        "series": series,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT}")


if __name__ == "__main__":
    main()
