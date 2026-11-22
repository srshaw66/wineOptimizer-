"""Versioned site layout (blocks -> rows -> row segments) and segment lineage.

* Every Save writes a new layout version; older versions are kept for context.
* Segments are stored as fractions [start, end) along their row line, so moving a
  row keeps its segments attached.
* Dragging a boundary keeps segment ids. Changing a row's segment count creates new
  segment ids; the backend computes each new segment's parent_ids from the previous
  version's segments on the same row that overlap it, and retires the old ones.
  Records are never copied: views resolve inherited records through this lineage.
"""
from __future__ import annotations

import json
import re
from collections import deque
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.sensors.sites import load_example_site

from .db import connect, dumps, now_iso

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:_.-]{0,95}$")
MAX_POINTS = 2000          # generous: outlines may need many vertices
MAX_SEGMENTS_PER_ROW = 50
MIN_SEGMENT_FRACTION = 0.005
SITE_RADIUS_DEG = 0.05     # geometry must stay within ~5 km of the site landmark (catches lat/lng swaps)


class LayoutError(ValueError):
    pass


class LayoutConflict(LayoutError):
    pass


LngLat = tuple[float, float]


class SourceIn(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    device_id: Optional[str] = Field(default=None, max_length=80)
    external_id: Optional[str] = Field(default=None, max_length=120)


class SegmentIn(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)
    start: float = Field(ge=0, le=1)
    end: float = Field(ge=0, le=1)
    sources: list[SourceIn] = Field(default_factory=list, max_length=10)


class RowIn(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    line: list[LngLat] = Field(min_length=2, max_length=MAX_POINTS)
    segments: list[SegmentIn] = Field(min_length=1, max_length=MAX_SEGMENTS_PER_ROW)


class BlockIn(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    outline: list[LngLat] = Field(min_length=3, max_length=MAX_POINTS)
    rows: list[RowIn] = Field(default_factory=list, max_length=200)


class LayoutSave(BaseModel):
    base_version: int
    blocks: list[BlockIn] = Field(max_length=50)

    @field_validator("blocks")
    @classmethod
    def _names(cls, blocks):
        for b in blocks:
            b.name = b.name.strip()
            for r in b.rows:
                r.name = r.name.strip()
                for s in r.segments:
                    s.name = s.name.strip()
        return blocks


# ---------- read ----------

def _seed(site_id: str, conn) -> None:
    seed = load_example_site(site_id)["layout"]
    ts = now_iso()
    layout = {"site_id": site_id, "version": 1, "saved_at": ts, "blocks": seed["blocks"]}
    conn.execute("INSERT INTO site_layouts (site_id, version, saved_at, layout_json) VALUES (?, 1, ?, ?)", (site_id, ts, dumps(layout)))
    for block in seed["blocks"]:
        for row in block["rows"]:
            for seg in row["segments"]:
                conn.execute(
                    "INSERT OR IGNORE INTO segment_lineage (site_id, segment_id, block_id, row_id, name, parent_ids_json, created_version, created_at) VALUES (?, ?, ?, ?, ?, '[]', 1, ?)",
                    (site_id, seg["id"], block["id"], row["id"], seg["name"], ts),
                )


# Display-name migrations applied once to saved layouts (ids are never changed, so records stay linked).
RENAMES = {("teaching-plot", "Teaching plot"): "Block 1"}


def _migrate(conn, layout: dict) -> dict:
    """Write a new layout version if an old display name is still in use. Geometry and segments are unchanged."""
    if not any((b["id"], b["name"]) in RENAMES for b in layout["blocks"]):
        return layout
    blocks = [{**b, "name": RENAMES.get((b["id"], b["name"]), b["name"])} for b in layout["blocks"]]
    migrated = {**layout, "version": layout["version"] + 1, "saved_at": now_iso(), "blocks": blocks}
    conn.execute("INSERT INTO site_layouts (site_id, version, saved_at, layout_json) VALUES (?, ?, ?, ?)", (layout["site_id"], migrated["version"], migrated["saved_at"], dumps(migrated)))
    return migrated


def current_layout(site_id: str) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT layout_json FROM site_layouts WHERE site_id = ? ORDER BY version DESC LIMIT 1", (site_id,)).fetchone()
        if row is None:
            _seed(site_id, conn)
            row = conn.execute("SELECT layout_json FROM site_layouts WHERE site_id = ? ORDER BY version DESC LIMIT 1", (site_id,)).fetchone()
        return _migrate(conn, json.loads(row["layout_json"]))


def lineage(site_id: str) -> dict[str, dict]:
    current_layout(site_id)  # make sure the seed exists
    with connect() as conn:
        rows = conn.execute("SELECT * FROM segment_lineage WHERE site_id = ?", (site_id,)).fetchall()
    return {
        r["segment_id"]: {
            "segment_id": r["segment_id"], "block_id": r["block_id"], "row_id": r["row_id"], "name": r["name"],
            "parent_ids": json.loads(r["parent_ids_json"]), "created_version": r["created_version"],
            "retired_version": r["retired_version"], "created_at": r["created_at"], "retired_at": r["retired_at"],
        }
        for r in rows
    }


def ancestors(registry: dict[str, dict], segment_id: str) -> list[str]:
    """All earlier segments this one derives from, nearest first (breadth-first, no duplicates)."""
    out: list[str] = []
    seen = {segment_id}
    queue = deque(registry.get(segment_id, {}).get("parent_ids", []))
    while queue:
        sid = queue.popleft()
        if sid in seen:
            continue
        seen.add(sid)
        out.append(sid)
        queue.extend(registry.get(sid, {}).get("parent_ids", []))
    return out


def current_descendants(registry: dict[str, dict], segment_id: str) -> list[str]:
    """Active segments that derive from `segment_id` (itself if it is still active)."""
    children: dict[str, list[str]] = {}
    for sid, entry in registry.items():
        for p in entry["parent_ids"]:
            children.setdefault(p, []).append(sid)
    out, seen, queue = [], set(), deque([segment_id])
    while queue:
        sid = queue.popleft()
        if sid in seen:
            continue
        seen.add(sid)
        entry = registry.get(sid)
        if entry and entry["retired_version"] is None:
            out.append(sid)
        else:
            queue.extend(children.get(sid, []))
    return sorted(out)


def iter_entities(layout: dict):
    """(kind, id, name, block, row, segment) for every block, row and segment."""
    for b in layout["blocks"]:
        yield "block", b["id"], b["name"], b, None, None
        for r in b["rows"]:
            yield "row", r["id"], r["name"], b, r, None
            for s in r["segments"]:
                yield "segment", s["id"], s["name"], b, r, s


def entity_exists(layout: dict, kind: str, entity_id: str) -> bool:
    if kind == "site":
        return entity_id == layout["site_id"]
    return any(k == kind and i == entity_id for k, i, *_ in iter_entities(layout))


# ---------- save ----------

def _check_coords(points: list[LngLat], anchor: LngLat, what: str) -> None:
    for lng, lat in points:
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise LayoutError(f"{what}: coordinate out of range ({lng}, {lat})")
        if abs(lng - anchor[0]) > SITE_RADIUS_DEG or abs(lat - anchor[1]) > SITE_RADIUS_DEG:
            raise LayoutError(f"{what}: point ({lng:.6f}, {lat:.6f}) is too far from the site. Coordinates must be [longitude, latitude].")


def _same_points(a, b) -> bool:
    return a is not None and len(a) == len(b) and all(abs(x[0] - y[0]) < 1e-9 and abs(x[1] - y[1]) < 1e-9 for x, y in zip(a, b))


def _accuracy(previous: Optional[dict], key: str, points) -> str:
    if previous is None:
        return "drawn"
    if _same_points(previous.get(key), points):
        return previous.get("accuracy", "traced")
    return "edited"


def save_layout(site_id: str, request: LayoutSave) -> dict:
    anchor = tuple(load_example_site(site_id)["geometry"]["features"][0]["geometry"]["coordinates"])
    seen_ids: set[str] = set()

    def check_id(value: str, what: str) -> None:
        if not ID_RE.match(value):
            raise LayoutError(f"{what}: invalid id {value!r}")
        if value in seen_ids:
            raise LayoutError(f"Duplicate id {value!r}")
        seen_ids.add(value)

    for b in request.blocks:
        check_id(b.id, "Block")
        _check_coords(b.outline, anchor, f"Block {b.name!r}")
        for r in b.rows:
            check_id(r.id, "Row")
            _check_coords(r.line, anchor, f"Row {r.name!r}")
            segs = sorted(r.segments, key=lambda s: s.start)
            if abs(segs[0].start) > 1e-9 or abs(segs[-1].end - 1) > 1e-9:
                raise LayoutError(f"Row {r.name!r}: segments must cover the whole row")
            for prev, nxt in zip(segs, segs[1:]):
                if abs(prev.end - nxt.start) > 1e-9:
                    raise LayoutError(f"Row {r.name!r}: segments must be contiguous")
            for s in segs:
                check_id(s.id, "Segment")
                if s.end - s.start < MIN_SEGMENT_FRACTION:
                    raise LayoutError(f"Row {r.name!r}: segment {s.name!r} is too short")
            r.segments = segs

    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT version, layout_json FROM site_layouts WHERE site_id = ? ORDER BY version DESC LIMIT 1", (site_id,)).fetchone()
        if row is None:
            _seed(site_id, conn)
            row = conn.execute("SELECT version, layout_json FROM site_layouts WHERE site_id = ? ORDER BY version DESC LIMIT 1", (site_id,)).fetchone()
        else:
            # Apply pending display-name migrations before checking the client's base version.
            migrated = _migrate(conn, json.loads(row["layout_json"]))
            row = {"version": migrated["version"], "layout_json": dumps(migrated)}
        if row["version"] != request.base_version:
            raise LayoutConflict(f"The map was saved elsewhere (version {row['version']}); reload before saving.")
        previous = json.loads(row["layout_json"])
        version = row["version"] + 1
        ts = now_iso()
        registry = {r["segment_id"]: r for r in conn.execute("SELECT * FROM segment_lineage WHERE site_id = ?", (site_id,)).fetchall()}
        prev_blocks = {b["id"]: b for b in previous["blocks"]}
        prev_rows = {r["id"]: r for b in previous["blocks"] for r in b["rows"]}
        prev_active = {s["id"] for r in prev_rows.values() for s in r["segments"]}

        blocks_out, active_now = [], set()
        for b in request.blocks:
            pb = prev_blocks.get(b.id)
            rows_out = []
            for r in b.rows:
                pr = prev_rows.get(r.id)
                segs_out = []
                for s in r.segments:
                    reg = registry.get(s.id)
                    if reg is not None:
                        if s.id not in prev_active:
                            raise LayoutError(f"Segment id {s.id!r} was retired and cannot be reused")
                        if reg["row_id"] != r.id:
                            raise LayoutError(f"Segment {s.id!r} cannot move to another row")
                        parents = json.loads(reg["parent_ids_json"])
                        conn.execute("UPDATE segment_lineage SET name = ?, block_id = ? WHERE site_id = ? AND segment_id = ?", (s.name, b.id, site_id, s.id))
                    else:
                        # New segment: derive lineage from overlapping segments of the previous version of this row.
                        parents = [p["id"] for p in (pr["segments"] if pr else []) if min(p["end"], s.end) - max(p["start"], s.start) > 1e-6]
                        conn.execute(
                            "INSERT INTO segment_lineage (site_id, segment_id, block_id, row_id, name, parent_ids_json, created_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (site_id, s.id, b.id, r.id, s.name, dumps(parents), version, ts),
                        )
                    active_now.add(s.id)
                    segs_out.append({"id": s.id, "name": s.name, "description": (s.description or "").strip() or None, "start": round(s.start, 6), "end": round(s.end, 6), "parent_ids": parents, "sources": [src.model_dump() for src in s.sources]})
                line = [list(p) for p in r.line]
                rows_out.append({"id": r.id, "name": r.name, "line": line, "accuracy": _accuracy(pr, "line", line), "segments": segs_out})
            outline = [list(p) for p in b.outline]
            blocks_out.append({"id": b.id, "name": b.name, "outline": outline, "accuracy": _accuracy(pb, "outline", outline), "rows": rows_out})

        for sid in prev_active - active_now:
            conn.execute("UPDATE segment_lineage SET retired_version = ?, retired_at = ? WHERE site_id = ? AND segment_id = ?", (version, ts, site_id, sid))

        layout = {"site_id": site_id, "version": version, "saved_at": ts, "blocks": blocks_out}
        conn.execute("INSERT INTO site_layouts (site_id, version, saved_at, layout_json) VALUES (?, ?, ?, ?)", (site_id, version, ts, dumps(layout)))
        # Keep the importer's block list in step so imports can target new blocks.
        try:
            for b in blocks_out:
                conn.execute(
                    "INSERT INTO vineyard_blocks (id, vineyard_id, name, metadata_json) VALUES (?, ?, ?, '{}') ON CONFLICT(id) DO UPDATE SET name = excluded.name",
                    (b["id"], site_id, b["name"]),
                )
        except Exception:  # importer tables not created (e.g. in isolated tests)
            pass
    return layout


# ---------- GeoJSON ----------

def layout_geojson(layout: dict) -> list[dict]:
    from app.sensors.geometry import slice_line  # small, dependency-free helper

    features = []
    for b in layout["blocks"]:
        ring = [list(p) for p in b["outline"]] + [list(b["outline"][0])]
        features.append({"type": "Feature", "id": b["id"], "properties": {"kind": "planting_area", "block_id": b["id"], "name": b["name"], "accuracy": b.get("accuracy")}, "geometry": {"type": "Polygon", "coordinates": [ring]}})
        for r in b["rows"]:
            features.append({"type": "Feature", "id": r["id"], "properties": {"kind": "row", "block_id": b["id"], "row_id": r["id"], "name": r["name"], "accuracy": r.get("accuracy")}, "geometry": {"type": "LineString", "coordinates": r["line"]}})
            for s in r["segments"]:
                features.append({"type": "Feature", "id": s["id"], "properties": {"kind": "row_segment", "block_id": b["id"], "row_id": r["id"], "segment_id": s["id"], "name": s["name"], "start": s["start"], "end": s["end"]}, "geometry": {"type": "LineString", "coordinates": slice_line(r["line"], s["start"], s["end"])}})
    return features
