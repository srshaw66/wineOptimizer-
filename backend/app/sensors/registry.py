"""Select the sensor provider from backend configuration (VINEYARD_SENSOR_PROVIDER)."""
from __future__ import annotations

import os

from .providers.base import SensorProvider
from .providers.example import ExampleProvider
from .providers.thingsboard import ThingsBoardProvider

PROVIDERS = {"example": ExampleProvider, "thingsboard": ThingsBoardProvider}


def get_provider() -> SensorProvider:
    name = os.getenv("VINEYARD_SENSOR_PROVIDER", "example").strip().lower()
    factory = PROVIDERS.get(name)
    if factory is None:
        raise ValueError(f"Unknown VINEYARD_SENSOR_PROVIDER {name!r}; expected one of {sorted(PROVIDERS)}")
    return factory()
