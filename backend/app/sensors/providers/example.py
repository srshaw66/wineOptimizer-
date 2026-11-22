"""Built-in example provider backed by data/examples/<site>.example.json.

All values are synthetic and tagged is_example=True / quality="example".
Readings are keyed by the seed segment ids they were generated for.
"""
from __future__ import annotations

from typing import Optional

from ..models import MetricInfo, ProviderInfo, Reading, SegmentSource, Series, SeriesPoint
from ..sites import SiteNotFound, load_example_site
from .base import ProviderError, classify


class ExampleProvider:
    id = "example-local"

    def info(self) -> ProviderInfo:
        return ProviderInfo(id=self.id, name="Built-in example data", kind="example", detail="Synthetic readings in a fixed past sample window. Not live.")

    def _site(self, site_id: str) -> dict:
        try:
            return load_example_site(site_id)
        except SiteNotFound as exc:
            raise ProviderError(str(exc)) from exc

    def list_sources(self, site_id: str) -> list[SegmentSource]:
        return [
            SegmentSource(segment_id=sid, provider=self.id, device_id=d.get("device_id"), description=d.get("description"), is_example=True, metrics=[MetricInfo(**m) for m in d["metrics"]])
            for sid, d in self._site(site_id)["segment_data"].items()
        ]

    def latest(self, site_id: str) -> list[Reading]:
        site = self._site(site_id)
        readings = []
        for sid, d in site["segment_data"].items():
            series = site["series"].get(sid, {})
            for m in d["metrics"]:
                points = series.get(m["metric"], [])
                t, v = points[-1] if points else (None, None)
                raw = Reading(segment_id=sid, metric=m["metric"], value=v, unit=m["unit"], observed_at=t, quality="example", source=self.id, is_example=True)
                readings.append(classify(raw, "example", stale_after_minutes=0))
        return readings

    def history(self, site_id: str, segment_id: str, metric: str, start: Optional[str] = None, end: Optional[str] = None) -> Series:
        site = self._site(site_id)
        data = site["segment_data"].get(segment_id)
        if data is None:
            raise ProviderError(f"Unknown segment {segment_id!r}")
        info = next((m for m in data["metrics"] if m["metric"] == metric), None)
        if info is None:
            raise ProviderError(f"Segment {segment_id!r} has no metric {metric!r}")
        points = site["series"].get(segment_id, {}).get(metric, [])
        # ISO-8601 UTC strings with a trailing Z compare correctly as text.
        points = [p for p in points if (start is None or p[0] >= start) and (end is None or p[0] <= end)]
        return Series(segment_id=segment_id, metric=metric, unit=info["unit"], source=self.id, is_example=True, points=[SeriesPoint(t=t, v=v) for t, v in points])
