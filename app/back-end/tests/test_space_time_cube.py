from app.constants import PROCESSED_HEIGHT_FIELD


def test_space_time_cube_basic(client, sample_points):
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "timestamp"},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["toolId"] == "space-time-cube"

    # Should return a single FeatureCollection
    assert len(data["outputs"]) == 1

    fc = data["outputs"][0]
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) > 0

    bbox = data["runMeta"]["summary"]["bbox"]
    assert bbox is not None
    assert len(bbox) == 4

    # Check key properties on the first feature
    props = fc["features"][0]["properties"]
    assert "count" in props
    # env_value replaced the old pm25 mock — it is None when no env field is bound
    assert "env_value" in props
    assert "z" in props
    assert "z_axis" in props
    assert "time_slice_index" in props
    assert "time_value" in props
    assert PROCESSED_HEIGHT_FIELD in props


def test_space_time_cube_missing_time_attr(client, sample_points):
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "nonexistent"},
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_space_time_cube_rejects_polygons(client, sample_polygons):
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": sample_polygons,
            "attributes": {"time": "timestamp"},
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_space_time_cube_custom_options(client, sample_points):
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "timestamp"},
            "options": {"cellSize": 0.005, "timeSlices": 5},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert len(data["outputs"]) == 1


def test_space_time_cube_larger_dataset(client):
    """Test with more points to ensure grid computation works."""
    import random

    random.seed(42)
    features = []
    for i in range(20):
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        -122.4 + random.uniform(-0.05, 0.05),
                        37.78 + random.uniform(-0.05, 0.05),
                    ],
                },
                "properties": {"timestamp": f"2025-01-15T{10 + i // 6}:{(i * 5) % 60:02d}:00Z"},
            }
        )
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": {"type": "FeatureCollection", "features": features},
            "attributes": {"time": "timestamp"},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert len(data["outputs"]) == 1
