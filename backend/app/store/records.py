"""Alerts, alert types, segment photos and observation notes (manually entered records).

Nothing here is inferred automatically: no diagnosis, no imagery analysis, no treatment advice.
Resolving an alert keeps it as history; alerts are never deleted by the UI.
"""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .db import connect, new_id, now_iso

Severity = Literal["low", "medium", "high"]
EntityKind = Literal["site", "block", "row", "segment"]
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ICONS = ["⚑", "✚", "✱", "≈", "▲", "●", "◆", "★"]

# Editable starting set. Users can rename/recolor these or add their own.
EXAMPLE_TYPES = [
    ("disease", "Disease", "#b3261e", "✚", "high"),
    ("pest", "Pest", "#8a5a00", "✱", "medium"),
    ("irrigation", "Irrigation", "#1f6fb2", "≈", "medium"),
    ("damage", "Damage", "#c25e00", "▲", None),
    ("other", "Other", "#5b5f66", "⚑", None),
]


class AlertTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: Optional[str] = None
    icon: Optional[str] = Field(default=None, max_length=2)
    default_severity: Optional[Severity] = None


class AlertTypePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    color: Optional[str] = None
    icon: Optional[str] = Field(default=None, max_length=2)
    default_severity: Optional[Severity] = None
    clear_default_severity: bool = False


class AlertIn(BaseModel):
    entity_kind: EntityKind
    entity_id: str = Field(min_length=1, max_length=96)
    type_id: str = Field(min_length=1, max_length=64)
    severity: Optional[Severity] = None
    description: str = Field(min_length=1, max_length=2000)


class AlertPatch(BaseModel):
    type_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    severity: Optional[Severity] = None
    clear_severity: bool = False
    description: Optional[str] = Field(default=None, min_length=1, max_length=2000)


NoteKind = Literal["observation", "correction"]


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    observed_at: Optional[str] = None
    # "correction": an annotation about a reading. The reading itself is never modified.
    kind: NoteKind = "observation"
    refers_to: Optional[str] = Field(default=None, max_length=200)


class NotePatch(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=4000)
    observed_at: Optional[str] = None
    kind: Optional[NoteKind] = None
    refers_to: Optional[str] = Field(default=None, max_length=200)


class PhotoPatch(BaseModel):
    caption: Optional[str] = Field(default=None, max_length=300)
    taken_at: Optional[str] = None


class RecordError(ValueError):
    pass


class NotFound(RecordError):
    pass


def _check_type_fields(color: Optional[str], icon: Optional[str]) -> None:
    if color is not None and not COLOR_RE.match(color):
        raise RecordError("Color must look like #1f6fb2")
    if icon is not None and icon not in ICONS:
        raise RecordError(f"Icon must be one of {' '.join(ICONS)}")


# ---------- alert types ----------

def _seed_types(conn) -> None:
    if conn.execute("SELECT 1 FROM alert_types LIMIT 1").fetchone():
        return
    ts = now_iso()
    for tid, name, color, icon, sev in EXAMPLE_TYPES:
        conn.execute("INSERT INTO alert_types (id, name, color, icon, default_severity, is_example, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)", (tid, name, color, icon, sev, ts, ts))


def _type_dict(r, used: int = 0) -> dict:
    return {"id": r["id"], "name": r["name"], "color": r["color"], "icon": r["icon"], "default_severity": r["default_severity"], "is_example": bool(r["is_example"]), "in_use": used}


def list_alert_types() -> list[dict]:
    with connect() as conn:
        _seed_types(conn)
        rows = conn.execute("SELECT t.*, (SELECT COUNT(*) FROM alerts a WHERE a.type_id = t.id) AS used FROM alert_types t ORDER BY t.is_example DESC, t.created_at, t.name").fetchall()
    return [_type_dict(r, r["used"]) for r in rows]


