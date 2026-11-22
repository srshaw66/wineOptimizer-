"""Modular vineyard data ingestion pipeline."""

from .registry import adapter_registry

__all__ = ["adapter_registry"]
