"""Site, layout, segment-data, record and alert endpoints.

Hierarchy: site -> block -> row -> row segment. Row segments are the data-bearing
map entity. Inherited records (from segments that were split or merged) are resolved
here through the lineage registry; they are labelled, never copied.
"""
from __future__ import annotations

import io
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.sensors.models import ProviderInfo, Reading
from app.sensors.providers.base import ProviderError, data_status
from app.sensors.registry import get_provider
from app.sensors.sites import DEFAULT_SITE_ID, SiteNotFound, load_example_site, site_geometry, site_summary
from app.store import records as rec
from app.store.db import media_dir, new_id
from app.store.layout import (LayoutConflict, LayoutError, LayoutSave, ancestors, current_descendants, current_layout,
                              entity_exists, iter_entities, lineage, save_layout)

router = APIRouter(prefix="/api")

PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
MAX_PHOTO_BYTES = 10 * 1024 * 1024


def _site_or_404(site_id: str) -> dict:
    try:
        return site_summary(site_id)
    except SiteNotFound as exc:
        raise HTTPException(404, f"Unknown site {site_id!r}") from exc


def _current_segment(site_id: str, segment_id: str) -> tuple[dict, dict]:
    """(layout, segment) for an *active* segment. New records only attach to active segments."""
    layout = current_layout(site_id)
    for kind, eid, _name, _b, _r, seg in iter_entities(layout):
        if kind == "segment" and eid == segment_id:
            return layout, seg
    if segment_id in lineage(site_id):
        raise HTTPException(409, f"Segment {segment_id!r} was split or merged; add records to its current segments instead.")
    raise HTTPException(404, f"Unknown segment {segment_id!r}")


@router.get("/sites")
def list_sites():
    return [site_summary(DEFAULT_SITE_ID)]


@router.get("/sites/default")
def default_site():
    return site(DEFAULT_SITE_ID)


@router.get("/sites/{site_id}")
def site(site_id: str):
    summary = _site_or_404(site_id)
    # `geometry` holds reference features only (landmarks); blocks/rows/segments come from /layout.
    return {"site": summary, "geometry": load_example_site(site_id)["geometry"], "provider": get_provider().info()}


@router.get("/sites/{site_id}/geometry.geojson")
def geometry(site_id: str):
    _site_or_404(site_id)
    return site_geometry(site_id)


# ---------- layout ----------

@router.get("/sites/{site_id}/layout")
def get_layout(site_id: str):
    _site_or_404(site_id)
    return {"layout": current_layout(site_id), "lineage": lineage(site_id)}


@router.put("/sites/{site_id}/layout")
def put_layout(site_id: str, body: LayoutSave):
    _site_or_404(site_id)
    try:
        layout = save_layout(site_id, body)
    except LayoutConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except LayoutError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"layout": layout, "lineage": lineage(site_id)}


# ---------- segment data ----------

def _provider_data(site_id: str):
    provider = get_provider()
    info: ProviderInfo = provider.info()
    try:
        sources = {s.segment_id: s for s in provider.list_sources(site_id)}
        latest: dict[str, dict] = {}
        for r in provider.latest(site_id):
            latest.setdefault(r.segment_id, {})[r.metric] = r
    except ProviderError as exc:
        # Explicit, recoverable error. Never return an empty list that looks like "no data".
        raise HTTPException(502, {"provider": info.model_dump(), "message": str(exc)}) from exc
    return provider, info, sources, latest