def create_alert_type(body: AlertTypeIn) -> dict:
    _check_type_fields(body.color, body.icon)
    ts = now_iso()
    with connect() as conn:
        _seed_types(conn)
        if conn.execute("SELECT 1 FROM alert_types WHERE lower(name) = lower(?)", (body.name.strip(),)).fetchone():
            raise RecordError(f"An alert type named {body.name.strip()!r} already exists")
        tid = new_id("type")
        conn.execute("INSERT INTO alert_types (id, name, color, icon, default_severity, is_example, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)", (tid, body.name.strip(), body.color, body.icon or "⚑", body.default_severity, ts, ts))
    return next(t for t in list_alert_types() if t["id"] == tid)


def update_alert_type(type_id: str, body: AlertTypePatch) -> dict:
    _check_type_fields(body.color, body.icon)
    with connect() as conn:
        _seed_types(conn)
        row = conn.execute("SELECT * FROM alert_types WHERE id = ?", (type_id,)).fetchone()
        if row is None:
            raise NotFound(f"Unknown alert type {type_id!r}")
        name = body.name.strip() if body.name else row["name"]
        if conn.execute("SELECT 1 FROM alert_types WHERE lower(name) = lower(?) AND id != ?", (name, type_id)).fetchone():
            raise RecordError(f"An alert type named {name!r} already exists")
        sev = None if body.clear_default_severity else (body.default_severity or row["default_severity"])
        conn.execute("UPDATE alert_types SET name = ?, color = ?, icon = ?, default_severity = ?, updated_at = ? WHERE id = ?", (name, body.color or row["color"], body.icon or row["icon"], sev, now_iso(), type_id))
    return next(t for t in list_alert_types() if t["id"] == type_id)


def delete_alert_type(type_id: str) -> None:
    with connect() as conn:
        if conn.execute("SELECT 1 FROM alerts WHERE type_id = ? LIMIT 1", (type_id,)).fetchone():
            raise RecordError("This type is used by existing alerts (including resolved history), so it can be edited but not deleted.")
        if conn.execute("DELETE FROM alert_types WHERE id = ?", (type_id,)).rowcount == 0:
            raise NotFound(f"Unknown alert type {type_id!r}")


# ---------- alerts ----------

def _alert_dict(r) -> dict:
    return {k: r[k] for k in ("id", "site_id", "entity_kind", "entity_id", "type_id", "severity", "description", "status", "created_at", "updated_at", "resolved_at", "layout_version")}


