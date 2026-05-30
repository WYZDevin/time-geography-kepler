def test_list_tools(client):
    resp = client.get("/api/v1/tools")
    assert resp.status_code == 200
    data = resp.get_json()
    tools = data["tools"]
    # Active tool set after redundant-tool cleanup
    assert len(tools) == 4

    ids = {t["id"] for t in tools}
    assert ids == {
        "time-geography",
        "stkde",
        "space-time-cube",
        "space-time-prism",
    }

    for t in tools:
        assert "name" in t
        assert "version" in t
        assert "executionPolicy" in t


def test_unknown_tool_returns_404(client):
    resp = client.post(
        "/api/v1/tools/nonexistent/execute",
        json={"data": {"type": "FeatureCollection", "features": []}},
    )
    assert resp.status_code == 404
    assert resp.get_json()["success"] is False
