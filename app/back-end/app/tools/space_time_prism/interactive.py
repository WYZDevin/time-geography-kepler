"""Standalone functions for interactive and anchor-based prism execution."""
from __future__ import annotations

from time import perf_counter
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point
from shapely.ops import unary_union

from ...constants import PROCESSED_HEIGHT_FIELD
from .network_prism import execute_network_anchor_prism
from .road_network import _parse_timestamps
from .timing import log_phase
from .utils import (
    SPEED_PRESETS,
    _anchor_label,
    _anchor_timestamp_ms,
    _create_circle,
    _haversine_meters,
    _identify_anchors,
    _lift_polygon_z,
    _optimal_z_height,
)
from .prism_geometry import (
    _euclidean_anchor_prism_rows,
    _network_anchor_prism_rows,
)


def execute_interactive_prism(
    gdf: gpd.GeoDataFrame,
    options: dict[str, Any],
    attributes: dict[str, Any],
) -> list[gpd.GeoDataFrame]:
    """Build prism slices and PPA from a sorted Point trajectory.

    gdf columns:
        geometry     : Point            required
        <time_field> : str | numeric    required when _anchorA/_anchorB absent
                                        from options; column named by attributes["time"]
    """
    anchor_a = options.get("_anchorA")
    anchor_b = options.get("_anchorB")
    if isinstance(anchor_a, dict) and isinstance(anchor_b, dict):
        time_field = attributes.get("time") if attributes else None
        return execute_anchor_prism(anchor_a, anchor_b, options, gdf=gdf, time_field=time_field)

    _t = perf_counter()
    time_field = attributes.get("time")
    if not time_field or time_field not in gdf.columns:
        raise ValueError(f"Time attribute '{time_field}' not found in data")

    if not all(gdf.geometry.geom_type == "Point"):
        raise ValueError("Space-Time Prism requires Point geometries")

    # Parse timestamps and sort. format="mixed" infers per element so files
    # mixing string formats (e.g. "11/4/2022 0:07" and "2022-09-15 00:02:35")
    # parse; numeric columns keep the default path.
    time_col = gdf[time_field]
    if pd.api.types.is_numeric_dtype(time_col):
        timestamps = pd.to_datetime(time_col)
    else:
        timestamps = pd.to_datetime(time_col, format="mixed")
    if hasattr(timestamps.dt, "tz") and timestamps.dt.tz is not None:
        timestamps = timestamps.dt.tz_localize(None)
    epoch_ms = timestamps.astype("datetime64[ms]").astype(np.int64).values
    order = np.argsort(epoch_ms)
    gdf = gdf.iloc[order].reset_index(drop=True)
    epoch_ms = epoch_ms[order]

    # Speed
    speed_mode = options.get("speedMode", "walking")
    speed_kmh = (
        options.get("customSpeed", 5) if speed_mode == "custom" else SPEED_PRESETS.get(speed_mode, 5)
    )
    speed_ms = speed_kmh * 1000 / 3600  # m/s

    num_slices = int(options.get("timeSlices", 10))
    show_ppa = options.get("showPPA", True)

    # Z-axis height
    bounds = gdf.total_bounds
    total_height = _optimal_z_height(bounds[0], bounds[2], bounds[1], bounds[3])
    t_min, t_max = epoch_ms.min(), epoch_ms.max()
    t_range = t_max - t_min if t_max != t_min else 1

    coords_x = gdf.geometry.x.values
    coords_y = gdf.geometry.y.values
    n = len(gdf)

    # Identify meaningful anchors (skip dense GPS pings)
    anchors = _identify_anchors(coords_x, coords_y, epoch_ms, n)
    _t = log_phase(f"interactive-prism: parse + sort {n} points", _t)

    prism_rows = []
    ppa_polys = []
    feasible = 0
    infeasible = 0

    for ai in range(len(anchors) - 1):
        i1, i2 = anchors[ai], anchors[ai + 1]
        x1, y1, t1 = coords_x[i1], coords_y[i1], epoch_ms[i1]
        x2, y2, t2 = coords_x[i2], coords_y[i2], epoch_ms[i2]
        dt = (t2 - t1) / 1000  # seconds
        dist = _haversine_meters(x1, y1, x2, y2)

        if dist > speed_ms * dt:
            infeasible += 1
            continue
        feasible += 1

        slice_height = total_height / (t_range / 1000) * (dt / num_slices)

        for s in range(1, num_slices):
            t_frac = s / num_slices
            t_current = t1 + t_frac * (t2 - t1)
            time_progress = (t_current - t_min) / t_range
            z_height = time_progress * total_height

            dt_fwd = (t_current - t1) / 1000
            dt_bwd = (t2 - t_current) / 1000
            r1 = speed_ms * dt_fwd
            r2 = speed_ms * dt_bwd

            if r1 <= 0 or r2 <= 0:
                continue

            c1 = _create_circle(x1, y1, r1)
            c2 = _create_circle(x2, y2, r2)

            cross = c1.intersection(c2)
            if cross.is_empty:
                continue

            # Lift polygon vertices to Z height for 3D positioning
            cross_3d = _lift_polygon_z(cross, z_height)

            prism_rows.append(
                {
                    "geometry": cross_3d,
                    "_segment": ai,
                    "_slice": s,
                    "_time_progress": time_progress,
                    "_timestamp": float(t_current),
                    PROCESSED_HEIGHT_FIELD: slice_height,
                    "z": z_height,
                    "_dataset_type": "space-time-prism",
                }
            )

            if show_ppa:
                ppa_polys.append(cross)

    _t = log_phase(
        f"interactive-prism: slice loop ({feasible} feasible segments, {len(prism_rows)} slices)", _t,
    )

    outputs = []

    # 1. Prism slices (3D-lifted polygons)
    if prism_rows:
        prism_gdf = gpd.GeoDataFrame(prism_rows, crs="EPSG:4326")
        prism_gdf["_layer_config"] = "prism-3d"
        outputs.append(prism_gdf)
    else:
        outputs.append(gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"))

    # 2. Trajectory line (same style as 3D Trajectory tool)
    traj_rows = []
    for i in range(n):
        tp = (epoch_ms[i] - t_min) / t_range
        traj_rows.append(
            {
                "geometry": Point(coords_x[i], coords_y[i], tp * total_height),
                "_timestamp": float(epoch_ms[i]),
                "_time_progress": tp,
                PROCESSED_HEIGHT_FIELD: tp * total_height,
                "_dataset_type": "prism-trajectory",
                "_layer_config": "trajectory-3d",
            }
        )
    for col in gdf.columns:
        if col != "geometry":
            for j, row in enumerate(traj_rows):
                row[col] = gdf.iloc[j][col]
    traj_gdf = gpd.GeoDataFrame(traj_rows, crs="EPSG:4326")
    outputs.append(traj_gdf)

    # 3. PPA (2D projection)
    if show_ppa and ppa_polys:
        ppa_union = unary_union(ppa_polys)
        ppa_area = ppa_union.area * (111_000**2)  # approximate m²
        ppa_gdf = gpd.GeoDataFrame(
            [
                {
                    "geometry": ppa_union,
                    "_ppa_total_area_m2": ppa_area,
                    "_ppa_total_area_km2": ppa_area / 1e6,
                    "_speed_kmh": speed_kmh,
                    "_feasible_segments": feasible,
                    "_infeasible_segments": infeasible,
                    "_dataset_type": "potential-path-area",
                    "_layer_config": "ppa-2d",
                }
            ],
            crs="EPSG:4326",
        )
        outputs.append(ppa_gdf)

    # 4. Anchor points with 3D positions
    anchor_rows = []
    for i in range(n):
        tp = (epoch_ms[i] - t_min) / t_range
        anchor_rows.append(
            {
                "geometry": Point(coords_x[i], coords_y[i], tp * total_height),
                "_timestamp": float(epoch_ms[i]),
                "_time_progress": tp,
                PROCESSED_HEIGHT_FIELD: tp * total_height,
                "latitude": coords_y[i],
                "longitude": coords_x[i],
                "_dataset_type": "prism-anchors",
                "_layer_config": "anchor-points",
            }
        )
    for col in gdf.columns:
        if col != "geometry":
            for j, row in enumerate(anchor_rows):
                row[col] = gdf.iloc[j][col]

    anchor_gdf = gpd.GeoDataFrame(anchor_rows, crs="EPSG:4326")
    outputs.append(anchor_gdf)

    log_phase("interactive-prism: build trajectory/PPA/anchor outputs", _t)
    return outputs


def execute_anchor_prism(
    anchor_a: dict,
    anchor_b: dict,
    options: dict[str, Any],
    gdf: gpd.GeoDataFrame | None = None,
    time_field: str | None = None,
) -> list[gpd.GeoDataFrame]:
    """Compute an explanatory prism from two UI-selected anchors on the backend.

    gdf (optional) GPS trajectory — only used to align the prism's Z scale with
        the rendered trajectory height; the two-anchor network prism itself is
        defined purely by the two picked anchors.
    """
    required = ("lng", "lat")
    if any(key not in anchor_a for key in required) or any(key not in anchor_b for key in required):
        raise ValueError("Interactive Space-Time Prism requires anchors with lng and lat")

    p1 = {
        "lng": float(anchor_a["lng"]),
        "lat": float(anchor_a["lat"]),
        "alt": float(anchor_a.get("alt", 0.0) or 0.0),
        "timestamp": _anchor_timestamp_ms(anchor_a),
        "label": _anchor_label(anchor_a, "Anchor A"),
    }
    p2 = {
        "lng": float(anchor_b["lng"]),
        "lat": float(anchor_b["lat"]),
        "alt": float(anchor_b.get("alt", 0.0) or 0.0),
        "timestamp": _anchor_timestamp_ms(anchor_b),
        "label": _anchor_label(anchor_b, "Anchor B"),
    }
    if p2["timestamp"] < p1["timestamp"]:
        p1, p2 = p2, p1

    duration_minutes = float(options.get("durationMinutes") or 0)
    if p1["timestamp"] == p2["timestamp"]:
        if duration_minutes <= 0:
            raise ValueError("Selected anchors need different timestamps or a durationMinutes fallback")
        now_ms = int(pd.Timestamp.utcnow().timestamp() * 1000)
        p1["timestamp"] = now_ms
        p2["timestamp"] = now_ms + int(duration_minutes * 60_000)

    dt_s = (p2["timestamp"] - p1["timestamp"]) / 1000
    if dt_s <= 0:
        raise ValueError("Selected anchor time window must be positive")

    speed_mode = options.get("speedMode", "walking")
    speed_kmh = (
        float(options.get("customSpeed", 5))
        if speed_mode == "custom"
        else float(SPEED_PRESETS.get(speed_mode, 5))
    )
    if speed_kmh <= 0:
        raise ValueError("Travel speed must be greater than zero")
    speed_ms = speed_kmh * 1000 / 3600

    num_slices = max(2, int(options.get("timeSlices", 15)))
    show_ppa = options.get("showPPA", True) is not False
    prism_mode = str(options.get("prismMode") or "euclidean").lower()

    # The gps-road-network prism uses anchors picked from the actual GPS
    # trajectory, so reachability is guaranteed by the observed path —
    # skip the straight-line speed × time feasibility check, which would
    # otherwise reject anchors when the trajectory is non-straight.
    if prism_mode != "gps-road-network":
        dist_m = _haversine_meters(p1["lng"], p1["lat"], p2["lng"], p2["lat"])
        max_dist_m = speed_ms * dt_s
        if dist_m > max_dist_m:
            raise ValueError(
                "Selected anchors are infeasible: "
                f"{dist_m / 1000:.2f} km exceeds {max_dist_m / 1000:.2f} km reachable "
                f"at {speed_kmh:g} km/h over {dt_s / 60:.0f} minutes"
            )

    # Compute total_height from the full trajectory bounds to match the
    # trajectory tool's Z scale. Fall back to anchor-distance formula when
    # no trajectory data is present.
    total_height: float
    t_min_all: float
    t_range_all: float
    if gdf is not None and not gdf.empty:
        bounds = gdf.total_bounds
        total_height = _optimal_z_height(float(bounds[0]), float(bounds[2]), float(bounds[1]), float(bounds[3]))
        raw_ts: np.ndarray | None = None
        for tf in ([time_field] if time_field else []) + ["_timestamp", "timestamp", "time"]:
            if tf and tf in gdf.columns:
                try:
                    raw_ts = _parse_timestamps(gdf, tf)
                    break
                except Exception:
                    pass
        if raw_ts is not None and len(raw_ts) >= 2:
            t_min_all = float(raw_ts.min())
            t_range_all = max(float(raw_ts.max()) - t_min_all, 1.0)
        else:
            t_min_all = float(p1["timestamp"])
            t_range_all = max(float(p2["timestamp"]) - t_min_all, 1.0)
    else:
        anchor_dist_deg = max(abs(p2["lng"] - p1["lng"]), abs(p2["lat"] - p1["lat"]), 0.001)
        total_height = min(anchor_dist_deg * 111_000, 5000.0)
        t_min_all = float(p1["timestamp"])
        t_range_all = max(float(p2["timestamp"]) - t_min_all, 1.0)

    z_start = (float(p1["timestamp"]) - t_min_all) / t_range_all * total_height
    z_end = (float(p2["timestamp"]) - t_min_all) / t_range_all * total_height
    prism_height = max(z_end - z_start, 1.0)
    # Use global total_height for extrusion so buffers stay visible even when
    # the anchor window is a small fraction of the full trajectory time range.
    slice_height = total_height / num_slices

    if prism_mode == "gps-road-network":
        # Two-anchor network prism: forward Dijkstra from A + backward from B,
        # intersected where travel(A→x) + travel(x→B) + activity ≤ T. The Z
        # scale is passed through so the prism lines up with the trajectory height.
        return execute_network_anchor_prism(
            p1, p2, options,
            z_start=z_start, z_end=z_end, total_height=total_height,
            trajectory_gdf=gdf, time_field=time_field,
        )
    elif prism_mode == "network":
        _t = perf_counter()
        prism_rows, ppa_polys = _network_anchor_prism_rows(
            p1, p2, speed_ms, dt_s, num_slices, prism_height, slice_height, show_ppa, z_start
        )
        _t = log_phase(f"anchor-prism: network geometry ({len(prism_rows)} slices)", _t)
    else:
        _t = perf_counter()
        prism_rows, ppa_polys = _euclidean_anchor_prism_rows(
            p1, p2, speed_ms, dt_s, num_slices, prism_height, slice_height, show_ppa, z_start
        )
        _t = log_phase(f"anchor-prism: euclidean geometry ({len(prism_rows)} slices)", _t)

    outputs = []
    if prism_rows:
        outputs.append(gpd.GeoDataFrame(prism_rows, crs="EPSG:4326"))

    traj_rows = [
        {
            "geometry": Point(p1["lng"], p1["lat"], z_start),
            "_timestamp": float(p1["timestamp"]),
            "_time_progress": 0,
            PROCESSED_HEIGHT_FIELD: z_start,
            "z": z_start,
            "anchor_label": p1["label"],
            "_dataset_type": "prism-trajectory",
            "_layer_config": "trajectory-3d",
        },
        {
            "geometry": Point(p2["lng"], p2["lat"], z_end),
            "_timestamp": float(p2["timestamp"]),
            "_time_progress": 1,
            PROCESSED_HEIGHT_FIELD: z_end,
            "z": z_end,
            "anchor_label": p2["label"],
            "_dataset_type": "prism-trajectory",
            "_layer_config": "trajectory-3d",
        },
    ]
    outputs.append(gpd.GeoDataFrame(traj_rows, crs="EPSG:4326"))

    if show_ppa and ppa_polys:
        ppa_union = unary_union(ppa_polys)
        ppa_area = ppa_union.area * (111_000**2)
        outputs.append(gpd.GeoDataFrame(
            [{
                "geometry": ppa_union,
                "_ppa_total_area_m2": ppa_area,
                "_ppa_total_area_km2": ppa_area / 1e6,
                "_speed_kmh": speed_kmh,
                "_time_span_min": dt_s / 60,
                "_distance_m": dist_m,
                "_dataset_type": "potential-path-area",
                "_layer_config": "ppa-2d",
            }],
            crs="EPSG:4326",
        ))

    anchor_rows = [
        {
            "geometry": Point(p1["lng"], p1["lat"], z_start),
            "_timestamp": float(p1["timestamp"]),
            "_time_progress": 0,
            PROCESSED_HEIGHT_FIELD: z_start,
            "z": z_start,
            "anchor_role": "start_anchor",
            "anchor_label": p1["label"],
            "_dataset_type": "prism-anchors",
            "_layer_config": "anchor-points",
        },
        {
            "geometry": Point(p2["lng"], p2["lat"], z_end),
            "_timestamp": float(p2["timestamp"]),
            "_time_progress": 1,
            PROCESSED_HEIGHT_FIELD: z_end,
            "z": z_end,
            "anchor_role": "end_anchor",
            "anchor_label": p2["label"],
            "_dataset_type": "prism-anchors",
            "_layer_config": "anchor-points",
        },
    ]
    outputs.append(gpd.GeoDataFrame(anchor_rows, crs="EPSG:4326"))

    if not outputs:
        raise ValueError("No prism could be computed for the selected anchors")
    log_phase("anchor-prism: build trajectory/PPA/anchor outputs", _t)
    return outputs
