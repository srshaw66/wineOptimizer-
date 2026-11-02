from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

CANONICAL_FIELDS = (
    "vineyard_name", "block_id", "timestamp", "observation_type",
    "measurement_type", "value", "unit", "soil_moisture", "harvest_yield",
)

ALIASES = {
    "vineyard_name": {"vineyard", "vineyard name", "site", "farm"},
    "block_id": {"block", "section", "block id", "vineyard block", "block name"},
    "timestamp": {"date", "sample date", "reading time", "timestamp", "time", "observation date"},
    "observation_type": {"observation", "observation type", "record type", "event"},
    "measurement_type": {"measurement", "measurement type", "metric", "variable", "parameter"},
    "value": {"value", "reading", "measurement value", "result", "amount"},
    "unit": {"unit", "units", "measurement unit"},
    "soil_moisture": {"vwc", "soil moisture", "moisture", "moisture %", "soil moisture %", "volumetric water content"},
    "harvest_yield": {"yield", "harvest tons", "tonnage", "harvest yield", "yield tons"},
}


def normalize_column_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def suggest_mappings(headers: list[str]) -> dict[str, dict[str, Any]]:
    normalized = {header: normalize_column_name(header) for header in headers}
    result: dict[str, dict[str, Any]] = {}
    for field in CANONICAL_FIELDS:
        exact = [header for header, name in normalized.items() if name == field.replace("_", " ")]
        aliases = [header for header, name in normalized.items() if name in ALIASES.get(field, set())]
        candidates = exact or aliases
        if len(candidates) == 1:
            result[field] = {"source_column": candidates[0], "status": "exact" if exact else "alias", "confidence": 1.0 if exact else 0.9}
        elif len(candidates) > 1:
            result[field] = {"source_column": None, "status": "ambiguous", "confidence": 0.0, "candidates": candidates}
    mapped = {item["source_column"] for item in result.values() if item.get("source_column")}
    result["unmapped"] = {"columns": [header for header in headers if header not in mapped]}
    return result


def mapping_for_rows(headers: list[str], requested: dict[str, str] | None) -> dict[str, str]:
    suggestions = suggest_mappings(headers)
    mapping = {field: item["source_column"] for field, item in suggestions.items() if field != "unmapped" and item.get("source_column")}
    if requested:
        for field, column in requested.items():
            if field not in CANONICAL_FIELDS:
                raise ValueError(f"Unknown mapping field: {field}")
            if column not in headers:
                raise ValueError(f"Mapped source column '{column}' does not exist")
            mapping[field] = column
    return mapping


def headers_from_tables(tables) -> list[str]:
    return list(dict.fromkeys(header for table in tables for header in table.headers))
