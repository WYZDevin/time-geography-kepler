def test_intersection_basic(client, sample_polygons):
    resp = client.post(
        "/api/v1/tools/intersection-analysis/execute",
        json={"data": sample_polygons},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["toolId"] == "intersection-analysis"

    fc = data["outputs"][0]
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) >= 1

    bbox = data["runMeta"]["summary"]["bbox"]
    assert bbox is not None
    assert len(bbox) == 4

    props = fc["features"][0]["properties"]
    assert "_intersection_operation" in props
    assert "_feature_pair" in props


def test_intersection_preserve_properties(client, sample_polygons):
    resp = client.post(
        "/api/v1/tools/intersection-analysis/execute",
        json={
            "data": sample_polygons,
            "options": {"preserveProperties": True},
        },
    )
    data = resp.get_json()
    assert data["success"] is True
    props = data["outputs"][0]["features"][0]["properties"]
    assert "feature_a_props" in props
    assert "feature_b_props" in props


def test_intersection_too_few_polygons(client):
    single = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]],
                },
                "properties": {},
            }
        ],
    }
    resp = client.post(
        "/api/v1/tools/intersection-analysis/execute",
        json={"data": single},
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_intersection_three_polygons(client, three_polygons):
    resp = client.post(
        "/api/v1/tools/intersection-analysis/execute",
        json={"data": three_polygons},
    )
    data = resp.get_json()
    assert data["success"] is True
    # 3 polygons → up to 3 pairwise intersections
    fc = data["outputs"][0]
    assert len(fc["features"]) >= 1
