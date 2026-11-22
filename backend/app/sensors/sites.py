"""Site definitions. Currently one example site loaded from data/examples/.

Geometry is GeoJSON (WGS84, [lng, lat]). The schema is site-agnostic so more
sites can be added later as further files or database rows.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES_DIR = Path(os.getenv("VINEYARD_EXAMPLES_DIR", REPO_ROOT / "data" / "examples"))
DEFAULT_SITE_ID = "ssu-wsc-campus"


class SiteNotFound(KeyError):
    pass


@lru_cache(maxsize=8)
def load_example_site(site_id: str) -> dict:
    if not site_id.replace("-", "").isalnum():
        raise SiteNotFound(f"Unknown site {site_id!r}")
    path = EXAMPLES_DIR / f"{site_id}.example.json"
    if not path.is_file():
        raise SiteNotFound(f"Unknown site {site_id!r}")
    return json.loads(path.read_text(encoding="utf-8"))


def site_summary(site_id: str) -> dict:
    data = load_example_site(site_id)
    return {**data["site"], "sample_window": data.get("sample_window")}


def site_geometry(site_id: str) -> dict:
    """GeoJSON of the current *saved* layout (blocks, rows, segments) plus reference landmarks."""
    from app.store.layout import current_layout, layout_geojson  # local import: store depends on this module

    features = list(load_example_site(site_id)["geometry"]["features"])
    return {"type": "FeatureCollection", "features": layout_geojson(current_layout(site_id)) + features}
