"""Standalone functions for PASTA dwell-time surface execution."""
from __future__ import annotations

import logging
import math
from collections import defaultdict
from time import perf_counter
from typing import Any

import geopandas as gpd
import numpy as np
from shapely.geometry import Polygon

import h3

from ...constants import PROCESSED_HEIGHT_FIELD
from .road_network import _parse_timestamps
from .utils import (
    SPEED_PRESETS,
    _anchor_timestamp_ms,
    _cell_polygon,
    _create_circle,
    _deduplicate_circles_by_location,
    _h3_cell_boundary,
    _h3_cell_latlng,
    _haversine_batch,
    _haversine_meters,
    _lift_polygon_z,
    _option_list,
    _speed_for_mode,
)
from .ppa import (
    _build_per_point_ppa_roads,
    _interpolate_trajectory,
)
from .pasta import (
    _anchor_rows,
    _build_activity_episodes,
    _build_anchor_windows,
)
from .timing import log_phase

logger = logging.getLogger(__name__)


def execute_h3_pasta(
    gdf: gpd.GeoDataFrame,
    options: dict[str, Any],
    attributes: dict[str, Any],
) -> list[gpd.GeoDataFrame]:
    """Per-GPS-point circle-based PASTA.

    For each trajectory point C with end anchor B:
      budget = (t_B - t_C) / 1000 - min_dwell_s
      PPA    = circle centred at C, radius = speed × budget / 2
      dwell(hex X) = budget - 2 × dist(C, X) / speed

    Outputs:
      [0] H3 hex surface  — accumulated dwell_minutes per cell (pasta-aggregate-surface)
      [1] PPA circles     — one polygon per GPS point, stacked 3-D by time (pasta-ppa-circles)
    """
    anchor_a = options["anchorA"]
    anchor_b = options["anchorB"]

    logger.info("_execute_h3_pasta: anchorA=(%.4f,%.4f,ts=%s) anchorB=(%.4f,%.4f,ts=%s)",
                anchor_a.get("lng"), anchor_a.get("lat"), anchor_a.get("timestamp"),
                anchor_b.get("lng"), anchor_b.get("lat"), anchor_b.get("timestamp"))
    logger.info("  input gdf: %d rows, empty=%s", len(gdf) if gdf is not None else 0,
                gdf is None or gdf.empty)

    speed_mode = str(options.get("speedMode", "walking"))
    if speed_mode == "custom":
        speed_ms = float(options.get("customSpeed", 5.0)) / 3.6
    else:
        speed_ms = SPEED_PRESETS.get(speed_mode, 5) * 1000 / 3600

    resolution = max(7, min(12, int(options.get("h3Resolution", 9))))
    min_dwell_s = float(options.get("minimumActivityMinutes", 10)) * 60
    duration_minutes = float(options.get("durationMinutes", 45))

    logger.info("  speed=%.2f m/s (%.1f km/h), h3_res=%d, min_dwell=%ds",
                speed_ms, speed_ms * 3.6, resolution, int(min_dwell_s))

    _t = perf_counter()
    traj_gdf, time_field = get_pasta_trajectory(gdf, attributes, anchor_a, anchor_b, duration_minutes)
    logger.info("  trajectory: %d points, time_field=%s", len(traj_gdf), time_field)
    _t = log_phase(f"h3-pasta: get/interpolate trajectory ({len(traj_gdf)} points)", _t)

    timestamps = _parse_timestamps(traj_gdf, time_field)
    order = np.argsort(timestamps)
    traj_gdf = traj_gdf.iloc[order].reset_index(drop=True)
    timestamps = timestamps[order]

    # End-anchor timestamp (milliseconds)
    t_B_ms = _anchor_timestamp_ms(anchor_b)
    if t_B_ms <= 0:
        t_B_ms = int(timestamps[-1])
    t_B_s = t_B_ms / 1000.0

    n = len(traj_gdf)
    t_min, t_max = int(timestamps.min()), int(timestamps.max())
    t_range = max(t_max - t_min, 1)

    bounds = traj_gdf.total_bounds
    total_height = max(
        (max(bounds[2] - bounds[0], bounds[3] - bounds[1], 1e-9)) * 111_000 * 0.5,
        1000.0,
    )
    slice_height = max(total_height / n, 10.0)

    dwell_accumulator: dict[str, float] = defaultdict(float)
    circle_features: list[dict] = []
    n_skipped = 0

    lat_B = float(anchor_b.get("lat", 0))
    lng_B = float(anchor_b.get("lng", 0))

    for i in range(n):
        t_c_s = float(timestamps[i]) / 1000.0
        lng = float(traj_gdf.geometry.iloc[i].x)
        lat = float(traj_gdf.geometry.iloc[i].y)

        dist_to_B_m = _haversine_meters(lng, lat, lng_B, lat_B)
        budget_s = t_B_s - t_c_s - dist_to_B_m / speed_ms - min_dwell_s
        if budget_s <= 0:
            n_skipped += 1
            continue

        radius_m = speed_ms * budget_s / 2.0
        if radius_m < 10.0:
            n_skipped += 1
            continue

        circle_poly = _create_circle(lng, lat, radius_m, steps=32)
        circle_geojson = {
            "type": "Polygon",
            "coordinates": [list(circle_poly.exterior.coords)],
        }

        try:
            cells = list(h3.geo_to_cells(circle_geojson, resolution))
        except AttributeError:
            cells = list(h3.polyfill(circle_geojson, resolution, geo_json_conformant=True))

        if not cells:
            n_skipped += 1
            continue

        # Vectorised dwell: budget - 2 * dist(C, hex) / speed
        centroids = np.array([_h3_cell_latlng(c) for c in cells])
        cell_lats, cell_lngs = centroids[:, 0], centroids[:, 1]
        dists_m = _haversine_batch(lat, lng, cell_lats, cell_lngs)
        dwells_s = budget_s - 2.0 * dists_m / speed_ms

        for cell, dwell in zip(cells, dwells_s):
            if dwell > 0:
                dwell_accumulator[cell] += float(dwell)

        # Circle feature for 3-D visualisation (stacked by time progress)
        time_progress = (timestamps[i] - t_min) / t_range
        z = time_progress * total_height
        color_t = time_progress
        circle_features.append({
            "geometry": _lift_polygon_z(circle_poly, z),
            "_time_order": time_progress,
            "_z_base": z,
            PROCESSED_HEIGHT_FIELD: slice_height,
            "_timestamp": float(timestamps[i]),
            "_dataset_type": "pasta-ppa-circles",
            "budget_s": round(budget_s, 1),
            "radius_m": round(radius_m, 1),
            # kept for merge logic; not included in final GeoDataFrame columns
            "_center_lng": lng,
            "_center_lat": lat,
            "color_rgba": [
                round(11 + (201 - 11) * color_t),
                round(114 + (42 - 114) * color_t),
                round(133 + (42 - 133) * color_t),
                60,
            ],
        })

    logger.info("  %d points processed, %d skipped, %d cells with dwell>0",
                n - n_skipped, n_skipped, len(dwell_accumulator))
    _t = log_phase(
        f"h3-pasta: per-point H3 loop ({n - n_skipped}/{n} points, {len(dwell_accumulator)} cells)", _t,
    )

    if not dwell_accumulator:
        raise ValueError(
            "No reachable H3 cells. Try a faster travel mode or smaller minimum dwell time."
        )

    max_dwell_s = max(dwell_accumulator.values())
    h3_features: list[dict] = []
    for cell, total_dwell_s in dwell_accumulator.items():
        dwell_min = total_dwell_s / 60
        boundary = _h3_cell_boundary(cell)
        ring = [(lng, lat) for lat, lng in boundary]
        ring.append(ring[0])
        h3_features.append({
            "geometry": Polygon(ring),
            "h3_index": cell,
            "dwell_minutes": round(dwell_min, 2),
            "weighted_dwell_minutes": round(dwell_min, 2),
            "_dataset_type": "pasta-aggregate-surface",
            PROCESSED_HEIGHT_FIELD: max(20.0, (total_dwell_s / max_dwell_s) * 1000),
        })

    result_gdf = gpd.GeoDataFrame(h3_features, crs="EPSG:4326")
    warnings = [
        f"{len(h3_features):,} reachable H3 cells (resolution {resolution}); "
        f"max dwell {max_dwell_s / 60:.1f} min; "
        f"{n - n_skipped}/{n} trajectory points contributed."
    ]
    result_gdf.attrs["warnings"] = warnings

    outputs: list[gpd.GeoDataFrame] = [result_gdf]
    if circle_features:
        merged = _deduplicate_circles_by_location(circle_features)
        logger.info("  circle dedup: %d → %d circles", len(circle_features), len(merged))
        # drop internal centre fields before serialising
        for f in merged:
            f.pop("_center_lng", None)
            f.pop("_center_lat", None)
        outputs.append(gpd.GeoDataFrame(merged, crs="EPSG:4326"))

    log_phase(f"h3-pasta: build {len(h3_features)} cell + circle outputs", _t)
    return outputs


