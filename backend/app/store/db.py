"""Local SQLite persistence for map layout, lineage, alerts and segment records.

Uses the same database file as the CSV/XLSX importer (VINEYARD_DB_PATH, default
backend/data/vineyard.sqlite3 when run from backend/). Tables are created on demand.
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS site_layouts (
  site_id TEXT NOT NULL, version INTEGER NOT NULL, saved_at TEXT NOT NULL,
  layout_json TEXT NOT NULL, PRIMARY KEY (site_id, version));
CREATE TABLE IF NOT EXISTS segment_lineage (
  site_id TEXT NOT NULL, segment_id TEXT NOT NULL, block_id TEXT NOT NULL, row_id TEXT NOT NULL,
  name TEXT NOT NULL, parent_ids_json TEXT NOT NULL DEFAULT '[]',
  created_version INTEGER NOT NULL, retired_version INTEGER,
  created_at TEXT NOT NULL, retired_at TEXT, PRIMARY KEY (site_id, segment_id));
CREATE TABLE IF NOT EXISTS alert_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, icon TEXT, default_severity TEXT,
  is_example INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL,
  type_id TEXT NOT NULL, severity TEXT, description TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT, layout_version INTEGER);
CREATE TABLE IF NOT EXISTS segment_photos (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, segment_id TEXT NOT NULL, taken_at TEXT NOT NULL,
  caption TEXT, filename TEXT NOT NULL, content_type TEXT NOT NULL, uploaded_at TEXT NOT NULL,
  layout_version INTEGER, edited_at TEXT);
CREATE TABLE IF NOT EXISTS segment_notes (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, segment_id TEXT NOT NULL, observed_at TEXT NOT NULL,
  text TEXT NOT NULL, created_at TEXT NOT NULL, layout_version INTEGER,
  kind TEXT NOT NULL DEFAULT 'observation', refers_to TEXT, edited_at TEXT);
CREATE INDEX IF NOT EXISTS alerts_entity ON alerts (site_id, entity_kind, entity_id);
"""

# Columns added after the first release of these tables (existing databases are upgraded in place).
ADDED_COLUMNS = {
    "segment_notes": [("kind", "TEXT NOT NULL DEFAULT 'observation'"), ("refers_to", "TEXT"), ("edited_at", "TEXT")],
    "segment_photos": [("edited_at", "TEXT")],
}

_initialized: set[str] = set()


def _upgrade(conn: sqlite3.Connection) -> None:
    for table, columns in ADDED_COLUMNS.items():
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, decl in columns:
            if name not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


def db_path() -> Path:
    return Path(os.getenv("VINEYARD_DB_PATH", "data/vineyard.sqlite3"))


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    key = str(path.resolve())
    if key not in _initialized:
        conn.executescript(SCHEMA)
        _upgrade(conn)
        conn.commit()
        _initialized.add(key)
    return conn


def media_dir() -> Path:
    path = db_path().parent / "photos"
    path.mkdir(parents=True, exist_ok=True)
    return path


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
