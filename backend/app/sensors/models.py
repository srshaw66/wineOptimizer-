"""Normalized, provider-independent sensor shapes.

Readings belong to a *row segment* (the data-bearing map entity). Provider adapters
(example, ThingsBoard, CSV import, ...) translate their own payloads into these
models so map and UI code never depends on a vendor format. Physical device ids
are metadata on the segment's sources, not separate map entities.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

ProviderKind = Literal["example", "live", "import"]
# example  - illustrative/synthetic value, never "live"
# ok       - value from a live provider, within its freshness window
# stale    - value from a live provider, older than the freshness window
# missing  - no value available for the requested window
# suspect  - provider flagged the value (range check failed, etc.)
ReadingQuality = Literal["example", "ok", "stale", "missing", "suspect"]
DataStatus = Literal["example", "ok", "stale", "no_data", "error"]


class ProviderInfo(BaseModel):
    id: str
    name: str
    kind: ProviderKind
    configured: bool = True
    detail: Optional[str] = None


class MetricInfo(BaseModel):
    metric: str
    label: str
    unit: str


class SegmentSource(BaseModel):
    """What a provider knows about one segment's data source."""
    segment_id: str
    provider: str
    device_id: Optional[str] = None     # physical device, if any
    external_id: Optional[str] = None   # id in the source system, e.g. a ThingsBoard device id
    description: Optional[str] = None
    is_example: bool
    metrics: list[MetricInfo]


class Reading(BaseModel):
    segment_id: str          # segment the value was recorded for (its origin)
    metric: str
    value: Optional[float]
    unit: str
    observed_at: Optional[str]  # ISO-8601 UTC
    quality: ReadingQuality
    source: str  # provider id
    device_id: Optional[str] = None
    is_example: bool


class SeriesPoint(BaseModel):
    t: str
    v: Optional[float]


class Series(BaseModel):
    segment_id: str
    metric: str
    unit: str
    source: str
    is_example: bool
    points: list[SeriesPoint]
