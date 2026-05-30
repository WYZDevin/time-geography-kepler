import geopandas as gpd
from shapely.geometry import Point

from app.constants import PROCESSED_HEIGHT_FIELD
from app.tools.space_time_prism import SpaceTimePrismTool


def test_pasta_outputs_aggregate_voxels_and_anchor_windows():
    gdf = gpd.GeoDataFrame(
        [
            {
                "person_id": "p1",
                "activity_type": "home",
                "start_time": "2024-01-01T08:00:00",
                "end_time": "2024-01-01T08:30:00",
                "mode": "walking",
                "weight": 1.5,
                "geometry": Point(-83.740, 42.280),
            },
            {
                "person_id": "p1",
                "activity_type": "shopping",
                "start_time": "2024-01-01T09:00:00",
                "end_time": "2024-01-01T09:30:00",
                "mode": "walking",
                "weight": 1.5,
                "geometry": Point(-83.735, 42.281),
            },
            {
                "person_id": "p1",
                "activity_type": "work",
                "start_time": "2024-01-01T10:30:00",
                "end_time": "2024-01-01T17:00:00",
                "mode": "walking",
                "weight": 1.5,
                "geometry": Point(-83.730, 42.282),
            },
        ],
        crs="EPSG:4326",
    )

    outputs = SpaceTimePrismTool().execute(
        gdf,
        {
            "analysisMode": "pasta",
            "spatialResolutionMeters": 500,
            "temporalResolutionMinutes": 15,
            "minimumActivityMinutes": 5,
            "showVoxels": True,
            "maxVoxels": 100,
            "scenarioName": "baseline",
        },
        {"time": "start_time"},
    )

    assert len(outputs) >= 3
    ds_types = [o.iloc[0]["_dataset_type"] for o in outputs if not o.empty]
    assert "pasta-aggregate-surface" in ds_types
    assert "pasta-voxels" in ds_types
    assert "pasta-anchor-windows" in ds_types
    surface = outputs[0]
    assert surface["weighted_dwell_minutes"].sum() > 0
    assert surface.iloc[0]["pasta_unit"] == "population-weighted potential dwell minutes"


def test_interactive_anchor_prism_runs_on_backend():
    outputs = SpaceTimePrismTool().execute(
        gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"),
        {
            "analysisMode": "interactive",
            "_anchorA": {
                "lng": -83.740,
                "lat": 42.280,
                "timestamp": "2024-01-01T09:00:00Z",
                "label": "Home",
            },
            "_anchorB": {
                "lng": -83.735,
                "lat": 42.281,
                "timestamp": "2024-01-01T10:00:00Z",
                "label": "Work",
            },
            "speedMode": "walking",
            "timeSlices": 8,
            "showPPA": True,
        },
        {},
    )

    assert outputs[0].iloc[0]["_dataset_type"] == "space-time-prism"
    assert outputs[1].iloc[0]["_dataset_type"] == "prism-trajectory"
    assert outputs[2].iloc[0]["_dataset_type"] == "potential-path-area"
    assert outputs[3].iloc[0]["_dataset_type"] == "prism-anchors"
    assert outputs[0][PROCESSED_HEIGHT_FIELD].max() > 0


def test_interactive_network_anchor_prism_runs_on_backend():
    outputs = SpaceTimePrismTool().execute(
        gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"),
        {
            "analysisMode": "interactive",
            "prismMode": "network",
            "_anchorA": {"lng": -83.740, "lat": 42.280, "timestamp": 1704103200000},
            "_anchorB": {"lng": -83.735, "lat": 42.281, "timestamp": 1704106800000},
            "speedMode": "walking",
            "timeSlices": 6,
            "showPPA": False,
        },
        {},
    )

    dataset_types = [output.iloc[0]["_dataset_type"] for output in outputs if not output.empty]
    assert "space-time-prism" in dataset_types
    assert "prism-trajectory" in dataset_types
    assert "prism-anchors" in dataset_types


def test_interactive_anchor_prism_api(client):
    resp = client.post(
        "/api/v1/tools/space-time-prism/execute",
        json={
            "data": {"type": "FeatureCollection", "features": []},
            "options": {
                "analysisMode": "interactive",
                "_anchorA": {
                    "lng": -83.740,
                    "lat": 42.280,
                    "timestamp": "2024-01-01T09:00:00Z",
                },
                "_anchorB": {
                    "lng": -83.735,
                    "lat": 42.281,
                    "timestamp": "2024-01-01T10:00:00Z",
                },
                "speedMode": "walking",
                "timeSlices": 8,
            },
        },
    )

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["toolId"] == "space-time-prism"
    assert payload["outputs"][0]["features"][0]["properties"]["_dataset_type"] == "space-time-prism"
