from pathlib import Path

from .base import SourceAdapter, UnsupportedSourceError
from .csv_adapter import CSVAdapter
from .excel_adapter import ExcelAdapter


class AdapterRegistry:
    def __init__(self, adapters: list[SourceAdapter]):
        self._by_extension = {extension: adapter for adapter in adapters for extension in adapter.extensions}

    def for_filename(self, filename: str) -> SourceAdapter:
        try:
            return self._by_extension[Path(filename).suffix.lower()]
        except KeyError as exc:
            raise UnsupportedSourceError("Unsupported file type. Upload a .csv or .xlsx file.") from exc


adapter_registry = AdapterRegistry([CSVAdapter(), ExcelAdapter()])
