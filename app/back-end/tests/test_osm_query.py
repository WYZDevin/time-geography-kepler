"""The Overpass query is mode-aware: vehicle modes fetch only through-roads."""
from app.tools.space_time_prism import road_network as rn


class _FakeResp:
    def raise_for_status(self):
        pass

    def json(self):
        return {"elements": []}


def _capture_query(monkeypatch) -> dict:
    captured: dict = {}

    def fake_post(url, data=None, headers=None, timeout=None):
        captured["query"] = data["data"]
        return _FakeResp()

    monkeypatch.setattr(rn.requests, "post", fake_post)
    return captured


def test_driving_download_excludes_minor_roads(monkeypatch):
    captured = _capture_query(monkeypatch)
    rn._fetch_osm_roads((0.0, 0.0, 0.01, 0.01), buffer_deg=0.0, mode="driving")
    q = captured["query"]
    assert "motorway" in q and "primary" in q
    assert "residential" not in q  # minor classes not auto-downloaded for driving
    assert "footway" not in q


def test_walking_download_fetches_all_highways(monkeypatch):
    captured = _capture_query(monkeypatch)
    rn._fetch_osm_roads((0.0, 0.0, 0.01, 0.01), buffer_deg=0.0, mode="walking")
    # No mode-specific class list → unrestricted highway query (footways etc.).
    assert '["highway"]' in captured["query"]


def test_default_mode_fetches_all_highways(monkeypatch):
    captured = _capture_query(monkeypatch)
    rn._fetch_osm_roads((0.0, 0.0, 0.01, 0.01), buffer_deg=0.0)
    assert '["highway"]' in captured["query"]
