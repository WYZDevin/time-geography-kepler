from datetime import datetime, timezone
import time

import geopandas as gpd
from shapely.geometry import mapping, shape


def geojson_to_gdf(data: dict) -> gpd.GeoDataFrame:
    """Convert a GeoJSON FeatureCollection dict to a GeoDataFrame with CRS=4326."""
    features = data.get("features", [])
    if not features:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    return gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")


def gdf_to_geojson(gdf: gpd.GeoDataFrame) -> dict:
    """Convert a GeoDataFrame to a GeoJSON FeatureCollection dict."""
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    features = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        props = {k: _serialize(v) for k, v in row.drop("geometry").items()}
        features.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": props,
        })
    return {"type": "FeatureCollection", "features": features}


def _serialize(val):
    """Make a value JSON-serializable."""
    if hasattr(val, "item"):
        return val.item()
    if isinstance(val, (datetime,)):
        return val.isoformat()
    return val


def compute_bbox(outputs: list[dict]) -> list[float] | None:
    """Compute [minX, minY, maxX, maxY] from a list of FeatureCollection dicts."""
    all_coords = []
    for fc in outputs:
        for feat in fc.get("features", []):
            geom = shape(feat["geometry"])
            bounds = geom.bounds  # (minx, miny, maxx, maxy)
            all_coords.append(bounds)

    if not all_coords:
        return None

    min_x = min(b[0] for b in all_coords)
    min_y = min(b[1] for b in all_coords)
    max_x = max(b[2] for b in all_coords)
    max_y = max(b[3] for b in all_coords)
    return [min_x, min_y, max_x, max_y]


def build_response(
    tool,
    outputs: list[dict],
    input_count: int,
    options: dict,
    source_dataset_ids: list[str],
    start_time: float,
    warnings: list[str] | None = None,
) -> dict:
    """Build the standard AnalysisResult response dict."""
    execution_time = int((time.time() - start_time) * 1000)
    now = datetime.now(timezone.utc)
    output_count = sum(len(fc.get("features", [])) for fc in outputs)
    bbox = compute_bbox(outputs)

    return {
        "success": True,
        "toolId": tool.id,
        "outputs": outputs,
        "metadata": {
            "executionTime": execution_time,
            "featureCount": output_count,
            "timestamp": now.isoformat(),
        },
        "runMeta": {
            "toolName": tool.name,
            "toolVersion": tool.version,
            "runAt": int(now.timestamp() * 1000),
            "sourceDatasetIds": source_dataset_ids,
            "params": options,
            "summary": {
                "inputCount": input_count,
                "outputCount": output_count,
                "bbox": bbox,
            },
            "warnings": warnings or [],
        },
    }
