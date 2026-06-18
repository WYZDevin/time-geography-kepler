import math

import pytest

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

    # Output 0 = cubes; output 1 = the 3D trajectory threading the cube stack
    assert len(data["outputs"]) == 2

    fc = data["outputs"][0]
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) > 0

    # The trajectory is emitted even without env data: LineStrings, no exposure.
    traj = data["outputs"][1]
    assert len(traj["features"]) > 0
    assert traj["features"][0]["geometry"]["type"] == "LineString"
    assert "env_exposure" not in traj["features"][0]["properties"]

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


def test_space_time_cube_env_exposure(client):
    """With env_exposure pre-joined onto points, cubes carry env_value and the
    trajectory carries per-segment exposure + colour."""
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-122.4194, 37.7749]},
            "properties": {"timestamp": "2025-01-15T10:00:00Z", "env_exposure": 40.0},
        },
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-122.4194, 37.7749]},
            "properties": {"timestamp": "2025-01-15T10:02:00Z", "env_exposure": 60.0},
        },
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-122.3994, 37.7949]},
            "properties": {"timestamp": "2025-01-15T11:00:00Z", "env_exposure": 80.0},
        },
    ]
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": {"type": "FeatureCollection", "features": features},
            "attributes": {"time": "timestamp"},
            "options": {"envField": "env_exposure"},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert len(data["outputs"]) == 2

    cubes = data["outputs"][0]["features"]
    env_vals = [f["properties"]["env_value"] for f in cubes]
    # At least one cell must have aggregated a real exposure value (not None).
    assert any(v is not None for v in env_vals)

    traj = data["outputs"][1]["features"]
    assert len(traj) > 0
    assert "env_exposure" in traj[0]["properties"]
    assert "color_rgba" in traj[0]["properties"]


def test_space_time_cube_ground_projection(client, sample_points):
    """groundProjection adds a flat Z=0 grid aggregating counts over time."""
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "timestamp"},
            "options": {"groundProjection": True},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    # cubes + trajectory + ground projection
    assert len(data["outputs"]) == 3

    ground = data["outputs"][2]["features"]
    assert len(ground) > 0
    props = ground[0]["properties"]
    assert props["ground_projection"] is True
    assert props["z"] == 0
    assert props[PROCESSED_HEIGHT_FIELD] == 0
    assert "count" in props
    # Geometry is flat: every coordinate sits on the ground plane (Z=0).
    ring = ground[0]["geometry"]["coordinates"][0]
    assert all(coord[2] == 0 for coord in ring)

    # Cell is square on the ground (equal metres N-S and E-W), not equal
    # degrees: longitude extent is widened by 1/cos(lat) to compensate for the
    # projection, so E-W and N-S real-world sizes match.
    width_deg = ring[1][0] - ring[0][0]
    height_deg = ring[2][1] - ring[1][1]
    lat = (ring[0][1] + ring[2][1]) / 2.0
    width_m = width_deg * math.cos(math.radians(lat)) * 111_320
    height_m = height_deg * 111_320
    assert width_m == pytest.approx(height_m, rel=0.02)

    # Aggregation collapses the time axis: total ground count == total points.
    total_ground = sum(f["properties"]["count"] for f in ground)
    assert total_ground == len(sample_points["features"])


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
    assert len(data["outputs"]) == 2


def test_space_time_cube_cell_size_meters(client):
    """cellSizeMeters uses STKDE-style ground metres, not raw lon/lat degrees."""
    feature = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [-122.4194, 37.7749]},
        "properties": {"timestamp": "2025-01-15T10:00:00Z"},
    }
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": {"type": "FeatureCollection", "features": [feature]},
            "attributes": {"time": "timestamp"},
            "options": {"cellSizeMeters": 100, "timeSlices": 1},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True

    ring = data["outputs"][0]["features"][0]["geometry"]["coordinates"][0]
    width_deg = ring[1][0] - ring[0][0]
    height_deg = ring[2][1] - ring[1][1]
    lat = (ring[0][1] + ring[2][1]) / 2.0
    width_m = width_deg * math.cos(math.radians(lat)) * 111_320
    height_m = height_deg * 111_320
    assert width_m == pytest.approx(100, rel=0.02)
    assert height_m == pytest.approx(100, rel=0.02)


def _hourly_points(n: int = 24):
    """n points spread spatially with timestamps one hour apart from 00:00."""
    import math as _math

    features = []
    for i in range(n):
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        -122.4 + 0.02 * _math.sin(i * 1.3),
                        37.78 + 0.02 * _math.cos(i * 1.1),
                    ],
                },
                "properties": {"timestamp": f"2025-01-15T{i % 24:02d}:00:00Z"},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def test_space_time_cube_equal_count_method(client):
    """equal_count splits into nTimeSlices quantile bins of ~equal point count."""
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": _hourly_points(24),
            "attributes": {"time": "timestamp"},
            "options": {"timeSliceMethod": "equal_count", "timeSlices": 4},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    cubes = data["outputs"][0]["features"]
    slice_indices = {f["properties"]["time_slice_index"] for f in cubes}
    # 4 quantile bins over 24 distinct hourly points → up to 4 slice indices.
    assert slice_indices
    assert max(slice_indices) <= 3


def test_space_time_cube_fixed_duration_method(client):
    """fixed_duration derives the slice count from the data span and duration.

    24 hourly points (00:00–23:00) at 6h/slice → 4 slices."""
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": _hourly_points(24),
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
    cubes = data["outputs"][0]["features"]
    slice_indices = {f["properties"]["time_slice_index"] for f in cubes}
    # span is 23h anchored at 00:00 with 6h slices → boundaries at 0,6,12,18,24
    # → 4 slices (indices 0..3).
    assert max(slice_indices) == 3

    # Tooltip-facing slice span: anchored 6h slices read as their real range.
    ranges = {f["properties"]["time_range"] for f in cubes
              if f["properties"]["time_slice_index"] == 0}
    assert ranges == {"2025-01-15 00:00 – 2025-01-15 06:00"}


def test_space_time_cube_fixed_duration_requires_duration(client):
    """Picking fixed_duration without a duration is a clear error, not a
    silent single-slice result."""
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": _hourly_points(24),
            "attributes": {"time": "timestamp"},
            "options": {"timeSliceMethod": "fixed_duration"},
        },
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["success"] is False
    assert "Slice Duration" in body["error"]


def test_space_time_cube_anchor_ignored_under_alignment_warns(client):
    """A wall-clock anchor is meaningless on an aligned (elapsed-time) axis;
    the user must be told instead of silently dropping it."""
    data = _hourly_points(24)
    for i, f in enumerate(data["features"]):
        f["properties"]["user"] = "alice" if i % 2 == 0 else "bob"
        # offset bob's days so alignment actually activates (distinct origins)
        if i % 2 == 1:
            f["properties"]["timestamp"] = f"2025-01-16T{i % 24:02d}:00:00Z"
    resp = client.post(
        "/api/v1/tools/space-time-cube/execute",
        json={
            "data": data,
            "attributes": {"time": "timestamp"},
            "options": {
                "timeSliceMethod": "fixed_duration",
                "sliceDurationHours": 6,
                "sliceAnchor": "2025-01-15T00:00:00Z",
                "userIdField": "user",
                "alignUserTime": True,
            },
        },
    )
    assert resp.status_code == 200
    data_out = resp.get_json()
    assert any("anchor ignored" in w.lower() for w in data_out["runMeta"]["warnings"])


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
    assert len(data["outputs"]) == 2
