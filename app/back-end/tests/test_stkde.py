from app.constants import PROCESSED_HEIGHT_FIELD


def test_stkde_basic(client, sample_points):
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "timestamp"},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["toolId"] == "stkde"

    # Should return 3 FeatureCollections (high, medium, low)
    assert len(data["outputs"]) == 3

    bbox = data["runMeta"]["summary"]["bbox"]
    assert bbox is not None
    assert len(bbox) == 4

    # At least one output should have features
    total_features = sum(len(fc["features"]) for fc in data["outputs"])
    assert total_features > 0

    # Check properties on a non-empty output
    for fc in data["outputs"]:
        if fc["features"]:
            props = fc["features"][0]["properties"]
            assert "classification" in props
            assert "z" in props
            assert PROCESSED_HEIGHT_FIELD in props
            assert "_dataset_type" in props
            assert "_confidence" in props
            break


def test_stkde_missing_time_attr(client, sample_points):
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "nonexistent"},
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_stkde_rejects_polygons(client, sample_polygons):
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": sample_polygons,
            "attributes": {"time": "timestamp"},
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_stkde_larger_dataset(client):
    """Test with more points to ensure grid computation works."""
    import random
    random.seed(42)
    features = []
    for i in range(20):
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [
                    -122.4 + random.uniform(-0.05, 0.05),
                    37.78 + random.uniform(-0.05, 0.05),
                ],
            },
            "properties": {"timestamp": f"2025-01-15T{10 + i // 6}:{(i * 5) % 60:02d}:00Z"},
        })
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": {"type": "FeatureCollection", "features": features},
            "attributes": {"time": "timestamp"},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert len(data["outputs"]) == 3
