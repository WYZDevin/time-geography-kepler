import time
from datetime import UTC, datetime
from typing import Any

import geopandas as gpd
from shapely.geometry import mapping, shape

from app.models import ExecuteResponse, ExecutionMetadata, RunMeta, RunSummary
from app.tools.base import BaseTool


def geojson_to_gdf(data: dict[str, Any]) -> gpd.GeoDataFrame:
    """Convert a GeoJSON FeatureCollection dict to a GeoDataFrame with CRS=4326."""
    features = data.get("features", [])
    if not features:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    return gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")


def gdf_to_geojson(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    """Convert a GeoDataFrame to a GeoJSON FeatureCollection dict."""
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    features = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        props = {k: _serialize(v) for k, v in row.drop("geometry").items()}
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": props,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _serialize(val: Any) -> Any:
    """Make a value JSON-serializable (handles nested dicts/lists)."""
    if hasattr(val, "item"):
        val = val.item()
    if isinstance(val, float) and (val != val or val == float("inf") or val == float("-inf")):
        return None
    if isinstance(val, (datetime,)):
        return val.isoformat()
    if isinstance(val, dict):
        return {k: _serialize(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_serialize(v) for v in val]
    return val


def filter_to_research_area(
    gdf: gpd.GeoDataFrame, research_area: dict[str, Any]
) -> gpd.GeoDataFrame:
    """Keep only features that intersect the research-area polygon.

    `research_area` may be a GeoJSON FeatureCollection or a single Feature. The
    area is interpreted in EPSG:4326 (frontend map CRS) and reprojected to match
    the result's CRS before the spatial test, so it works regardless of whether a
    tool returns geographic or metric geometries. Whole features are kept (no
    geometry cutting); a non-intersecting area yields an empty result.
    """
    if gdf.empty:
        return gdf

    feats = research_area.get("features")
    if feats is None and research_area.get("type") == "Feature":
        feats = [research_area]
    if not feats:
        return gdf

    area = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
    mask = area.geometry.union_all()
    if mask.is_empty:
        return gdf

    target_crs = gdf.crs or "EPSG:4326"
    if str(target_crs) != "EPSG:4326":
        mask = gpd.GeoSeries([mask], crs="EPSG:4326").to_crs(target_crs).iloc[0]

    kept = gdf[gdf.intersects(mask)].copy()
    kept.attrs = dict(gdf.attrs)
    removed = len(gdf) - len(kept)
    if removed > 0:
        warnings = list(kept.attrs.get("warnings", []))
        warnings.append(
            f"Research area clip: kept {len(kept)} of {len(gdf)} features "
            f"({removed} outside the area)."
        )
        kept.attrs["warnings"] = warnings
    return kept


def compute_bbox(outputs: list[dict[str, Any]]) -> list[float] | None:
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
    tool: BaseTool,
    outputs: list[dict[str, Any]],
    input_count: int,
    options: dict[str, Any],
    source_dataset_ids: list[str],
    start_time: float,
    warnings: list[str] | None = None,
) -> ExecuteResponse:
    """Build the standard AnalysisResult response."""
    execution_time = int((time.time() - start_time) * 1000)
    now = datetime.now(UTC)
    output_count = sum(len(fc.get("features", [])) for fc in outputs)
    bbox = compute_bbox(outputs)

    return ExecuteResponse(
        success=True,
        toolId=tool.id,
        outputs=outputs,
        metadata=ExecutionMetadata(
            executionTime=execution_time,
            featureCount=output_count,
            timestamp=now.isoformat(),
        ),
        runMeta=RunMeta(
            toolName=tool.name,
            toolVersion=tool.version,
            runAt=int(now.timestamp() * 1000),
            sourceDatasetIds=source_dataset_ids,
            params=options,
            summary=RunSummary(
                inputCount=input_count,
                outputCount=output_count,
                bbox=bbox,
            ),
            warnings=warnings or [],
        ),
    )
