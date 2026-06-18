"""Research-area pre-clipping of the two-anchor network prism OSM download."""

import geopandas as gpd
from shapely.geometry import LineString

from app.tools.space_time_prism import network_prism as np_mod
from app.tools.space_time_prism.network_prism import (
    _intersect_bbox,
    _research_area_geom,
    _try_auto_download_osm_for_anchors,
)
from app.tools.space_time_prism.ppa_engine import make_mode_profile


def _area(west, south, east, north):
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [west, south], [east, south], [east, north],
                        [west, north], [west, south],
                    ]],
                },
                "properties": {},
            }
        ],
    }


def test_intersect_bbox_overlap_and_disjoint():
    assert _intersect_bbox((0, 0, 2, 2), (1, 1, 3, 3)) == (1, 1, 2, 2)
    assert _intersect_bbox((0, 0, 1, 1), (2, 2, 3, 3)) is None


def test_research_area_geom_handles_missing_and_feature():
    assert _research_area_geom(None) is None
    assert _research_area_geom({"type": "FeatureCollection", "features": []}) is None
    geom = _research_area_geom(_area(0, 0, 1, 1)["features"][0])  # bare Feature
    assert geom is not None and not geom.is_empty


def test_download_skips_when_area_disjoint_from_anchors():
    profile = make_mode_profile("walking")
    warnings: list[str] = []
    roads = _try_auto_download_osm_for_anchors(
        profile, 600.0,
        anchor_a={"lng": -72.0, "lat": 41.0},
        anchor_b={"lng": -72.01, "lat": 41.01},
        warnings=warnings,
        max_area_km2=None,
        research_area=_area(0, 0, 1, 1),  # far away
    )
    assert roads is None
    assert any("does not overlap" in w for w in warnings)


def test_download_clips_extent_to_area(monkeypatch):
    """A large reachable extent is clipped to a small research area before fetch,
    so the download stays under the per-mode cap instead of failing."""
    captured: dict = {}

    def fake_fetch(bbox, mode, **kw):
        captured["bbox"] = bbox
        return gpd.GeoDataFrame(
            {"highway": ["residential"]},
            geometry=[LineString([(-72.0, 41.0), (-72.005, 41.005)])],
            crs="EPSG:4326",
        )

    monkeypatch.setattr(np_mod, "fetch_or_cache_osm_roads", fake_fetch)

    profile = make_mode_profile("driving")
    warnings: list[str] = []
    # 1-hour driving budget → huge ellipse; small area bounds the actual fetch.
    area = _area(-72.05, 40.95, -71.95, 41.05)
    roads = _try_auto_download_osm_for_anchors(
        profile, 3600.0,
        anchor_a={"lng": -72.0, "lat": 41.0},
        anchor_b={"lng": -72.01, "lat": 41.01},
        warnings=warnings,
        max_area_km2=None,
        research_area=area,
    )
    assert roads is not None and not roads.empty
    assert any("Clipped OSM download extent to the research area" in w for w in warnings)
    west, _s, east, _n = captured["bbox"]
    assert west >= -72.05 - 1e-9 and east <= -71.95 + 1e-9
