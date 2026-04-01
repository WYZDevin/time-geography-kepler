from app.constants import PROCESSED_HEIGHT_FIELD, PROCESSED_NEIGHBORS_FIELD, PROCESSED_TIME_FIELD


def test_time_geography_basic(client, sample_points):
    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "timestamp"},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["toolId"] == "time-geography"

    # Should produce one FeatureCollection (no stay detection)
    assert len(data["outputs"]) == 1

    fc = data["outputs"][0]
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 3

    bbox = data["runMeta"]["summary"]["bbox"]
    assert bbox is not None
    assert len(bbox) == 4

    # Check processed properties
    props = fc["features"][0]["properties"]
    assert PROCESSED_TIME_FIELD in props
    assert PROCESSED_HEIGHT_FIELD in props
    assert PROCESSED_NEIGHBORS_FIELD in props
    assert "_time_progress" in props
    assert "_sequence" in props
    assert "_dataset_type" in props


def test_time_geography_missing_time_attr(client, sample_points):
    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "nonexistent"},
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_time_geography_no_time_attribute(client, sample_points):
    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={"data": sample_points, "attributes": {}},
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_time_geography_stay_detection(client):
    """Create clustered points to trigger stay detection."""
    features = []
    # Cluster of 5 points at same location within 5 minutes
    for i in range(5):
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-122.42, 37.78]},
                "properties": {"timestamp": f"2025-01-15T10:{i:02d}:00Z"},
            }
        )
    # One far-away point
    features.append(
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-122.0, 37.0]},
            "properties": {"timestamp": "2025-01-15T11:00:00Z"},
        }
    )

    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={
            "data": {"type": "FeatureCollection", "features": features},
            "attributes": {"time": "timestamp"},
            "options": {"visualizeStay": True, "timeWindow": 600000},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    # Should have 2 outputs: main + stay points
    assert len(data["outputs"]) == 2
    stay_fc = data["outputs"][1]
    assert len(stay_fc["features"]) >= 1
