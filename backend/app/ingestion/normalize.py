from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from typing import Any

MISSING = {"", "-", "—", "n/a", "na", "null", "none", "unknown"}


def missing(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip().lower() in MISSING)


def parse_timestamp(value: Any) -> str | None:
    if missing(value):
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()
    text = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).isoformat()
    except ValueError:
        for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d-%b-%Y"):
            try:
                return datetime.strptime(text, fmt).isoformat()
            except ValueError:
                pass
    return None


def parse_number(value: Any) -> float | None:
    if missing(value):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip().replace(",", "")
    text = re.sub(r"[$%]", "", text)
    try:
        return float(text)
    except ValueError:
        return None


def normalize_unit(unit: Any, field: str, raw_value: Any) -> tuple[str | None, float | None]:
    number = parse_number(raw_value)
    if missing(unit):
        return ("fraction", number / 100) if field == "soil_moisture" and isinstance(raw_value, str) and "%" in raw_value and number is not None else (None, number)
    normalized = str(unit).strip().lower().replace("%", "percent")
    if field == "soil_moisture" and normalized in {"fraction", "decimal", "v/v"} and number is not None:
        return "fraction", number
    if field == "soil_moisture" and normalized in {"percent", "percentage", "pct"} and number is not None:
        return "fraction", number / 100
    return normalized, number


def fingerprint(vineyard_id: str, block_id: str | None, timestamp: str, measurement_type: str, value: Any, unit: str | None) -> str:
    material = "|".join(str(item or "").strip().lower() for item in (vineyard_id, block_id, timestamp, measurement_type, value, unit))
    return hashlib.sha256(material.encode()).hexdigest()
