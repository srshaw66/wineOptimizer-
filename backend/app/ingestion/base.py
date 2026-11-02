from pathlib import Path
from typing import Protocol

from .models import ExtractionResult


class SourceAdapter(Protocol):
    source_type: str
    extensions: tuple[str, ...]

    def extract(self, payload: bytes, filename: str) -> ExtractionResult: ...


class UnsupportedSourceError(ValueError):
    pass


def ensure_filename_extension(filename: str, extensions: tuple[str, ...]) -> None:
    if Path(filename).suffix.lower() not in extensions:
        raise UnsupportedSourceError(
            f"Unsupported file type. Expected one of: {', '.join(extensions)}"
        )
