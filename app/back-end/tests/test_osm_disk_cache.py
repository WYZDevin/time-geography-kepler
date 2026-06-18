"""Persistent on-disk OSM cache + containment reuse.

The disk cache directory is isolated per test by the autouse
``_isolate_osm_disk_cache`` fixture in conftest.py (STP_OSM_CACHE_DIR → tmp).
"""
import geopandas as gpd
from shapely.geometry import LineString

from app.tools.space_time_prism.ppa_engine import fetch_or_cache_osm_roads
from app.tools.space_time_prism.ppa_engine.extent import clear_osm_cache, osm_cache_size


def _roads() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {"highway": ["primary", "primary", "primary"]},
        geometry=[
            LineString([(0.0, 0.0), (0.1, 0.1)]),
            LineString([(0.2, 0.2), (0.3, 0.3)]),
            LineString([(0.9, 0.9), (1.0, 1.0)]),
        ],
        crs="EPSG:4326",
    )


def _counting_fetch():
    calls = {"n": 0}

    def fetch(bbox, buffer_deg=0.0):
        calls["n"] += 1
        return _roads()

    return fetch, calls


def test_disk_cache_survives_memory_clear():
    fetch, calls = _counting_fetch()
    bbox = (0.0, 0.0, 1.0, 1.0)

    a = fetch_or_cache_osm_roads(bbox, "driving", fetch_fn=fetch)
    assert a is not None and calls["n"] == 1

    clear_osm_cache()                       # wipe in-memory; disk persists
    assert osm_cache_size() == 0

    b = fetch_or_cache_osm_roads(bbox, "driving", fetch_fn=fetch)
    assert b is not None
    assert calls["n"] == 1                   # served from disk — no new download


def test_contained_bbox_reuses_larger_download_in_memory():
    fetch, calls = _counting_fetch()
    fetch_or_cache_osm_roads((0.0, 0.0, 1.0, 1.0), "driving", fetch_fn=fetch)
    assert calls["n"] == 1

    # A smaller bbox fully inside the cached one is reused (clipped), not fetched.
    out = fetch_or_cache_osm_roads((0.0, 0.0, 0.35, 0.35), "driving", fetch_fn=fetch)
    assert out is not None
    assert calls["n"] == 1
    assert len(out) == 2                     # the far 0.9–1.0 segment is clipped out


def test_contained_bbox_reuses_from_disk_after_memory_clear():
    fetch, calls = _counting_fetch()
    fetch_or_cache_osm_roads((0.0, 0.0, 1.0, 1.0), "driving", fetch_fn=fetch)
    clear_osm_cache()

    out = fetch_or_cache_osm_roads((0.0, 0.0, 0.35, 0.35), "driving", fetch_fn=fetch)
    assert out is not None and calls["n"] == 1
    assert len(out) == 2


def test_disjoint_bbox_does_not_reuse():
    fetch, calls = _counting_fetch()
    fetch_or_cache_osm_roads((0.0, 0.0, 0.4, 0.4), "driving", fetch_fn=fetch)
    # A bbox not contained in the cached one must trigger a fresh download.
    fetch_or_cache_osm_roads((5.0, 5.0, 6.0, 6.0), "driving", fetch_fn=fetch)
    assert calls["n"] == 2
