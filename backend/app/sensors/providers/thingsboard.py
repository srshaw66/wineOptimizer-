"""ThingsBoard provider — NOT IMPLEMENTED. Documents the boundary only.

Nothing here contacts a ThingsBoard server. Before implementing, verify (see
docs/sensor-integration.md):
  * which ThingsBoard instance / tenant owns SSU devices, and written permission to use it;
  * the documented REST API version (e.g. /api/auth/login, /api/plugins/telemetry/...)
    for that instance, rather than inferring it from a public dashboard URL;
  * device ids, telemetry keys, units, timestamps (ms since epoch, UTC) and sampling interval;
  * which devices are physically at SSU (never reuse Iron Horse devices as SSU data).

Configuration is read from backend environment only:
  THINGSBOARD_BASE_URL, THINGSBOARD_USERNAME / THINGSBOARD_PASSWORD or THINGSBOARD_API_KEY,
  THINGSBOARD_DEVICE_MAP (path to a JSON file mapping row-segment ids -> device ids/keys/units).

Device ids can also be recorded per segment in the app (segment sources, Edit map mode).
"""
from __future__ import annotations

import os
from typing import Optional

from ..models import ProviderInfo, Reading, SegmentSource, Series
from .base import ProviderError


class ThingsBoardProvider:
    id = "thingsboard"

    def __init__(self) -> None:
        self.base_url = os.getenv("THINGSBOARD_BASE_URL")

    def info(self) -> ProviderInfo:
        return ProviderInfo(id=self.id, name="ThingsBoard", kind="live", configured=False, detail="Adapter boundary only; no live connection is implemented.")

    def _unavailable(self):
        raise ProviderError("ThingsBoard provider is not implemented yet. See docs/sensor-integration.md.")

    def list_sources(self, site_id: str) -> list[SegmentSource]:
        self._unavailable()

    def latest(self, site_id: str) -> list[Reading]:
        self._unavailable()

    def history(self, site_id: str, segment_id: str, metric: str, start: Optional[str] = None, end: Optional[str] = None) -> Series:
        self._unavailable()
