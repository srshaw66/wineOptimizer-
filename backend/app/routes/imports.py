import json
import io
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.ingestion.database import Database
from app.ingestion.service import ImportService

router = APIRouter(prefix="/api")
service = ImportService(Database(os.getenv("VINEYARD_DB_PATH", "data/vineyard.sqlite3")))
with service.database.connect() as _db:
    _db.execute("INSERT OR IGNORE INTO vineyards (id, name, metadata_json) VALUES (?, ?, ?)", ("sonoma-demo", "Sonoma Vineyard", service.database.dumps({"location": "Sonoma County"})))


@router.post("/imports/preview")
async def preview_import(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "A filename is required")
    try:
        return service.preview(file.filename, await file.read())
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc


class ConfirmImport(BaseModel):
    import_id: str
    vineyard_id: str = Field(min_length=1, max_length=200)
    mappings: dict[str, str] = Field(default_factory=dict)
    units: dict[str, str] = Field(default_factory=dict)


class CreateVineyard(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    location: str = Field(default="", max_length=300)


class UpdateVineyard(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    location: str = Field(default="", max_length=300)


class BlockLayout(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rows: int = Field(default=1, ge=1, le=100)
    plants_per_row: int = Field(default=0, ge=0, le=500)
    bounds: Optional[dict[str, float]] = None
    rows_layout: list[dict[str, Any]] = Field(default_factory=list)


class LayoutRequest(BaseModel):
    blocks: list[BlockLayout] = Field(default_factory=list)
    image_settings: dict[str, Any] = Field(default_factory=dict)


def layout_for(vineyard_id: str) -> dict:
    with service.database.connect() as db:
        row = db.execute("SELECT metadata_json FROM vineyards WHERE id = ?", (vineyard_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Vineyard not found")
    metadata = json.loads(row["metadata_json"])
    return {"blocks": metadata.get("layout", {}).get("blocks", []), "image_settings": metadata.get("layout", {}).get("image_settings", {}), "image_url": metadata.get("map_image")}


def layout_features(vineyard_id: str) -> list[dict]:
    if vineyard_id == "sonoma-demo":
        return None
    layout = layout_for(vineyard_id)
    blocks = layout["blocks"]
    settings = layout["image_settings"]
    if not blocks:
        return []
    result = [{"id": "vineyard", "kind": "vineyard", "name": vineyard_id, "parentId": None, "center": [350, 500], "bounds": [[55, 60], [665, 940]]}]
    columns = max(1, min(3, int(settings.get("columns", 2))))
    padding = max(20, min(140, int(settings.get("padding", 80))))
    column_gap = max(10, min(180, int(settings.get("columnGap", 110))))
    row_gap = max(10, min(180, int(settings.get("rowGap", 80))))
    usable_width = 1000 - (padding * 2) - column_gap * (columns - 1)
    block_width = usable_width / columns
    block_height = 250
    for index, block in enumerate(blocks):
        column = index % columns
        row_group = index // columns
        left = padding + column * (block_width + column_gap)
        right = left + block_width
        bottom, top = padding - 5 + row_group * (block_height + row_gap), padding - 5 + row_group * (block_height + row_gap) + block_height
        custom_bounds = block.get("bounds")
        if custom_bounds:
            left = float(custom_bounds.get("x", left))
            # The editor stores image coordinates from the top-left; Leaflet's
            # simple CRS renders its vertical axis from the bottom-left.
            editor_y = float(custom_bounds.get("y", 700 - top))
            bottom = 700 - editor_y - float(custom_bounds.get("height", block_height))
            right = left + float(custom_bounds.get("width", block_width))
            top = bottom + float(custom_bounds.get("height", block_height))
        block_id = f"block:{index + 1}"
        result.append({"id": block_id, "kind": "block", "name": block["name"], "parentId": "vineyard", "blockId": str(index + 1), "center": [(bottom + top) / 2, (left + right) / 2], "bounds": [[bottom, left], [top, right]]})
        rows = int(block["rows"])
        plants = int(block["plants_per_row"])
        saved_rows = block.get("rows_layout") or []
        for row_number in range(rows):
            saved_row = saved_rows[row_number] if row_number < len(saved_rows) else None
            y = top - 35 - row_number * ((top - bottom - 70) / max(rows - 1, 1))
            x1, x2 = left + 30, right - 30
            if saved_row:
                x1 = float(saved_row.get("x1", x1))
                editor_row_y = float(saved_row.get("y1", 700 - y))
                y = 700 - editor_row_y
                x2 = float(saved_row.get("x2", x2))
            row_id = f"row:{index + 1}:{row_number + 1}"
            result.append({"id": row_id, "kind": "row", "name": f"Row {row_number + 1}", "parentId": block_id, "blockId": str(index + 1), "rowId": row_id, "center": [y, (x1 + x2) / 2], "line": [[y, x1], [y, x2]]})
            saved_plants = saved_row.get("plants", []) if saved_row else []
            for plant_number in range(plants):
                saved_plant = saved_plants[plant_number] if plant_number < len(saved_plants) else None
                x = float(saved_plant.get("x", x1 + plant_number * ((x2 - x1) / max(plants - 1, 1)))) if saved_plant else x1 + plant_number * ((x2 - x1) / max(plants - 1, 1))
                plant_y = 700 - float(saved_plant.get("y", 700 - y)) if saved_plant else y
                result.append({"id": f"plant:{index + 1}:{row_number + 1}:{plant_number + 1}", "kind": "plant", "name": f"Plant {plant_number + 1}", "parentId": row_id, "blockId": str(index + 1), "rowId": row_id, "plantNo": plant_number + 1, "center": [plant_y, x], "status": "normal"})
    return result


@router.get("/vineyards/{vineyard_id}/layout.geojson")
def layout_geojson(vineyard_id: str):
    """Expose the saved overlay as standard GeoJSON geometry.

    Blocks are polygons, rows are lines, and plants are points. The coordinate
    space is the uploaded map's normalized 1000 x 700 canvas, which keeps the
    image overlay and editable vineyard geometry aligned and persistent.
    """
    features = layout_features(vineyard_id) or []
    geo_features = []
    for feature in features:
        kind = feature["kind"]
        y, x = feature["center"]
        if kind == "block":
            (bottom, left), (top, right) = feature["bounds"]
            geometry = {"type": "Polygon", "coordinates": [[[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]]]}
        elif kind == "row":
            line = feature.get("line", [[y, x - 1], [y, x + 1]])
            geometry = {"type": "LineString", "coordinates": [[point[1], point[0]] for point in line]}
        elif kind == "plant":
            geometry = {"type": "Point", "coordinates": [x, y]}
        else:
            continue
        geo_features.append({"type": "Feature", "properties": {key: value for key, value in feature.items() if key not in {"center", "bounds"}}, "geometry": geometry})
    return {"type": "FeatureCollection", "features": geo_features, "crs": {"type": "name", "properties": {"name": "LOCAL-MAP-1000x700"}}}


@router.get("/vineyards")
def list_vineyards():
    with service.database.connect() as db:
        rows = db.execute("SELECT id, name, metadata_json FROM vineyards ORDER BY name").fetchall()
    return [{"id": row["id"], "name": row["name"], "location": __import__("json").loads(row["metadata_json"]).get("location", "")} for row in rows]


@router.post("/vineyards")
def create_vineyard(request: CreateVineyard):
    import re
    vineyard_id = re.sub(r"[^a-z0-9]+", "-", request.name.lower()).strip("-") or "vineyard"
    with service.database.connect() as db:
        base, suffix = vineyard_id, 2
        while db.execute("SELECT 1 FROM vineyards WHERE id = ?", (vineyard_id,)).fetchone():
            vineyard_id, suffix = f"{base}-{suffix}", suffix + 1
        db.execute("INSERT INTO vineyards (id, name, metadata_json) VALUES (?, ?, ?)", (vineyard_id, request.name.strip(), service.database.dumps({"location": request.location.strip()})))
    return {"id": vineyard_id, "name": request.name.strip(), "location": request.location.strip()}


@router.delete("/vineyards/{vineyard_id}")
def delete_vineyard(vineyard_id: str):
    if vineyard_id == "sonoma-demo":
        raise HTTPException(403, "The Sonoma demo vineyard cannot be deleted")
    with service.database.connect() as db:
        row = db.execute("SELECT 1 FROM vineyards WHERE id = ?", (vineyard_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Vineyard not found")
        db.execute("DELETE FROM observations WHERE vineyard_id = ?", (vineyard_id,))
        db.execute("DELETE FROM vineyard_blocks WHERE vineyard_id = ?", (vineyard_id,))
        db.execute("DELETE FROM vineyards WHERE id = ?", (vineyard_id,))
    target = Path(service.database.path).parent / "maps" / f"{vineyard_id}.map"
    if target.exists():
        target.unlink()
    return {"deleted": vineyard_id}


@router.patch("/vineyards/{vineyard_id}")
def update_vineyard(vineyard_id: str, request: UpdateVineyard):
    with service.database.connect() as db:
        row = db.execute("SELECT metadata_json FROM vineyards WHERE id = ?", (vineyard_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Vineyard not found")
        metadata = json.loads(row["metadata_json"])
        metadata["location"] = request.location.strip()
        db.execute("UPDATE vineyards SET name = ?, metadata_json = ? WHERE id = ?", (request.name.strip(), service.database.dumps(metadata), vineyard_id))
    return {"id": vineyard_id, "name": request.name.strip(), "location": request.location.strip()}


@router.get("/vineyards/{vineyard_id}/layout")
def get_layout(vineyard_id: str):
    return layout_for(vineyard_id)


@router.post("/vineyards/{vineyard_id}/layout")
def save_layout(vineyard_id: str, request: LayoutRequest):
    with service.database.connect() as db:
        row = db.execute("SELECT metadata_json FROM vineyards WHERE id = ?", (vineyard_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Vineyard not found")
        metadata = json.loads(row["metadata_json"])
        metadata["layout"] = request.model_dump()
        db.execute("UPDATE vineyards SET metadata_json = ? WHERE id = ?", (service.database.dumps(metadata), vineyard_id))
    return layout_for(vineyard_id)


@router.post("/vineyards/{vineyard_id}/map-image")
async def upload_map_image(vineyard_id: str, file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Upload an image file")
    payload = await file.read()
    if len(payload) > 20 * 1024 * 1024:
        raise HTTPException(400, "Map image exceeds the 20 MB limit")
    content_type = file.content_type
    if content_type in {"image/tiff", "image/x-tiff"}:
        try:
            from PIL import Image
            image = Image.open(io.BytesIO(payload))
            image.thumbnail((10000, 10000))
            converted = io.BytesIO()
            image.convert("RGBA").save(converted, format="PNG", optimize=True)
            payload, content_type = converted.getvalue(), "image/png"
        except ImportError as exc:
            raise HTTPException(500, "TIFF map conversion requires Pillow") from exc
        except Exception as exc:
            raise HTTPException(400, f"Could not convert TIFF map image: {exc}") from exc
    with service.database.connect() as db:
        row = db.execute("SELECT 1 FROM vineyards WHERE id = ?", (vineyard_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Vineyard not found")
        directory = Path(service.database.path).parent / "maps"
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{vineyard_id}.map"
        target.write_bytes(payload)
        metadata = json.loads(db.execute("SELECT metadata_json FROM vineyards WHERE id = ?", (vineyard_id,)).fetchone()[0])
        metadata["map_image"] = f"/api/vineyards/{vineyard_id}/map-image"
        metadata["map_content_type"] = content_type
        db.execute("UPDATE vineyards SET metadata_json = ? WHERE id = ?", (service.database.dumps(metadata), vineyard_id))
    return {"image_url": f"/api/vineyards/{vineyard_id}/map-image"}


@router.get("/vineyards/{vineyard_id}/map-image")
def get_map_image(vineyard_id: str):
    target = Path(service.database.path).parent / "maps" / f"{vineyard_id}.map"
    if not target.exists():
        raise HTTPException(404, "No map image uploaded")
    with service.database.connect() as db:
        row = db.execute("SELECT metadata_json FROM vineyards WHERE id = ?", (vineyard_id,)).fetchone()
    metadata = json.loads(row[0]) if row else {}
    media_type = metadata.get("map_content_type", "image/png")
    if target.read_bytes()[:4] in {b"MM\x00*", b"II*\x00"}:
        try:
            from PIL import Image
            image = Image.open(target)
            converted = io.BytesIO()
            image.convert("RGBA").save(converted, format="PNG", optimize=True)
            target.write_bytes(converted.getvalue())
            media_type = "image/png"
            metadata["map_content_type"] = media_type
            with service.database.connect() as db:
                db.execute("UPDATE vineyards SET metadata_json = ? WHERE id = ?", (service.database.dumps(metadata), vineyard_id))
        except Exception:
            pass
    return FileResponse(target, media_type=media_type)


@router.post("/imports/confirm")
def confirm_import(request: ConfirmImport):
    try:
        return service.confirm(request.import_id, request.vineyard_id, request.mappings, request.units)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/imports/{import_id}")
def get_import(import_id: str):
    with service.database.connect() as db:
        row = db.execute("SELECT * FROM import_jobs WHERE id = ?", (import_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Import job not found")
    return service._result(row)


@router.get("/vineyards/{vineyard_id}/observations")
def vineyard_observations(vineyard_id: str):
    return {"vineyard_id": vineyard_id, "observations": service.observations(vineyard_id)}


@router.get("/vineyards/{vineyard_id}/data-types")
def vineyard_data_types(vineyard_id: str):
    return {"vineyard_id": vineyard_id, "data_types": service.data_types(vineyard_id)}
