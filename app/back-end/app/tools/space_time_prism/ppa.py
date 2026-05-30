import logging
import math
import os

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

from app.constants import PROCESSED_HEIGHT_FIELD
from .road_network import (
    _auto_utm_crs,
    _json_safe,
    _lift_geom_z,
    _load_road_network,
    _parse_timestamps,
    _ppa_ellipse,
    RoadNetworkSTPOptions,
)

logger = logging.getLogger(__name__)


def _build_segment_ppas(
    gdf: gpd.GeoDataFrame,
    time_field: str,
    speed_ms: float,
    buffer_meters: float = 100.0,
) -> tuple[list[tuple[int, object]], np.ndarray, np.ndarray, np.ndarray, str]:
    """Compute per-segment PPA ellipses along a trajectory in metric CRS.

    Returns (ppa_list, xs, ys, timestamps, metric_crs) where ppa_list contains
    (segment_index, polygon_in_metric_crs) tuples.
    """
    logger.info("_build_segment_ppas: %d points, time_field=%s, speed=%.1f m/s",
                len(gdf), time_field, speed_ms)

    timestamps = _parse_timestamps(gdf, time_field)
    order = np.argsort(timestamps)
    gdf = gdf.iloc[order].reset_index(drop=True)
    timestamps = timestamps[order]

    logger.info("  timestamps range: %d → %d (%.1f min span)",
                int(timestamps[0]), int(timestamps[-1]),
                (timestamps[-1] - timestamps[0]) / 60_000)

    centroid_lon = float(gdf.geometry.x.mean())
    centroid_lat = float(gdf.geometry.y.mean())
    metric_crs = _auto_utm_crs(centroid_lon, centroid_lat)

    gdf_metric = gdf.to_crs(metric_crs)
    xs = gdf_metric.geometry.x.values
    ys = gdf_metric.geometry.y.values
    n = len(gdf)

    ppas: list[tuple[int, object]] = []
    n_fallback = 0
    n_skipped = 0
    for i in range(n - 1):
        budget_s = (float(timestamps[i + 1]) - float(timestamps[i])) / 1000.0
        if budget_s <= 0:
            n_skipped += 1
            continue
        ellipse = _ppa_ellipse(xs[i], ys[i], xs[i + 1], ys[i + 1], speed_ms, budget_s)
        if ellipse is None:
            ellipse = LineString([(xs[i], ys[i]), (xs[i + 1], ys[i + 1])]).buffer(buffer_meters)
            n_fallback += 1
        ppas.append((i, ellipse))

    logger.info("  segments: %d total, %d PPAs, %d fallback buffers, %d skipped (budget≤0)",
                n - 1, len(ppas) - n_fallback, n_fallback, n_skipped)

    return ppas, xs, ys, timestamps, metric_crs


