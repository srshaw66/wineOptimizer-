from typing import Any

from .base import ensure_filename_extension
from .csv_adapter import _unique_headers
from .models import ExtractedRow, ExtractedTable, ExtractionResult


class ExcelAdapter:
    source_type = "xlsx"
    extensions = (".xlsx",)

    def extract(self, payload: bytes, filename: str) -> ExtractionResult:
        ensure_filename_extension(filename, self.extensions)
        try:
            from openpyxl import load_workbook
            from openpyxl.utils import get_column_letter
        except ImportError as exc:
            raise RuntimeError("Excel imports require openpyxl") from exc
        try:
            # data_only=False deliberately avoids treating formulas as executable values.
            workbook = load_workbook(io.BytesIO(payload), read_only=True, data_only=False)
        except Exception as exc:
            raise ValueError(f"Could not read Excel workbook: {exc}") from exc
        tables: list[ExtractedTable] = []
        warnings: list[str] = []
        try:
            for sheet in workbook.worksheets:
                values = list(sheet.iter_rows(values_only=False))
                candidates = [(i, row) for i, row in enumerate(values) if any(cell.value not in (None, "") for cell in row)]
                if not candidates:
                    continue
                header_index, header_cells = _find_header(candidates)
                headers = _unique_headers(_header_values(header_cells, get_column_letter))
                if len([h for h in headers if not h.startswith("Unnamed")]) < 2:
                    warnings.append(f"Worksheet '{sheet.title}' has no clear table header")
                    continue
                rows: list[ExtractedRow] = []
                for row_number, row in enumerate(values[header_index + 1 :], header_index + 2):
                    raw = [cell.value for cell in row[: len(headers)]]
                    if not any(value not in (None, "") for value in raw):
                        continue
                    row_warnings = []
                    clean: dict[str, Any] = {}
                    for i, value in enumerate(raw):
                        if isinstance(value, str) and value.startswith("="):
                            row_warnings.append(f"Formula at {get_column_letter(i + 1)}{row_number} has no evaluated result in safe import mode")
                            value = None
                        clean[headers[i]] = value
                    if row_warnings:
                        warnings.extend(f"{sheet.title}: {message}" for message in row_warnings)
                    rows.append(ExtractedRow(sheet.title, row_number, clean))
                tables.append(ExtractedTable(sheet.title, headers, rows, header_index + 1))
        finally:
            workbook.close()
        if not tables:
            raise ValueError("No supported table with a detectable header was found in the workbook")
        return ExtractionResult(tables, warnings)


def _find_header(candidates):
    # Prefer a row with at least two populated cells; this handles title rows and notes.
    return max(candidates[:20], key=lambda item: sum(cell.value not in (None, "") for cell in item[1]))


def _header_values(cells, get_column_letter):
    result = []
    previous = None
    for i, cell in enumerate(cells, 1):
        value = cell.value
        if value in (None, "") and previous is not None:
            value = previous
        if value in (None, ""):
            value = get_column_letter(i)
        result.append(str(value).strip())
        if cell.value not in (None, ""):
            previous = str(cell.value).strip()
    return result


import io
