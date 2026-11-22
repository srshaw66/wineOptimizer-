import io
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.sensors.models import Reading
from app.sensors.providers.base import classify
from app.sensors.providers.example import ExampleProvider
from app.sensors.sites import DEFAULT_SITE_ID, site_geometry

SITE = DEFAULT_SITE_ID


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VINEYARD_DB_PATH", str(tmp_path / "test.sqlite3"))
    from app.main import app
    return TestClient(app)


def _layout(client):
    return client.get(f"/api/sites/{SITE}/layout").json()


def _save(client, layout, blocks=None):
    return client.put(f"/api/sites/{SITE}/layout", json={"base_version": layout["version"], "blocks": blocks if blocks is not None else layout["blocks"]})


def test_seed_layout_has_three_rows_with_2_3_4_segments_north_to_south(client):
    layout = _layout(client)["layout"]
    assert layout["version"] == 1
    rows = layout["blocks"][0]["rows"]
    assert [len(r["segments"]) for r in rows] == [2, 3, 4]
    # Row 1 is the northernmost (largest latitude).
    lats = [r["line"][0][1] for r in rows]
    assert lats == sorted(lats, reverse=True)
    for r in rows:
        assert r["segments"][0]["start"] == 0 and r["segments"][-1]["end"] == 1


def test_geometry_is_wgs84_lng_lat_near_ssu(client):
    features = site_geometry(SITE)["features"]
    footprint = next(f for f in features if f["properties"]["kind"] == "planting_area")
    assert footprint["properties"]["accuracy"] == "traced"
    for lng, lat in footprint["geometry"]["coordinates"][0]:
        assert -122.70 < lng < -122.65 and 38.33 < lat < 38.35
    assert sum(f["properties"]["kind"] == "row" for f in features) == 3
    assert sum(f["properties"]["kind"] == "row_segment" for f in features) == 9


def test_segments_are_example_and_one_has_no_data(client):
    payload = client.get(f"/api/sites/{SITE}/segments").json()
    assert payload["provider"]["kind"] == "example"
    segs = {s["segment_id"]: s for s in payload["segments"]}
    assert len(segs) == 9
    for s in segs.values():
        for r in s["latest"]:
            assert r["is_example"] and r["quality"] in {"example", "missing"} and not r["inherited"]
    assert segs["teaching-plot:row-03:s4"]["status"] == "no_data"


def test_history_and_unknown_ids(client):
    h = client.get(f"/api/sites/{SITE}/segments/teaching-plot:row-02:s1/history", params={"metric": "soil_temperature"}).json()
    assert h["series"][0]["unit"] == "°F" and len(h["series"][0]["points"]) == 48 and not h["series"][0]["inherited"]
    assert client.get(f"/api/sites/{SITE}/segments/nope/history", params={"metric": "soil_temperature"}).status_code == 404
    assert client.get("/api/sites/not-a-site").status_code == 404


def test_split_creates_lineage_and_inherited_records_without_copies(client):
    data = _layout(client)
    layout = data["layout"]
    row2 = layout["blocks"][0]["rows"][1]
    parent = row2["segments"][0]["id"]  # covers 0 .. 1/3
    # A note on the parent before the split.
    assert client.post(f"/api/sites/{SITE}/segments/{parent}/notes", json={"text": "Canopy thin at west end"}).status_code == 200
    alert = client.post(f"/api/sites/{SITE}/alerts", json={"entity_kind": "segment", "entity_id": parent, "type_id": "pest", "description": "Leafhoppers seen"}).json()
    # Split row 2 into 4 even segments with new ids.
    row2["segments"] = [{"id": f"new-{i}", "name": f"Segment {i + 1}", "start": i / 4, "end": (i + 1) / 4, "sources": []} for i in range(4)]
    saved = _save(client, layout)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["layout"]["version"] == 2
    lineage = body["lineage"]
    assert lineage[parent]["retired_version"] == 2
    assert lineage["new-0"]["parent_ids"] == [parent]
    assert set(lineage["new-1"]["parent_ids"]) == {parent, "teaching-plot:row-02:s2"}
    # Inherited readings are labelled and point at their origin segment.
    segs = {s["segment_id"]: s for s in client.get(f"/api/sites/{SITE}/segments").json()["segments"]}
    assert segs["new-0"]["inherited_only"] and all(r["inherited"] and r["segment_id"] == parent for r in segs["new-0"]["latest"])
    # Inherited note is the same record, not a copy.
    recs = client.get(f"/api/sites/{SITE}/segments/new-0/records").json()
    assert recs["notes"][0]["segment_id"] == parent and recs["notes"][0]["inherited"]
    # The alert now applies to the segments that cover the parent's span.
    a = next(x for x in client.get(f"/api/sites/{SITE}/alerts").json() if x["id"] == alert["id"])
    assert set(a["applies_to"]) == {"new-0", "new-1"} and not a["entity_exists"]
    # New records can't attach to the retired parent.
    assert client.post(f"/api/sites/{SITE}/segments/{parent}/notes", json={"text": "x"}).status_code == 409


