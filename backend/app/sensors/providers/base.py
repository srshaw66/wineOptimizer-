"""Sensor provider boundary.

A provider turns one data source (built-in example file, ThingsBoard, a
vendor API, imported CSV history...) into normalized per-segment readings.
Credentials stay on the backend: providers read them from environment
variables, never from request parameters, and they are never sent to the browser.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Protocol

from ..models import DataStatus, ProviderInfo, Reading, SegmentSource, Series


class ProviderError(RuntimeError):
    """Raised when a provider cannot answer (not configured, unreachable, bad payload)."""


class SensorProvider(Protocol):
    def info(self) -> ProviderInfo: ...

    def list_sources(self, site_id: str) -> list[SegmentSource]: ...

    def latest(self, site_id: str) -> list[Reading]: ...

    def history(self, site_id: str, segment_id: str, metric: str, start: Optional[str] = None, end: Optional[str] = None) -> Series: ...


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def classify(reading: Reading, kind: str, stale_after_minutes: int, now: Optional[datetime] = None) -> Reading:
    """Apply freshness rules so stale or missing values never look trustworthy."""
    if reading.value is None or reading.observed_at is None:
        return reading.model_copy(update={"quality": "missing"})
    if kind == "example":
        return reading.model_copy(update={"quality": "example", "is_example": True})
    if reading.quality == "suspect":
        return reading
    age = ((now or datetime.now(timezone.utc)) - parse_ts(reading.observed_at)).total_seconds() / 60
    return reading.model_copy(update={"quality": "stale" if age > stale_after_minutes else "ok"})


def data_status(readings: list[Reading], kind: str) -> DataStatus:
    present = [r for r in readings if r.quality != "missing"]
    if not present:
        return "no_data"
    if kind == "example":
        return "example"
    return "stale" if any(r.quality == "stale" for r in present) else "ok"