def _interpolate_trajectory(
    anchor_a: dict, anchor_b: dict, num_points: int = 20,
    duration_minutes: float = 0,
) -> gpd.GeoDataFrame:
    """Create a synthetic straight-line trajectory between two anchors."""
    lng_a, lat_a = float(anchor_a["lng"]), float(anchor_a["lat"])
    lng_b, lat_b = float(anchor_b["lng"]), float(anchor_b["lat"])
    t_a = float(anchor_a.get("timestamp", 0))
    t_b = float(anchor_b.get("timestamp", 0))
    if t_a > t_b:
        lng_a, lat_a, lng_b, lat_b = lng_b, lat_b, lng_a, lat_a
        t_a, t_b = t_b, t_a

    if t_a == t_b or t_a == 0 or t_b == 0:
        now_ms = pd.Timestamp.utcnow().value // 10**6
        dur_ms = max(duration_minutes, 45) * 60_000
        t_a = float(now_ms)
        t_b = float(now_ms + dur_ms)
        logger.info("_interpolate_trajectory: timestamps were 0/equal, synthesized %.0f min span", dur_ms / 60_000)

    logger.info("_interpolate_trajectory: %d points, (%.4f,%.4f)→(%.4f,%.4f), %.1f min",
                num_points, lng_a, lat_a, lng_b, lat_b, (t_b - t_a) / 60_000)

    rows = []
    for i in range(num_points):
        frac = i / max(num_points - 1, 1)
        rows.append({
            "geometry": Point(lng_a + frac * (lng_b - lng_a), lat_a + frac * (lat_b - lat_a)),
            "_timestamp": t_a + frac * (t_b - t_a),
        })
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def _build_per_point_ppa_roads(
    gdf: gpd.GeoDataFrame,
    time_field: str,
    speed_ms: float,
    buffer_meters: float = 100.0,
    road_network_data: dict | None = None,
    road_network_path: str | None = None,
) -> tuple[gpd.GeoDataFrame | None, gpd.GeoDataFrame | None, list[str]]:
    """Compute per-segment PPA ellipses along a trajectory and clip road network.

    For each consecutive pair (Pᵢ, Pᵢ₊₁):
      PPA = { X : dist(Pᵢ, X) + dist(X, Pᵢ₊₁) ≤ speed × Δt }
    Roads are clipped per PPA and lifted to 3D.

    Returns (buffer_gdf, road_gdf, warnings).
    """
    warnings: list[str] = []

    if not all(gdf.geometry.geom_type == "Point"):
        return None, None, ["PPA road network requires Point geometries"]
    if len(gdf) < 2:
        return None, None, ["At least 2 trajectory points needed"]

    ppas, xs, ys, timestamps, metric_crs = _build_segment_ppas(
        gdf, time_field, speed_ms, buffer_meters,
    )
    if not ppas:
        return None, None, ["No PPA segments could be computed"]

    n = len(xs)
    t_min, t_max = int(timestamps.min()), int(timestamps.max())
    t_range = t_max - t_min if t_max != t_min else 1
    bounds = gdf.total_bounds
    total_height = max(
        (max(bounds[2] - bounds[0], bounds[3] - bounds[1], 1e-9)) * 111_000 * 0.5,
        1000.0,
    )

    def _z_at(i: int) -> float:
        return (timestamps[i] - t_min) / t_range * total_height

    # Reproject PPAs to WGS-84 for output
    ppas_gdf_metric = gpd.GeoDataFrame(
        [{"geometry": poly, "_seg": seg} for seg, poly in ppas], crs=metric_crs,
    )
    ppas_wgs84 = ppas_gdf_metric.to_crs("EPSG:4326")
    ppa_bounds = ppas_wgs84.total_bounds
    bbox = (float(ppa_bounds[0]), float(ppa_bounds[1]),
            float(ppa_bounds[2]), float(ppa_bounds[3]))

    # Load road network
    opts = RoadNetworkSTPOptions(
        speedMode="custom", customSpeed=speed_ms * 3.6,
        bufferMeters=buffer_meters, roadNetworkData=road_network_data,
        roadNetworkPath=road_network_path,
    )
    road_network, osm_fetched = _load_road_network(opts, metric_crs, bbox_wgs84=bbox)
    if road_network is None:
        warnings.append("No road network found for the trajectory area.")
        return None, None, warnings
    if osm_fetched:
        warnings.append("Road network auto-fetched from OpenStreetMap.")

    # Build PPA polygon features (3D)
    buffer_features: list[dict] = []
    for row_idx in range(len(ppas_wgs84)):
        seg_i = int(ppas_gdf_metric.iloc[row_idx]["_seg"])
        z = _z_at(seg_i)
        t_frac = (timestamps[seg_i] - t_min) / t_range
        next_z = _z_at(min(seg_i + 1, n - 1))
        color_rgba = [
            round(11 + (201 - 11) * t_frac),
            round(114 + (42 - 114) * t_frac),
            round(133 + (42 - 133) * t_frac),
            150,
        ]
        buffer_features.append({
            "geometry": _lift_geom_z(ppas_wgs84.geometry.iloc[row_idx], z),
            "_time_order": t_frac,
            "_z_base": z,
            PROCESSED_HEIGHT_FIELD: max(next_z - z, 1.0),
            "_timestamp": float(timestamps[seg_i]),
            "_dataset_type": "road-network-stp-buffer",
            "color_rgba": color_rgba,
        })

    # Clip roads per segment PPA
    clipped_road_features: list[dict] = []
    for seg_i, ppa_metric in ppas:
        z = _z_at(seg_i)
        t_frac = (timestamps[seg_i] - t_min) / t_range
        color_rgba = [
            round(11 + (201 - 11) * t_frac),
            round(114 + (42 - 114) * t_frac),
            round(133 + (42 - 133) * t_frac),
            255,
        ]
        candidate_idx = road_network.sindex.query(ppa_metric, predicate="intersects")
        if len(candidate_idx) == 0:
            continue
        candidates = road_network.iloc[candidate_idx].copy()
        candidates.geometry = candidates.geometry.intersection(ppa_metric)
        candidates = candidates[candidates.geometry.notna() & ~candidates.geometry.is_empty]
        candidates = candidates.explode(index_parts=False, ignore_index=True)
        candidates = candidates[
            candidates.geometry.geom_type.isin(["LineString", "MultiLineString"])
        ]
        if candidates.empty:
            continue
        clipped_wgs84 = candidates.to_crs("EPSG:4326")
        for _, row in clipped_wgs84.iterrows():
            road_row: dict = {
                "geometry": _lift_geom_z(row.geometry, z),
                "_time_order": t_frac,
                "_z_base": z,
                PROCESSED_HEIGHT_FIELD: z,
                "_timestamp": float(timestamps[seg_i]),
                "_dataset_type": "road-network-minute-segment",
                "color_rgba": color_rgba,
            }
            for col_name in clipped_wgs84.columns:
                if col_name != "geometry" and col_name not in road_row:
                    road_row[col_name] = _json_safe(row.get(col_name))
            clipped_road_features.append(road_row)

    warnings.append(
        f"PPA road network: {len(clipped_road_features)} clipped segments "
        f"across {len(ppas)} per-segment PPAs."
    )

    buf_gdf = gpd.GeoDataFrame(buffer_features, crs="EPSG:4326") if buffer_features else None
    road_gdf = gpd.GeoDataFrame(clipped_road_features, crs="EPSG:4326") if clipped_road_features else None
    return buf_gdf, road_gdf, warnings
