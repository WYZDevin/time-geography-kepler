def test_union_basic(client, sample_polygons):
    resp = client.post(
        "/api/v1/tools/union-analysis/execute",
        json={"data": sample_polygons},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["toolId"] == "union-analysis"

    fc = data["outputs"][0]
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 1

    bbox = data["runMeta"]["summary"]["bbox"]
    assert bbox is not None
    assert len(bbox) == 4

    props = fc["features"][0]["properties"]
    assert props["_union_operation"] == "unary_union"
    assert props["_original_feature_count"] == 2


def test_union_no_polygons(client, sample_points):
    resp = client.post(
        "/api/v1/tools/union-analysis/execute",
        json={"data": sample_points},
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_union_preserve_properties(client, sample_polygons):
    resp = client.post(
        "/api/v1/tools/union-analysis/execute",
        json={
            "data": sample_polygons,
            "options": {"preserveProperties": True},
        },
    )
    data = resp.get_json()
    assert data["success"] is True
    props = data["outputs"][0]["features"][0]["properties"]
    assert "feature_0_props" in props