def list_alerts(site_id: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM alerts WHERE site_id = ? ORDER BY created_at DESC", (site_id,)).fetchall()
    return [_alert_dict(r) for r in rows]


def get_alert(alert_id: str) -> dict:
    with connect() as conn:
        r = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    if r is None:
        raise NotFound(f"Unknown alert {alert_id!r}")
    return _alert_dict(r)


def _require_type(conn, type_id: str):
    _seed_types(conn)
    row = conn.execute("SELECT * FROM alert_types WHERE id = ?", (type_id,)).fetchone()
    if row is None:
        raise RecordError(f"Unknown alert type {type_id!r}")
    return row


def create_alert(site_id: str, body: AlertIn, layout_version: int) -> dict:
    ts = now_iso()
    with connect() as conn:
        t = _require_type(conn, body.type_id)
        aid = new_id("alert")
        conn.execute(
            "INSERT INTO alerts (id, site_id, entity_kind, entity_id, type_id, severity, description, status, created_at, updated_at, layout_version) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
            (aid, site_id, body.entity_kind, body.entity_id, body.type_id, body.severity or t["default_severity"], body.description.strip(), ts, ts, layout_version),
        )
    return get_alert(aid)


def update_alert(alert_id: str, body: AlertPatch) -> dict:
    current = get_alert(alert_id)
    with connect() as conn:
        if body.type_id:
            _require_type(conn, body.type_id)
        sev = None if body.clear_severity else (body.severity or current["severity"])
        conn.execute(
            "UPDATE alerts SET type_id = ?, severity = ?, description = ?, updated_at = ? WHERE id = ?",
            (body.type_id or current["type_id"], sev, (body.description or current["description"]).strip(), now_iso(), alert_id),
        )
    return get_alert(alert_id)


def set_alert_status(alert_id: str, resolved: bool) -> dict:
    get_alert(alert_id)
    ts = now_iso()
    with connect() as conn:
        if resolved:
            conn.execute("UPDATE alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'active'", (ts, ts, alert_id))
        else:
            conn.execute("UPDATE alerts SET status = 'active', resolved_at = NULL, updated_at = ? WHERE id = ?", (ts, alert_id))
    return get_alert(alert_id)


# ---------- photos & notes ----------

def add_photo(site_id: str, segment_id: str, *, taken_at: str, caption: Optional[str], filename: str, content_type: str, layout_version: int, photo_id: str) -> dict:
    with connect() as conn:
        conn.execute(
            "INSERT INTO segment_photos (id, site_id, segment_id, taken_at, caption, filename, content_type, uploaded_at, layout_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (photo_id, site_id, segment_id, taken_at, caption, filename, content_type, now_iso(), layout_version),
        )
    return get_photo(photo_id)


def get_photo(photo_id: str) -> dict:
    with connect() as conn:
        r = conn.execute("SELECT * FROM segment_photos WHERE id = ?", (photo_id,)).fetchone()
    if r is None:
        raise NotFound(f"Unknown photo {photo_id!r}")
    return {k: r[k] for k in r.keys()}


def add_note(site_id: str, segment_id: str, body: NoteIn, layout_version: int) -> dict:
    nid = new_id("note")
    ts = now_iso()
    with connect() as conn:
        conn.execute(
            "INSERT INTO segment_notes (id, site_id, segment_id, observed_at, text, created_at, layout_version, kind, refers_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (nid, site_id, segment_id, body.observed_at or ts, body.text.strip(), ts, layout_version, body.kind, (body.refers_to or "").strip() or None),
        )
    return get_note(nid)


def get_note(note_id: str) -> dict:
    with connect() as conn:
        r = conn.execute("SELECT * FROM segment_notes WHERE id = ?", (note_id,)).fetchone()
    if r is None:
        raise NotFound(f"Unknown note {note_id!r}")
    return {k: r[k] for k in r.keys()}


def update_note(note_id: str, body: NotePatch) -> dict:
    cur = get_note(note_id)
    with connect() as conn:
        conn.execute(
            "UPDATE segment_notes SET text = ?, observed_at = ?, kind = ?, refers_to = ?, edited_at = ? WHERE id = ?",
            ((body.text or cur["text"]).strip(), body.observed_at or cur["observed_at"], body.kind or cur["kind"],
             cur["refers_to"] if body.refers_to is None else (body.refers_to.strip() or None), now_iso(), note_id),
        )
    return get_note(note_id)


def update_photo(photo_id: str, body: PhotoPatch) -> dict:
    """Edit descriptive fields only; the image file itself is never replaced (upload a new photo instead)."""
    cur = get_photo(photo_id)
    with connect() as conn:
        conn.execute(
            "UPDATE segment_photos SET caption = ?, taken_at = ?, edited_at = ? WHERE id = ?",
            (cur["caption"] if body.caption is None else (body.caption.strip() or None), body.taken_at or cur["taken_at"], now_iso(), photo_id),
        )
    return get_photo(photo_id)


def records_for(site_id: str, segment_ids: list[str]) -> dict[str, list[dict]]:
    if not segment_ids:
        return {"photos": [], "notes": []}
    marks = ",".join("?" * len(segment_ids))
    with connect() as conn:
        photos = conn.execute(f"SELECT * FROM segment_photos WHERE site_id = ? AND segment_id IN ({marks}) ORDER BY taken_at DESC, uploaded_at DESC", (site_id, *segment_ids)).fetchall()
        notes = conn.execute(f"SELECT * FROM segment_notes WHERE site_id = ? AND segment_id IN ({marks}) ORDER BY observed_at DESC", (site_id, *segment_ids)).fetchall()
    return {"photos": [{k: r[k] for k in r.keys()} for r in photos], "notes": [{k: r[k] for k in r.keys()} for r in notes]}