def test_merge_keeps_all_source_ids_and_conflicts_are_rejected(client):
    layout = _layout(client)["layout"]
    row1 = layout["blocks"][0]["rows"][0]
    old = [s["id"] for s in row1["segments"]]
    row1["segments"] = [{"id": "merged", "name": "Segment 1", "start": 0, "end": 1, "sources": []}]
    assert _save(client, layout).status_code == 200
    lineage = _layout(client)["lineage"]
    assert sorted(lineage["merged"]["parent_ids"]) == sorted(old)
    # Stale base version -> 409, nothing written.
    assert _save(client, layout).status_code == 409


def test_boundary_drag_keeps_ids_and_validation(client):
    layout = _layout(client)["layout"]
    segs = layout["blocks"][0]["rows"][0]["segments"]
    segs[0]["end"] = segs[1]["start"] = 0.4
    body = _save(client, layout).json()
    assert [s["id"] for s in body["layout"]["blocks"][0]["rows"][0]["segments"]] == [s["id"] for s in segs]
    assert body["lineage"][segs[0]["id"]]["retired_version"] is None
    bad = _layout(client)["layout"]
    bad["blocks"][0]["rows"][0]["segments"][0]["end"] = 0.3  # gap
    assert _save(client, bad).status_code == 400
    swapped = _layout(client)["layout"]
    swapped["blocks"][0]["outline"] = [[lat, lng] for lng, lat in swapped["blocks"][0]["outline"]]
    assert _save(client, swapped).status_code == 400


def test_add_block_and_row_persist(client):
    layout = _layout(client)["layout"]
    outline = [[-122.67340, 38.34130], [-122.67330, 38.34130], [-122.67330, 38.34125], [-122.67340, 38.34125], [-122.67345, 38.341275]]
    layout["blocks"].append({"id": "block-new", "name": "North bed", "outline": outline, "rows": [
        {"id": "row-new", "name": "Row A", "line": [[-122.67339, 38.341275], [-122.67331, 38.341275]], "segments": [{"id": "seg-new", "name": "Segment 1", "start": 0, "end": 1, "sources": [{"provider": "thingsboard", "device_id": "dev-123"}]}]}]})
    body = _save(client, layout).json()
    blk = body["layout"]["blocks"][1]
    assert blk["accuracy"] == "drawn" and len(blk["outline"]) == 5
    assert blk["rows"][0]["segments"][0]["sources"][0]["device_id"] == "dev-123"
    assert _layout(client)["layout"]["version"] == 2  # persisted


def test_alerts_resolve_keeps_history_and_custom_types(client):
    t = client.post("/api/alert-types", json={"name": "Frost", "color": "#3366cc", "icon": "★", "default_severity": "high"}).json()
    a = client.post(f"/api/sites/{SITE}/alerts", json={"entity_kind": "row", "entity_id": "teaching-plot:row-01", "type_id": t["id"], "description": "Frost pocket"}).json()
    assert a["severity"] == "high" and a["status"] == "active" and a["applies_to"] == ["teaching-plot:row-01"]
    edited = client.patch(f"/api/alerts/{a['id']}", json={"description": "Frost pocket, west end", "clear_severity": True}).json()
    assert edited["severity"] is None and edited["description"].endswith("west end")
    resolved = client.post(f"/api/alerts/{a['id']}/resolve").json()
    assert resolved["status"] == "resolved" and resolved["resolved_at"]
    assert any(x["id"] == a["id"] for x in client.get(f"/api/sites/{SITE}/alerts").json())
    assert client.delete(f"/api/alert-types/{t['id']}").status_code == 409  # used by history
    names = [x["name"] for x in client.get("/api/alert-types").json()["types"]]
    assert {"Disease", "Pest", "Irrigation", "Damage", "Other", "Frost"} <= set(names)
    assert client.post(f"/api/sites/{SITE}/alerts", json={"entity_kind": "block", "entity_id": "nope", "type_id": "other", "description": "x"}).status_code == 404


def test_photo_upload_validates_and_serves(client):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (90, 140, 60)).save(buf, format="PNG")
    seg = "teaching-plot:row-01:s1"
    r = client.post(f"/api/sites/{SITE}/segments/{seg}/photos", files={"file": ("p.png", buf.getvalue(), "image/png")}, data={"taken_at": "2026-11-20", "caption": "Test"})
    assert r.status_code == 200, r.text
    photo = r.json()
    assert photo["taken_at"] == "2026-11-20"
    assert client.get(photo["url"]).status_code == 200
    assert client.post(f"/api/sites/{SITE}/segments/{seg}/photos", files={"file": ("x.png", b"not an image", "image/png")}).status_code == 400
    assert client.get(f"/api/sites/{SITE}/segments/{seg}/records").json()["photos"][0]["id"] == photo["id"]