@router.get("/sites/{site_id}/segments")
def segments(site_id: str) -> dict:
    _site_or_404(site_id)
    _, info, sources, latest = _provider_data(site_id)
    layout, registry = current_layout(site_id), lineage(site_id)
    out = []
    for kind, sid, _name, _b, _r, seg in iter_entities(layout):
        if kind != "segment":
            continue
        chain = [sid] + ancestors(registry, sid)
        metrics: dict[str, dict] = {}
        for cid in chain:
            if cid in sources:
                for m in sources[cid].metrics:
                    metrics.setdefault(m.metric, m.model_dump())
        resolved = []
        for metric in metrics:
            own = latest.get(sid, {}).get(metric)
            if own is not None and own.quality != "missing":
                resolved.append({**own.model_dump(), "inherited": False})
                continue
            inherited = [latest[c][metric] for c in chain[1:] if metric in latest.get(c, {}) and latest[c][metric].quality != "missing"]
            if inherited:
                best = max(inherited, key=lambda r: r.observed_at or "")
                resolved.append({**best.model_dump(), "inherited": True})
            else:
                fallback = own or next(latest[c][metric] for c in chain if metric in latest.get(c, {}))
                resolved.append({**fallback.model_dump(), "inherited": fallback.segment_id != sid})
        present = [r for r in resolved if r["quality"] != "missing"]
        status = data_status([Reading(**{k: v for k, v in r.items() if k != "inherited"}) for r in resolved], info.kind)
        described = next((sources[c] for c in chain if c in sources), None)
        out.append({
            "segment_id": sid,
            "status": status,
            "inherited_only": bool(present) and all(r["inherited"] for r in present),
            "is_example": info.kind == "example",
            "description": described.description if described else None,
            "metrics": list(metrics.values()),
            "latest": resolved,
            "ancestors": chain[1:],
            "has_own_data": sid in sources,
        })
    return {"provider": info, "segments": out}


@router.get("/sites/{site_id}/segments/{segment_id}/history")
def segment_history(site_id: str, segment_id: str, metric: str = Query(..., min_length=1), start: Optional[str] = None, end: Optional[str] = None):
    _site_or_404(site_id)
    registry = lineage(site_id)
    if segment_id not in registry:
        raise HTTPException(404, f"Unknown segment {segment_id!r}")
    provider, _info, sources, _ = _provider_data(site_id)
    chain = [segment_id] + ancestors(registry, segment_id)
    out = []
    for cid in chain:
        src = sources.get(cid)
        if src is None or not any(m.metric == metric for m in src.metrics):
            continue
        try:
            series = provider.history(site_id, cid, metric, start, end)
        except ProviderError as exc:
            raise HTTPException(502, str(exc)) from exc
        out.append({**series.model_dump(), "inherited": cid != segment_id})
    if not out:
        raise HTTPException(404, f"Segment {segment_id!r} has no metric {metric!r}")
    return {"segment_id": segment_id, "metric": metric, "series": out}


@router.get("/sites/{site_id}/segments/{segment_id}/records")
def segment_records(site_id: str, segment_id: str):
    _site_or_404(site_id)
    registry = lineage(site_id)
    if segment_id not in registry:
        raise HTTPException(404, f"Unknown segment {segment_id!r}")
    chain = [segment_id] + ancestors(registry, segment_id)
    data = rec.records_for(site_id, chain)
    for group in data.values():
        for r in group:
            r["inherited"] = r["segment_id"] != segment_id
    for p in data["photos"]:
        p["url"] = f"/api/photos/{p['id']}"
    return data


