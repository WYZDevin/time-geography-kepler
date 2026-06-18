import pytest

from app import create_app


@pytest.fixture(autouse=True)
def _isolate_osm_disk_cache(tmp_path, monkeypatch):
    """Point the persistent OSM disk cache at a fresh temp dir per test so cached
    downloads never leak between tests (or from a developer's real cache)."""
    monkeypatch.setenv("STP_OSM_CACHE_DIR", str(tmp_path / "osm-cache"))
    from app.tools.space_time_prism.ppa_engine.extent import clear_osm_cache
    clear_osm_cache()
    yield
    clear_osm_cache()


@pytest.fixture()
def app():
    app = create_app()
    app.config["TESTING"] = True
    return app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def sample_points():
    """Three points in San Francisco."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-122.4194, 37.7749]},
                "properties": {"id": 1, "timestamp": "2025-01-15T10:00:00Z"},
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-122.4094, 37.7849]},
                "properties": {"id": 2, "timestamp": "2025-01-15T10:05:00Z"},
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-122.3994, 37.7949]},
                "properties": {"id": 3, "timestamp": "2025-01-15T10:10:00Z"},
            },
        ],
    }


@pytest.fixture()
def sample_polygons():
    """Two overlapping squares."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [-122.42, 37.77],
                            [-122.41, 37.77],
                            [-122.41, 37.78],
                            [-122.42, 37.78],
                            [-122.42, 37.77],
                        ]
                    ],
                },
                "properties": {"name": "A"},
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [-122.415, 37.775],
                            [-122.405, 37.775],
                            [-122.405, 37.785],
                            [-122.415, 37.785],
                            [-122.415, 37.775],
                        ]
                    ],
                },
                "properties": {"name": "B"},
            },
        ],
    }


@pytest.fixture()
def three_polygons(sample_polygons):
    """Three overlapping polygons."""
    features = list(sample_polygons["features"])
    features.append(
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-122.418, 37.772],
                        [-122.408, 37.772],
                        [-122.408, 37.782],
                        [-122.418, 37.782],
                        [-122.418, 37.772],
                    ]
                ],
            },
            "properties": {"name": "C"},
        }
    )
    return {"type": "FeatureCollection", "features": features}
