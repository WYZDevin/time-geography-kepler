"""Tests for research-area clipping (filter to intersecting features)."""

import geopandas as gpd
from shapely.geometry import Point

from app.utils import filter_to_research_area

# A 1x1 degree box around the origin.
RESEARCH_AREA = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            },
            "properties": {},
        }
    ],
}


def _gdf(*points):
    return gpd.GeoDataFrame(
        {"id": list(range(len(points)))},
        geometry=[Point(*p) for p in points],
        crs="EPSG:4326",
    )


def test_keeps_features_inside_and_drops_outside():
    gdf = _gdf((0.5, 0.5), (5, 5), (0.1, 0.9))
    out = filter_to_research_area(gdf, RESEARCH_AREA)
    assert list(out["id"]) == [0, 2]


def test_accepts_bare_feature():
    gdf = _gdf((0.5, 0.5), (5, 5))
    out = filter_to_research_area(gdf, RESEARCH_AREA["features"][0])
    assert len(out) == 1


def test_records_warning_when_features_removed():
    gdf = _gdf((0.5, 0.5), (5, 5))
    out = filter_to_research_area(gdf, RESEARCH_AREA)
    assert any("Research area clip" in w for w in out.attrs.get("warnings", []))


def test_reprojects_area_to_metric_crs():
    # Same points in a UTM CRS; the area (in 4326) must be reprojected to match.
    gdf = _gdf((0.5, 0.5), (5, 5)).to_crs(epsg=32631)
    out = filter_to_research_area(gdf, RESEARCH_AREA)
    assert len(out) == 1


def test_empty_input_returns_empty():
    gdf = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    out = filter_to_research_area(gdf, RESEARCH_AREA)
    assert out.empty


def test_execute_route_clips_output(client, sample_points):
    """Time-geography output should be clipped when a research area is sent."""
    # Area far from the SF sample points → expect everything filtered out.
    empty_area = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                },
                "properties": {},
            }
        ],
    }
    resp = client.post(
        "/api/v1/tools/time-geography/execute",
        json={
            "data": sample_points,
            "attributes": {"time": "timestamp"},
            "options": {},
            "researchArea": empty_area,
        },
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["metadata"]["featureCount"] == 0