def get_pasta_trajectory(
    gdf: gpd.GeoDataFrame,
    attributes: dict[str, Any],
    anchor_a: dict,
    anchor_b: dict,
    duration_minutes: float = 45,
) -> tuple[gpd.GeoDataFrame, str]:
    """Extract trajectory points from input data, or interpolate if none available.

    Returns (gdf, time_field) — the time_field names the column to pass to
    _parse_timestamps (parsed exactly once, in _build_segment_ppas).
    """
    if gdf is not None and not gdf.empty:
        points = gdf[gdf.geometry.geom_type == "Point"].copy()
        logger.info("_get_pasta_trajectory: %d input rows, %d Point features, columns=%s",
                    len(gdf), len(points), list(gdf.columns))
        if len(points) >= 2:
            time_field = None
            for candidate in ([attributes.get("time")] if attributes else []) + ["_timestamp", "timestamp", "time"]:
                if candidate and candidate in points.columns:
                    time_field = candidate
                    break
            if time_field:
                col = points[time_field]
                sample = None
                if len(col.dropna()) > 0:
                    sample = float(col.dropna().iloc[0])
                has_range = col.max() != col.min() if sample is not None else False
                logger.info("  time_field=%s, sample=%s, has_range=%s",
                            time_field, sample, has_range)
                if has_range:
                    logger.info("  → using %d real trajectory points (time_field=%s)",
                                len(points), time_field)
                    return points, time_field
                logger.info("  → timestamps all equal, falling back to interpolation")
            else:
                logger.info("  → no time field found, falling back to interpolation")
    else:
        logger.info("_get_pasta_trajectory: input gdf is empty, falling back to interpolation")
    return _interpolate_trajectory(anchor_a, anchor_b, duration_minutes=duration_minutes), "_timestamp"


