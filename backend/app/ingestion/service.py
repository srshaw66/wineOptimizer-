from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from .database import Database
from .mapping import headers_from_tables, mapping_for_rows, suggest_mappings
from .normalize import fingerprint, normalize_unit, parse_number, parse_timestamp
from .registry import adapter_registry


MAX_FILE_BYTES = 10 * 1024 * 1024


class ImportService:
    def __init__(self, database: Database):
        self.database = database
        self.database.initialize()

    def preview(self, filename: str, payload: bytes) -> dict[str, Any]:
        if len(payload) > MAX_FILE_BYTES:
            raise ValueError("File exceeds the 10 MB import limit")
        adapter = adapter_registry.for_filename(filename)
        extraction = adapter.extract(payload, filename)
        headers = headers_from_tables(extraction.tables)
        now = datetime.now(timezone.utc).isoformat()
        source_id, import_id = str(uuid.uuid4()), str(uuid.uuid4())
        raw_rows = [{"worksheet": row.worksheet, "row_number": row.row_number, "values": row.values} for row in extraction.rows]
        with self.database.connect() as db:
            db.execute("INSERT INTO data_sources VALUES (?, ?, ?, ?, ?)", (source_id, adapter.source_type, filename, now, self.database.dumps({"size_bytes": len(payload)})))
            db.execute("INSERT INTO import_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (import_id, source_id, "preview", self.database.dumps({}), self.database.dumps(raw_rows), len(raw_rows), 0, 0, self.database.dumps(extraction.warnings), now))
        return {"import_id": import_id, "source_id": source_id, "filename": filename, "source_type": adapter.source_type, "worksheets": [{"name": t.worksheet, "header_row": t.header_row, "headers": t.headers, "row_count": len(t.rows), "sample_records": [r.values for r in t.rows[:5]], "warnings": t.warnings} for t in extraction.tables], "suggested_mappings": suggest_mappings(headers), "unmapped_columns": suggest_mappings(headers).get("unmapped", {}).get("columns", []), "warnings": extraction.warnings, "estimated_importable_records": len(raw_rows)}

    def confirm(self, import_id: str, vineyard_id: str, requested_mapping: dict[str, str], units: dict[str, str] | None = None) -> dict[str, Any]:
        units = units or {}
        with self.database.connect() as db:
            job = db.execute("SELECT * FROM import_jobs WHERE id = ?", (import_id,)).fetchone()
            if not job:
                raise ValueError("Import job not found")
            if job["status"].startswith("confirmed"):
                return self._result(job)
            raw_rows = json.loads(job["raw_rows_json"])
            headers = list(dict.fromkeys(key for row in raw_rows for key in row["values"]))
            mapping = mapping_for_rows(headers, requested_mapping)
            if "timestamp" not in mapping:
                raise ValueError("A date or timestamp mapping is required")
            if not any(field in mapping for field in ("value", "soil_moisture", "harvest_yield")):
                raise ValueError("Map at least one measurement value column")
            db.execute("INSERT OR IGNORE INTO vineyards (id, name) VALUES (?, ?)", (vineyard_id, vineyard_id))
            accepted = rejected = skipped = 0
            errors = json.loads(job["validation_errors_json"])
            for row in raw_rows:
                values = row["values"]
                row_mapping = dict(mapping)
                suggested = suggest_mappings(list(values))
                row_mapping = {field: column for field, column in row_mapping.items() if column in values}
                for field, suggestion in suggested.items():
                    if field != "unmapped" and field not in row_mapping and suggestion.get("source_column"):
                        row_mapping[field] = suggestion["source_column"]
                timestamp = parse_timestamp(values.get(row_mapping.get("timestamp")))
                block = str(values.get(row_mapping["block_id"], "")).strip() if row_mapping.get("block_id") else None
                measure_field = next((field for field in ("soil_moisture", "harvest_yield", "value") if field in row_mapping), None)
                raw_value = values.get(row_mapping[measure_field]) if measure_field else None
                measurement_type = str(values.get(row_mapping["measurement_type"], "")).strip() if row_mapping.get("measurement_type") else ("soil_moisture" if measure_field == "soil_moisture" else "harvest_yield" if measure_field == "harvest_yield" else "measurement")
                unit = values.get(row_mapping["unit"]) if row_mapping.get("unit") else units.get(measurement_type) or units.get(measure_field)
                normalized_unit, number = normalize_unit(unit, measure_field or "value", raw_value)
                if not timestamp:
                    rejected += 1; errors.append({"worksheet": row["worksheet"], "row": row["row_number"], "message": "Invalid or missing timestamp"}); continue
                if raw_value in (None, "") or (number is None and not str(raw_value).strip()):
                    rejected += 1; errors.append({"worksheet": row["worksheet"], "row": row["row_number"], "message": "Missing or invalid measurement value"}); continue
                if block and not db.execute("SELECT 1 FROM vineyard_blocks WHERE id = ? AND vineyard_id = ?", (block, vineyard_id)).fetchone():
                    errors.append({"worksheet": row["worksheet"], "row": row["row_number"], "message": f"Unknown vineyard block '{block}' requires review"}); rejected += 1; continue
                fp = fingerprint(vineyard_id, block, timestamp, measurement_type, raw_value, normalized_unit)
                try:
                    db.execute("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), vineyard_id, block, timestamp, str(values.get(row_mapping["observation_type"], "measurement")) if row_mapping.get("observation_type") else "measurement", job["source_id"], measurement_type, number, None if number is not None else str(raw_value), normalized_unit, str(raw_value), str(unit) if unit is not None else None, self.database.dumps({k: v for k, v in values.items() if k not in row_mapping.values()}), row["worksheet"], row["row_number"], fp))
                    accepted += 1
                except sqlite3.IntegrityError:
                    skipped += 1
            status = "confirmed" if rejected == 0 else "confirmed_with_errors"
            db.execute("UPDATE import_jobs SET status=?, mapping_json=?, records_accepted=?, records_rejected=?, validation_errors_json=? WHERE id=?", (status, self.database.dumps(mapping), accepted, rejected, self.database.dumps(errors), import_id))
            return {"import_id": import_id, "status": status, "records_processed": len(raw_rows), "records_accepted": accepted, "records_rejected": rejected, "records_skipped": skipped, "validation_errors": errors}

    def _result(self, job):
        return {"import_id": job["id"], "status": job["status"], "records_processed": job["records_processed"], "records_accepted": job["records_accepted"], "records_rejected": job["records_rejected"], "validation_errors": json.loads(job["validation_errors_json"])}

    def observations(self, vineyard_id: str):
        with self.database.connect() as db:
            rows = db.execute("SELECT * FROM observations WHERE vineyard_id = ? ORDER BY timestamp", (vineyard_id,)).fetchall()
            return [dict(row) | {"metadata": json.loads(row["metadata_json"])} for row in rows]

    def data_types(self, vineyard_id: str):
        with self.database.connect() as db:
            return [row[0] for row in db.execute("SELECT DISTINCT measurement_type FROM observations WHERE vineyard_id = ? ORDER BY measurement_type", (vineyard_id,)).fetchall()]


import sqlite3
