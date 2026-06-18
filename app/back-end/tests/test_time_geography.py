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


def _two_user_payload(days_apart: int = 0):
    """Two users, 4 points each, optionally tracked `days_apart` days apart."""
    features = []
    for u, (user, day) in enumerate([("alice", 15), ("bob", 15 + days_apart)]):
        for i in range(4):
            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [-122.42 + 0.01 * i + 0.05 * u, 37.78 + 0.01 * i],
                    },
                    "properties": {
                        "timestamp": f"2025-01-{day:02d}T1{i}:00:00Z",
                        "user": user,
                    },
                }
            )
    return {"type": "FeatureCollection", "features": features}


def test_time_geography_user_split(client):
    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={
            "data": _two_user_payload(),
            "attributes": {"time": "timestamp"},
            "options": {"userIdField": "user"},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    feats = data["outputs"][0]["features"]
    assert len(feats) == 8

    # Points are sorted user-major; neighbors must never cross the user boundary
    by_index = {f["properties"]["_sequence"]: f["properties"] for f in feats}
    for i, props in by_index.items():
        for nb in props[PROCESSED_NEIGHBORS_FIELD]:
            assert by_index[nb]["_user_id"] == props["_user_id"]

    # Each user gets a distinct color
    colors = {tuple(p["color_rgba"]) for p in by_index.values()}
    assert len(colors) == 2


def test_time_geography_show2d(client, sample_points):
    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "timestamp"},
            "options": {"show2D": True},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["outputs"]) == 2
    ground = data["outputs"][1]
    for f in ground["features"]:
        assert f["properties"]["_dataset_type"] == "time-geography-trajectory-2d"
        assert f["properties"][PROCESSED_HEIGHT_FIELD] == 0
        assert f["geometry"]["coordinates"][2] == 0


def test_time_geography_align_user_time(client):
    # Users tracked 10 days apart: unaligned span ~10 days, aligned span < 2 days
    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={
            "data": _two_user_payload(days_apart=10),
            "attributes": {"time": "timestamp"},
            "options": {"userIdField": "user", "alignUserTime": True},
        },
    )
    assert resp.status_code == 200
    feats = resp.get_json()["outputs"][0]["features"]
    timestamps = [f["properties"]["_timestamp"] for f in feats]
    assert max(timestamps) - min(timestamps) < 2 * 86_400_000
    assert all("_elapsed_ms" in f["properties"] for f in feats)


def test_time_geography_mixed_timestamp_formats(client):
    """Pandas >=2 infers the format from the first row and then raises on the
    rest — files mixing "09/15/2022 00:02" with "2022-09-15 00:02:35" must parse."""
    stamps = [
        "09/15/2022 00:02",
        "2022-09-15 00:02:35",
        "09/15/2022 00:05",
        "2022-09-15 00:07:10",
    ]
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-122.42 + 0.01 * i, 37.78]},
            "properties": {"timestamp": ts},
        }
        for i, ts in enumerate(stamps)
    ]
    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={
            "data": {"type": "FeatureCollection", "features": features},
            "attributes": {"time": "timestamp"},
        },
    )
    assert resp.status_code == 200
    feats = resp.get_json()["outputs"][0]["features"]
    assert len(feats) == 4
    # All four parse onto the same day and stay in chronological order
    timestamps = [f["properties"]["_timestamp"] for f in feats]
    assert timestamps == sorted(timestamps)
    assert max(timestamps) - min(timestamps) < 86_400_000