def execute_pasta(
    gdf: gpd.GeoDataFrame,
    options: dict[str, Any],
    attributes: dict[str, Any],
) -> list[gpd.GeoDataFrame]:
    """Compute PASTA dwell-time surfaces.

    Two modes:
    - H3 two-anchor mode: when anchorA/anchorB are present in options,
      computes H3 hexagon reachability between two anchors.
    - Activity-schedule mode: when input data contains activity episodes
      with person IDs, computes person-based PASTA across all anchor windows.
    """
    anchor_a = options.get("anchorA")
    anchor_b = options.get("anchorB")
    if isinstance(anchor_a, dict) and isinstance(anchor_b, dict):
        return execute_h3_pasta(gdf, options, attributes)

    if gdf.empty:
        raise ValueError("PASTA requires at least one activity episode")
    if not all(gdf.geometry.geom_type == "Point"):
        raise ValueError("PASTA requires Point geometries representing activity locations")

    time_field = attributes.get("time") or options.get("startTimeField") or "start_time"
    if not time_field or time_field not in gdf.columns:
        raise ValueError(f"Start time attribute '{time_field}' not found in data")

    person_field = options.get("personIdField") or "person_id"
    activity_field = options.get("activityTypeField") or "activity_type"
    end_time_field = options.get("endTimeField") or ""
    mode_field = options.get("modeField") or ""
    weight_field = options.get("weightField") or ""

    fixed_types = _option_list(
        options,
        "fixedActivityTypes",
        ["home", "work", "school", "hospital", "errand", "worship", "family", "friend"],
    )
    flexible_types = _option_list(
        options,
        "flexibleActivityTypes",
        ["shopping", "restaurant", "recreation", "entertainment", "leisure"],
    )

    min_dwell_min = float(options.get("minimumActivityMinutes", 10))
    temporal_resolution_min = float(options.get("temporalResolutionMinutes", 5))
    spatial_resolution_m = float(options.get("spatialResolutionMeters", 250))
    max_grid_cells = int(options.get("maxGridCells", 12000))
    max_voxels = int(options.get("maxVoxels", 6000))
    emit_voxels = bool(options.get("showVoxels", True))
    scenario_name = str(options.get("scenarioName") or "baseline")

    speed_mode = options.get("speedMode", "walking")
    speed_kmh = (
        float(options.get("customSpeed", 5))
        if speed_mode == "custom"
        else float(SPEED_PRESETS.get(speed_mode, 5))
    )
    if speed_kmh <= 0:
        raise ValueError("Travel speed must be greater than zero")

    _t = perf_counter()
    episodes = _build_activity_episodes(
        gdf,
        time_field=time_field,
        end_time_field=str(end_time_field),
        person_field=str(person_field),
        activity_field=str(activity_field),
        mode_field=str(mode_field),
        weight_field=str(weight_field),
        fixed_types=fixed_types,
        flexible_types=flexible_types,
        default_mode=str(speed_mode),
    )
    if not episodes:
        raise ValueError("No valid activity episodes could be parsed for PASTA")

    windows = _build_anchor_windows(episodes)
    if not windows:
        raise ValueError(
            "No valid fixed-anchor windows found. PASTA needs flexible activities bracketed by fixed activities."
        )
    _t = log_phase(
        f"activity-pasta: parse episodes + windows ({len(episodes)} episodes, {len(windows)} windows)", _t,
    )

    bounds = gdf.total_bounds
    max_budget_s = max((w.end.start_ms - w.start.end_ms) / 1000 for w in windows)
    max_window_speed_ms = max(_speed_for_mode(w.mode, speed_kmh)[1] for w in windows)
    buffer_deg = max((max_window_speed_ms * max_budget_s) / 111_000, spatial_resolution_m / 111_000) * 1.05
    min_lng, min_lat = bounds[0] - buffer_deg, bounds[1] - buffer_deg
    max_lng, max_lat = bounds[2] + buffer_deg, bounds[3] + buffer_deg

    cell_deg = spatial_resolution_m / 111_000
    cols = max(1, math.ceil((max_lng - min_lng) / cell_deg))
    rows = max(1, math.ceil((max_lat - min_lat) / cell_deg))
    if rows * cols > max_grid_cells:
        scale = math.sqrt((rows * cols) / max_grid_cells)
        cell_deg *= scale
        spatial_resolution_m *= scale
        cols = max(1, math.ceil((max_lng - min_lng) / cell_deg))
        rows = max(1, math.ceil((max_lat - min_lat) / cell_deg))

    aggregate = defaultdict(lambda: {
        "dwell_minutes": 0.0,
        "weighted_dwell_minutes": 0.0,
        "windows": 0,
        "persons": set(),
        "modes": set(),
    })
    voxel_rows = []
    anchor_rows = []
    excluded_windows = 0
    feasible_windows = 0

    global_start = min(w.start.end_ms for w in windows)
    global_end = max(w.end.start_ms for w in windows)
    time_range_ms = max(global_end - global_start, 1)
    total_height = max((global_end - global_start) / (60_000 * temporal_resolution_min) * 20, 1000)
    z_per_ms = total_height / time_range_ms
    bin_ms = int(temporal_resolution_min * 60_000)
    _t = log_phase(f"activity-pasta: setup grid ({rows}×{cols} cells)", _t)

    for window in windows:
        budget_s = (window.end.start_ms - window.start.end_ms) / 1000
        if budget_s <= 0:
            excluded_windows += 1
            continue

        window_speed_kmh, window_speed_ms = _speed_for_mode(window.mode, speed_kmh)
        anchor_dist = _haversine_meters(window.start.x, window.start.y, window.end.x, window.end.y)
        if anchor_dist / window_speed_ms + min_dwell_min * 60 > budget_s:
            excluded_windows += 1
            continue

        feasible_windows += 1
        anchor_rows.extend(_anchor_rows(window, global_start, z_per_ms, scenario_name))

        for row in range(rows):
            lat = min_lat + (row + 0.5) * cell_deg
            for col in range(cols):
                lng = min_lng + (col + 0.5) * cell_deg
                t_forward_s = _haversine_meters(window.start.x, window.start.y, lng, lat) / window_speed_ms
                t_reverse_s = _haversine_meters(lng, lat, window.end.x, window.end.y) / window_speed_ms
                dwell_s = budget_s - t_forward_s - t_reverse_s
                if dwell_s < min_dwell_min * 60:
                    continue

                dwell_min = dwell_s / 60
                key = (row, col)
                cell = aggregate[key]
                cell["dwell_minutes"] += dwell_min
                cell["weighted_dwell_minutes"] += dwell_min * window.weight
                cell["windows"] += 1
                cell["persons"].add(window.person_id)
                cell["modes"].add(window.mode)

                if emit_voxels and len(voxel_rows) < max_voxels:
                    earliest_ms = int(window.start.end_ms + t_forward_s * 1000)
                    latest_ms = int(window.end.start_ms - t_reverse_s * 1000)
                    first_bin = math.ceil((earliest_ms - global_start) / bin_ms)
                    last_bin = math.floor((latest_ms - global_start) / bin_ms)
                    for time_bin in range(first_bin, last_bin + 1):
                        if len(voxel_rows) >= max_voxels:
                            break
                        bin_start = global_start + time_bin * bin_ms
                        bin_end = bin_start + bin_ms
                        overlap_ms = max(0, min(latest_ms, bin_end) - max(earliest_ms, bin_start))
                        if overlap_ms <= 0:
                            continue
                        z = (bin_start - global_start) * z_per_ms
                        voxel_rows.append({
                            "geometry": _cell_polygon(min_lng, min_lat, cell_deg, col, row, z),
                            "_dataset_type": "pasta-voxels",
                            "_layer_config": "pasta-voxels",
                            "_time_progress": (bin_start - global_start) / time_range_ms,
                            "_timestamp": float(bin_start),
                            PROCESSED_HEIGHT_FIELD: max(4.0, temporal_resolution_min * 10),
                            "z": z,
                            "person_id": window.person_id,
                            "window_id": window.window_id,
                            "time_bin": time_bin,
                            "mode": window.mode,
                            "speed_kmh": window_speed_kmh,
                            "scenario": scenario_name,
                            "dwell_minutes": overlap_ms / 60_000,
                            "weighted_dwell_minutes": (overlap_ms / 60_000) * window.weight,
                            "spatial_resolution_m": spatial_resolution_m,
                            "temporal_resolution_min": temporal_resolution_min,
                        })

    if not aggregate:
        raise ValueError("No feasible PASTA cells were found with the current schedule and speed assumptions")
    _t = log_phase(
        f"activity-pasta: dwell loop ({feasible_windows} feasible windows, "
        f"{len(aggregate)} cells, {len(voxel_rows)} voxels)", _t,
    )

    max_weighted = max(v["weighted_dwell_minutes"] for v in aggregate.values())
    surface_rows = []
    for (row, col), values in aggregate.items():
        weighted = values["weighted_dwell_minutes"]
        surface_rows.append({
            "geometry": _cell_polygon(min_lng, min_lat, cell_deg, col, row),
            "_dataset_type": "pasta-aggregate-surface",
            "_layer_config": "pasta-surface",
            "row": row,
            "col": col,
            "dwell_minutes": values["dwell_minutes"],
            "weighted_dwell_minutes": weighted,
            "person_count": len(values["persons"]),
            "window_count": values["windows"],
            "mode": ",".join(sorted(values["modes"])),
            "scenario": scenario_name,
            "spatial_resolution_m": spatial_resolution_m,
            "temporal_resolution_min": temporal_resolution_min,
            "minimum_activity_minutes": min_dwell_min,
            "speed_kmh": speed_kmh,
            "feasible_windows": feasible_windows,
            "excluded_windows": excluded_windows,
            "pasta_unit": "population-weighted potential dwell minutes",
            PROCESSED_HEIGHT_FIELD: max(20.0, (weighted / max_weighted) * 1000),
        })

    outputs = [gpd.GeoDataFrame(surface_rows, crs="EPSG:4326")]
    if voxel_rows:
        outputs.append(gpd.GeoDataFrame(voxel_rows, crs="EPSG:4326"))
    if anchor_rows:
        outputs.append(gpd.GeoDataFrame(anchor_rows, crs="EPSG:4326"))

    # PPA road network for the first feasible anchor window
    speed_ms_val = speed_kmh * 1000 / 3600
    feasible = [w for w in windows
                if (w.end.start_ms - w.start.end_ms) / 1000 > 0
                and _haversine_meters(w.start.x, w.start.y, w.end.x, w.end.y)
                    / _speed_for_mode(w.mode, speed_kmh)[1] + min_dwell_min * 60
                    <= (w.end.start_ms - w.start.end_ms) / 1000]
    if feasible:
        w = feasible[0]
        traj_gdf = _interpolate_trajectory(
            {"lng": w.start.x, "lat": w.start.y, "timestamp": w.start.end_ms},
            {"lng": w.end.x, "lat": w.end.y, "timestamp": w.end.start_ms},
        )
        buf_gdf, road_gdf, _ = _build_per_point_ppa_roads(
            traj_gdf, "_timestamp", speed_ms_val,
            road_network_data=options.get("roadNetworkData"),
            road_network_path=options.get("roadNetworkPath"),
        )
        if buf_gdf is not None:
            outputs.append(buf_gdf)
        if road_gdf is not None:
            outputs.append(road_gdf)

    log_phase(f"activity-pasta: build {len(surface_rows)} surface + PPA outputs", _t)
    return outputs
