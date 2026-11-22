from __future__ import annotations

import json
import sqlite3
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS vineyards (id TEXT PRIMARY KEY, name TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS vineyard_blocks (id TEXT PRIMARY KEY, vineyard_id TEXT NOT NULL, name TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS data_sources (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, filename TEXT NOT NULL, imported_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS import_jobs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, status TEXT NOT NULL, mapping_json TEXT NOT NULL, raw_rows_json TEXT NOT NULL, records_processed INTEGER NOT NULL DEFAULT 0, records_accepted INTEGER NOT NULL DEFAULT 0, records_rejected INTEGER NOT NULL DEFAULT 0, validation_errors_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, vineyard_id TEXT NOT NULL, block_id TEXT, timestamp TEXT NOT NULL, observation_type TEXT NOT NULL, source_id TEXT NOT NULL, measurement_type TEXT NOT NULL, numeric_value REAL, categorical_value TEXT, unit TEXT, original_value TEXT, original_unit TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', source_worksheet TEXT, source_row INTEGER, fingerprint TEXT NOT NULL UNIQUE);
"""


class Database:
    def __init__(self, path: str | Path = "data/vineyard.sqlite3"):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def initialize(self):
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    @staticmethod
    def dumps(value) -> str:
        return json.dumps(value, default=str, separators=(",", ":"))
