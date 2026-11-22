import csv
import io
from typing import Any

from .base import ensure_filename_extension
from .models import ExtractedRow, ExtractedTable, ExtractionResult


class CSVAdapter:
    source_type = "csv"
    extensions = (".csv",)

    def extract(self, payload: bytes, filename: str) -> ExtractionResult:
        ensure_filename_extension(filename, self.extensions)
        try:
            text = payload.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("CSV must be UTF-8 encoded") from exc
        sample = text[:8192]
        try:
            dialect = csv.Sniffer().sniff(sample)
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(io.StringIO(text), dialect)
        all_rows = list(reader)
        if not all_rows:
            raise ValueError("The CSV file is empty")
        header_index = next((i for i, row in enumerate(all_rows) if any(c.strip() for c in row)), None)
        if header_index is None:
            raise ValueError("The CSV file contains no data")
        headers = _unique_headers(all_rows[header_index])
        rows = []
        for number, raw in enumerate(all_rows[header_index + 1 :], header_index + 2):
            if not any(str(value).strip() for value in raw):
                continue
            values = {header: (raw[i].strip() if i < len(raw) else None) for i, header in enumerate(headers)}
            rows.append(ExtractedRow("CSV", number, values))
        return ExtractionResult([ExtractedTable("CSV", headers, rows, header_index + 1)])


def _unique_headers(raw_headers: list[Any]) -> list[str]:
    result: list[str] = []
    seen: dict[str, int] = {}
    for index, raw in enumerate(raw_headers, 1):
        base = str(raw or "").strip() or f"Unnamed column {index}"
        seen[base] = seen.get(base, 0) + 1
        result.append(base if seen[base] == 1 else f"{base} ({seen[base]})")
    return result