def _parse_when(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        if len(value) == 10:
            return date.fromisoformat(value).isoformat()
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat().replace("+00:00", "Z")
    except ValueError as exc:
        raise HTTPException(400, "Dates must be ISO-8601, e.g. 2026-11-21") from exc


@router.post("/sites/{site_id}/segments/{segment_id}/photos")
async def upload_photo(site_id: str, segment_id: str, file: UploadFile = File(...), taken_at: Optional[str] = Form(None), caption: Optional[str] = Form(None)):
    _site_or_404(site_id)
    layout, _seg = _current_segment(site_id, segment_id)
    ext = PHOTO_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(400, "Upload a JPEG, PNG, WebP or GIF image")
    payload = await file.read(MAX_PHOTO_BYTES + 1)
    if len(payload) > MAX_PHOTO_BYTES:
        raise HTTPException(400, "Photos are limited to 10 MB")
    try:
        from PIL import Image
        Image.open(io.BytesIO(payload)).verify()
    except ImportError:
        pass
    except Exception as exc:
        raise HTTPException(400, "The file is not a readable image") from exc
    if caption and len(caption) > 300:
        raise HTTPException(400, "Captions are limited to 300 characters")
    photo_id = new_id("photo")
    filename = f"{photo_id}{ext}"
    (media_dir() / filename).write_bytes(payload)
    when = _parse_when(taken_at) or date.today().isoformat()
    photo = rec.add_photo(site_id, segment_id, taken_at=when, caption=(caption or "").strip() or None, filename=filename, content_type=file.content_type, layout_version=layout["version"], photo_id=photo_id)
    return {**photo, "url": f"/api/photos/{photo_id}", "inherited": False}


@router.get("/photos/{photo_id}")
def get_photo(photo_id: str):
    try:
        photo = rec.get_photo(photo_id)
    except rec.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    path = media_dir() / photo["filename"]
    if not path.is_file():
        raise HTTPException(404, "Photo file is missing")
    return FileResponse(path, media_type=photo["content_type"])


@router.post("/sites/{site_id}/segments/{segment_id}/notes")
def add_note(site_id: str, segment_id: str, body: rec.NoteIn):
    _site_or_404(site_id)
    layout, _ = _current_segment(site_id, segment_id)
    body.observed_at = _parse_when(body.observed_at)
    return {**rec.add_note(site_id, segment_id, body, layout["version"]), "inherited": False}


@router.patch("/notes/{note_id}")
def update_note(note_id: str, body: rec.NotePatch):
    body.observed_at = _parse_when(body.observed_at)
    try:
        note = rec.update_note(note_id, body)
    except rec.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    return {**note, "inherited": False}


@router.patch("/photos/{photo_id}")
def update_photo(photo_id: str, body: rec.PhotoPatch):
    body.taken_at = _parse_when(body.taken_at)
    try:
        photo = rec.update_photo(photo_id, body)
    except rec.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    return {**photo, "url": f"/api/photos/{photo_id}", "inherited": False}


# ---------- alerts ----------

def _with_targets(site_id: str, alerts: list[dict]) -> list[dict]:
    layout, registry = current_layout(site_id), lineage(site_id)
    out = []
    for a in alerts:
        exists = entity_exists(layout, a["entity_kind"], a["entity_id"])
        if a["entity_kind"] == "segment":
            applies = current_descendants(registry, a["entity_id"])
        else:
            applies = [a["entity_id"]] if exists else []
        out.append({**a, "entity_exists": exists, "applies_to": applies})
    return out


@router.get("/sites/{site_id}/alerts")
def alerts(site_id: str):
    _site_or_404(site_id)
    return _with_targets(site_id, rec.list_alerts(site_id))


@router.post("/sites/{site_id}/alerts")
def create_alert(site_id: str, body: rec.AlertIn):
    _site_or_404(site_id)
    layout = current_layout(site_id)
    if not entity_exists(layout, body.entity_kind, body.entity_id):
        raise HTTPException(404, f"No current {body.entity_kind} {body.entity_id!r}")
    try:
        alert = rec.create_alert(site_id, body, layout["version"])
    except rec.RecordError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _with_targets(site_id, [alert])[0]


def _alert_op(fn, *args):
    try:
        alert = fn(*args)
    except rec.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except rec.RecordError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _with_targets(alert["site_id"], [alert])[0]


@router.patch("/alerts/{alert_id}")
def update_alert(alert_id: str, body: rec.AlertPatch):
    return _alert_op(rec.update_alert, alert_id, body)


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str):
    return _alert_op(rec.set_alert_status, alert_id, True)


@router.post("/alerts/{alert_id}/reopen")
def reopen_alert(alert_id: str):
    return _alert_op(rec.set_alert_status, alert_id, False)


@router.get("/alert-types")
def alert_types():
    return {"types": rec.list_alert_types(), "icons": rec.ICONS}


@router.post("/alert-types")
def create_alert_type(body: rec.AlertTypeIn):
    try:
        return rec.create_alert_type(body)
    except rec.RecordError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.patch("/alert-types/{type_id}")
def update_alert_type(type_id: str, body: rec.AlertTypePatch):
    try:
        return rec.update_alert_type(type_id, body)
    except rec.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except rec.RecordError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/alert-types/{type_id}")
def delete_alert_type(type_id: str):
    try:
        rec.delete_alert_type(type_id)
    except rec.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except rec.RecordError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"deleted": type_id}
