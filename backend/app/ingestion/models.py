from dataclasses import dataclass, field
from typing import Any


@dataclass
class ExtractedRow:
    worksheet: str
    row_number: int
    values: dict[str, Any]


@dataclass
class ExtractedTable:
    worksheet: str
    headers: list[str]
    rows: list[ExtractedRow]
    header_row: int
    warnings: list[str] = field(default_factory=list)


@dataclass
class ExtractionResult:
    tables: list[ExtractedTable]
    warnings: list[str] = field(default_factory=list)

    @property
    def rows(self) -> list[ExtractedRow]:
        return [row for table in self.tables for row in table.rows]