def test_live_readings_become_stale_and_missing():
    now = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
    base = dict(segment_id="s", metric="m", unit="%", source="live", is_example=False, quality="ok")
    old = Reading(value=1.0, observed_at="2026-11-01T09:00:00Z", **base)
    fresh = Reading(value=1.0, observed_at="2026-11-01T11:55:00Z", **base)
    none = Reading(value=None, observed_at=None, **base)
    assert classify(old, "live", 60, now).quality == "stale"
    assert classify(fresh, "live", 60, now).quality == "ok"
    assert classify(none, "live", 60, now).quality == "missing"


def test_thingsboard_provider_is_not_silently_empty(client, monkeypatch):
    monkeypatch.setenv("VINEYARD_SENSOR_PROVIDER", "thingsboard")
    assert client.get(f"/api/sites/{SITE}/segments").status_code == 502


def test_example_provider_latest_matches_last_point():
    provider = ExampleProvider()
    latest = {(r.segment_id, r.metric): r for r in provider.latest(SITE)}
    series = provider.history(SITE, "teaching-plot:row-02:s1", "soil_moisture_vwc")
    assert latest[("teaching-plot:row-02:s1", "soil_moisture_vwc")].value == series.points[-1].v


def test_seed_block_is_named_block_1_with_original_id(client):
    block = _layout(client)["layout"]["blocks"][0]
    assert block["id"] == "teaching-plot" and block["name"] == "Block 1"


def test_old_teaching_plot_name_is_migrated_once_without_touching_records(client):
    import json
    from app.store.db import connect, dumps
    layout = _layout(client)["layout"]
    seg = layout["blocks"][0]["rows"][0]["segments"][0]["id"]
    assert client.post(f"/api/sites/{SITE}/segments/{seg}/notes", json={"text": "before rename"}).status_code == 200
    # Simulate a database saved by the previous release.
    old = {**layout, "version": 2, "blocks": [{**layout["blocks"][0], "name": "Teaching plot"}]}
    with connect() as conn:
        conn.execute("INSERT INTO site_layouts (site_id, version, saved_at, layout_json) VALUES (?, 2, ?, ?)", (SITE, old["saved_at"], dumps(old)))
    first = _layout(client)
    assert first["layout"]["version"] == 3 and first["layout"]["blocks"][0]["name"] == "Block 1"
    assert first["layout"]["blocks"][0]["rows"] == layout["blocks"][0]["rows"]  # geometry, segments, ids unchanged
    assert _layout(client)["layout"]["version"] == 3  # not re-applied
    assert first["lineage"][seg]["retired_version"] is None
    assert client.get(f"/api/sites/{SITE}/segments/{seg}/records").json()["notes"][0]["text"] == "before rename"
    names = [b["name"] for b in first["layout"]["blocks"]]
    assert names.count("Block 1") == 1


def test_notes_and_photos_are_editable_but_readings_are_not(client):
    seg = "teaching-plot:row-02:s2"
    note = client.post(f"/api/sites/{SITE}/segments/{seg}/notes", json={"text": "VWC reading looks high", "kind": "correction", "refers_to": "soil_moisture_vwc @ 2026-10-16T06:00Z"}).json()
    assert note["kind"] == "correction" and note["refers_to"].startswith("soil_moisture_vwc")
    edited = client.patch(f"/api/notes/{note['id']}", json={"text": "VWC reading looks ~3 points high"}).json()
    assert edited["text"].endswith("high") and edited["edited_at"] and edited["kind"] == "correction"
    before = client.get(f"/api/sites/{SITE}/segments").json()
    # There is no write endpoint for readings.
    assert client.patch(f"/api/sites/{SITE}/segments/{seg}/history", json={}).status_code == 405
    assert client.get(f"/api/sites/{SITE}/segments").json() == before
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, format="PNG")
    photo = client.post(f"/api/sites/{SITE}/segments/{seg}/photos", files={"file": ("p.png", buf.getvalue(), "image/png")}).json()
    patched = client.patch(f"/api/photos/{photo['id']}", json={"caption": "North side", "taken_at": "2026-11-01"}).json()
    assert patched["caption"] == "North side" and patched["taken_at"] == "2026-11-01" and patched["filename"] == photo["filename"]


def test_segment_description_is_saved_in_layout(client):
    layout = _layout(client)["layout"]
    layout["blocks"][0]["rows"][0]["segments"][0]["description"] = "Vigorous canopy"
    saved = _save(client, layout).json()["layout"]
    assert saved["blocks"][0]["rows"][0]["segments"][0]["description"] == "Vigorous canopy"
