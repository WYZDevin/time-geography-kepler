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
            assert "side_length" in props
            assert "time_value" in props
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


def _spread_points(n: int = 40):
    """Points over a ~20x10 km extent with hourly timestamps."""
    import math as _math

    features = []
    for i in range(n):
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        -72.25 + 0.1 * _math.sin(i * 1.7),
                        41.8 + 0.05 * _math.cos(i * 2.3),
                    ],
                },
                "properties": {
                    "timestamp": f"2025-01-15T{i % 24:02d}:{(i * 7) % 60:02d}:00Z",
                    "user": "alice" if i % 2 == 0 else "bob",
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def test_stkde_cell_size_meters_honored(client):
    """An explicit cell size in meters must control the output grid, even when
    finer than the auto-detected 50x50 default."""
    meters = 250.0
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": _spread_points(),
            "attributes": {"time": "timestamp"},
            "options": {"cellSizeMeters": meters, "nTimeSlices": 3},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True

    # The N-S (latitude) edge of each cell polygon should be ~250m in degrees
    expected_deg = meters / 111_320.0
    for fc in data["outputs"]:
        if fc["features"]:
            ring = fc["features"][0]["geometry"]["coordinates"][0]
            lat_edge = abs(ring[2][1] - ring[1][1])
            assert abs(lat_edge - expected_deg) / expected_deg < 0.01
            break
    else:
        raise AssertionError("no STKDE features produced")


def test_stkde_ground_projection(client):
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": _spread_points(),
            "attributes": {"time": "timestamp"},
            "options": {"groundProjection": True, "nTimeSlices": 3},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["outputs"]) == 4
    ground_features = data["outputs"][3]["features"]
    assert ground_features
    for f in ground_features:
        assert f["properties"]["ground_projection"] is True
        assert f["properties"]["z"] == 0
        assert f["properties"]["density"] > 0
        assert all(coord[2] == 0 for coord in f["geometry"]["coordinates"][0])

    # The ground output is a continuous 2D spatial KDE (gradient rendering):
    # densities must actually vary, not collapse to a single class
    densities = [f["properties"]["density"] for f in ground_features]
    assert max(densities) > min(densities)


def test_stkde_show_trajectory(client):
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": _spread_points(),
            "attributes": {"time": "timestamp"},
            "options": {"showTrajectory": True, "nTimeSlices": 3},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["outputs"]) == 4
    traj = data["outputs"][3]
    assert traj["features"]
    assert traj["features"][0]["properties"]["_dataset_type"] == "time-geography-trajectory"


def test_stkde_align_user_time(client):
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": _spread_points(),
            "attributes": {"time": "timestamp"},
            "options": {"userIdField": "user", "alignUserTime": True, "nTimeSlices": 3},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    for fc in data["outputs"]:
        if fc["features"]:
            props = fc["features"][0]["properties"]
            # The raw elapsed offset is a small per-user duration
            assert "_elapsed_ms" in props
            assert props["_elapsed_ms"] < 10 * 86_400_000
            # The displayed time is anchored at the global minimum (a real 2025
            # date), not a bare elapsed value formatted as epoch 0 (1970)
            assert props["time_value"].startswith("2025-01-15")
            assert props["_timestamp"] > 1_000_000_000_000
            break
    else:
        raise AssertionError("no STKDE features produced")


def test_stkde_equal_count_method(client):
    """equal_count samples slice centers at quantiles of the point times."""
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": _spread_points(40),
            "attributes": {"time": "timestamp"},
            "options": {"timeSliceMethod": "equal_count", "nTimeSlices": 5},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    indices = set()
    for fc in data["outputs"]:
        for f in fc["features"]:
            indices.add(f["properties"]["time_slice_index"])
    assert indices
    assert max(indices) <= 4


def test_stkde_fixed_duration_method(client):
    """fixed_duration derives the slice count from the data span and duration."""
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": _spread_points(40),
            "attributes": {"time": "timestamp"},
            "options": {
                "timeSliceMethod": "fixed_duration",
                "sliceDurationHours": 6,
                "sliceAnchor": "2025-01-15T00:00:00Z",
            },
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    # _spread_points spans hours 0..23 → with 6h slices anchored at midnight the
    # KDE is sampled at up to 4 slice centers.
    indices = set()
    time_range = None
    for fc in data["outputs"]:
        for f in fc["features"]:
            indices.add(f["properties"]["time_slice_index"])
            time_range = time_range or f["properties"].get("time_range")
    assert indices
    assert max(indices) <= 3
    # Edge-based methods expose the slice's actual span for tooltips.
    assert time_range and " – " in time_range


def test_stkde_fixed_duration_requires_duration(client):
    """Picking fixed_duration without a duration is a clear error, not a
    silent single-slice result."""
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": _spread_points(40),
            "attributes": {"time": "timestamp"},
            "options": {"timeSliceMethod": "fixed_duration"},
        },
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["success"] is False
    assert "Slice Duration" in body["error"]


def test_stkde_unparseable_anchor_warns(client):
    """A bad anchor string falls back to the first data point — with a warning,
    never silently."""
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": _spread_points(40),
            "attributes": {"time": "timestamp"},
            "options": {
                "timeSliceMethod": "fixed_duration",
                "sliceDurationHours": 6,
                "sliceAnchor": "not-a-date",
            },
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert any("could not parse slice anchor" in w.lower()
               for w in data["runMeta"]["warnings"])


def test_stkde_mixed_timestamp_formats(client):
    """Files mixing "09/15/2022 00:02" with "2022-09-15 00:02:35" must parse
    (pandas >=2 otherwise locks onto the first row's format and raises)."""
    data = _spread_points(20)
    for i, f in enumerate(data["features"]):
        f["properties"]["timestamp"] = (
            f"09/15/2022 00:{i:02d}" if i % 2 == 0 else f"2022-09-15 00:{i:02d}:35"
        )
    resp = client.post(
        "/api/v1/tools/stkde/execute",
        json={
            "data": data,
            "attributes": {"time": "timestamp"},
            "options": {"nTimeSlices": 3},
        },
    )
    assert resp.status_code == 200
    data_out = resp.get_json()
    assert data_out["success"] is True
    assert sum(len(fc["features"]) for fc in data_out["outputs"]) > 0
