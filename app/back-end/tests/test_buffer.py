def test_buffer_basic(client, sample_points):
    resp = client.post(
        "/api/v1/tools/buffer-analysis/execute",
        json={
            "data": sample_points,
            "options": {"bufferDistance": 100, "units": "meters"},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["toolId"] == "buffer-analysis"

    # Outputs
    assert len(data["outputs"]) == 1
    fc = data["outputs"][0]
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 3

    # runMeta.summary.bbox
    bbox = data["runMeta"]["summary"]["bbox"]
    assert bbox is not None
    assert len(bbox) == 4
    assert bbox[0] < bbox[2]  # minX < maxX
    assert bbox[1] < bbox[3]  # minY < maxY

    # Properties
    props = fc["features"][0]["properties"]
    assert "_buffer_distance" in props
    assert "_buffer_units" in props


def test_buffer_dissolve(client, sample_points):
    resp = client.post(
        "/api/v1/tools/buffer-analysis/execute",
        json={
            "data": sample_points,
            "options": {"bufferDistance": 5000, "units": "meters", "dissolve": True},
        },
    )
    data = resp.get_json()
    assert data["success"] is True
    fc = data["outputs"][0]
    assert len(fc["features"]) == 1
    props = fc["features"][0]["properties"]
    assert props["_dissolved"] is True
    assert props["_original_feature_count"] == 3


def test_buffer_empty_input(client):
    resp = client.post(
        "/api/v1/tools/buffer-analysis/execute",
        json={"data": {"type": "FeatureCollection", "features": []}},
    )
    assert resp.status_code == 400
    data = resp.get_json()
    assert data["success"] is False


def test_buffer_kilometers(client, sample_points):
    resp = client.post(
        "/api/v1/tools/buffer-analysis/execute",
        json={
            "data": sample_points,
            "options": {"bufferDistance": 1, "units": "kilometers"},
        },
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
