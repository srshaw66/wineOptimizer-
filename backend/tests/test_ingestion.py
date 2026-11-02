import io
from pathlib import Path

import openpyxl

from app.ingestion.database import Database
from app.ingestion.service import ImportService


def service(tmp_path: Path) -> ImportService:
    return ImportService(Database(tmp_path / "test.sqlite3"))


def add_block(importer: ImportService, vineyard_id: str, block_id: str = "A"):
    with importer.database.connect() as db:
        db.execute("INSERT INTO vineyards (id, name) VALUES (?, ?)", (vineyard_id, vineyard_id))
        db.execute("INSERT INTO vineyard_blocks (id, vineyard_id, name) VALUES (?, ?, ?)", (block_id, vineyard_id, block_id))


def test_csv_preview_confirm_and_duplicate_protection(tmp_path):
    importer = service(tmp_path)
    csv = b"Vineyard Block,Sample Date,VWC,Notes\nA,2026-10-09,22%,dry row\nA,not-a-date,18%,bad date\n"
    preview = importer.preview("records.csv", csv)
    assert preview["estimated_importable_records"] == 2
    assert preview["suggested_mappings"]["block_id"]["source_column"] == "Vineyard Block"
    assert preview["suggested_mappings"]["soil_moisture"]["source_column"] == "VWC"
    add_block(importer, "vineyard-1")
    result = importer.confirm(preview["import_id"], "vineyard-1", {"block_id": "Vineyard Block", "timestamp": "Sample Date", "soil_moisture": "VWC"})
    assert result["records_accepted"] == 1
    assert result["records_rejected"] == 1
    # Re-confirming the same job is idempotent.
    assert importer.confirm(preview["import_id"], "vineyard-1", {})["records_accepted"] == 1
    observations = importer.observations("vineyard-1")
    assert len(observations) == 1
    assert observations[0]["numeric_value"] == 0.22
    assert observations[0]["unit"] == "fraction"


def test_excel_multiple_worksheets_and_provenance(tmp_path):
    workbook = openpyxl.Workbook()
    first = workbook.active
    first.title = "Soil"
    first.append(["Vineyard Block", "Reading Time", "Soil Moisture", "Unit", "Comment"])
    first.append(["A", "2026-10-09", 0.22, "fraction", "sensor 1"])
    second = workbook.create_sheet("Harvest")
    second.append(["Block ID", "Date", "Tonnage"])
    second.append(["A", "2026-10-10", 3.5])
    payload = io.BytesIO()
    workbook.save(payload)
    importer = service(tmp_path)
    preview = importer.preview("season.xlsx", payload.getvalue())
    assert {sheet["name"] for sheet in preview["worksheets"]} == {"Soil", "Harvest"}
    assert preview["suggested_mappings"]["harvest_yield"]["source_column"] == "Tonnage"
    add_block(importer, "vineyard-2")
    result = importer.confirm(preview["import_id"], "vineyard-2", {"block_id": "Block ID", "timestamp": "Date", "harvest_yield": "Tonnage"})
    assert result["records_accepted"] == 2
    observations = importer.observations("vineyard-2")
    assert {observation["source_worksheet"] for observation in observations} == {"Soil", "Harvest"}
    harvest = next(observation for observation in observations if observation["source_worksheet"] == "Harvest")
    assert harvest["source_row"] == 2


def test_unknown_block_is_rejected_for_review(tmp_path):
    importer = service(tmp_path)
    preview = importer.preview("records.csv", b"Block,Date,Value\nUNKNOWN,2026-01-01,5\n")
    result = importer.confirm(preview["import_id"], "vineyard-3", {"block_id": "Block", "timestamp": "Date", "value": "Value"})
    assert result["records_accepted"] == 0
    assert "Unknown vineyard block" in result["validation_errors"][0]["message"]
