"""GPS road-network anchor prism.

For each GPS point between anchor A and anchor B, compute the PPA road-network
reachability using the undirected symmetric model from PPA_ESTIMATION.md:

    R = (T - A) / 2

where T = total time budget (sec) and A = minimum activity time (sec).
Reachable road segments are lifted to 3D where Z = (t - t1) / (t2 - t1) × height.

Outputs:
    [0] ppa-road-network          — reachable LineStrings stacked per GPS point,
                                    colored by activity_sec_min
    [1] ppa-origin-points         — origin GPS points at their 3D positions
    [2] prism-anchors             — anchor A/B markers (start/end)
"""
from __future__ import annotations

import logging
import math
import os
from typing import Any

import geopandas as gpd
import numpy as np
from shapely.geometry import Point

from ...constants import PROCESSED_HEIGHT_FIELD
from .road_network import (
    _auto_utm_crs,
    _lift_geom_z,
    _parse_timestamps as _parse_ts,
    _SPEED_MS,
)
from .ppa_engine import (
    compute_origin_ppa,
    compute_padded_extent,
    DijkstraWorkspace,
    fetch_or_cache_osm_roads,
    get_or_build_graph,
    is_extent_too_large,
    make_mode_profile,
)
from .ppa_engine.reachability import feature_linestring


logger = logging.getLogger(__name__)


# Hard cap on origins per request — protects against pathological trajectories
# (thousands of GPS points). Caller-overridable via options.maxOrigins.
DEFAULT_MAX_ORIGINS = 60


def execute_gps_road_network_anchor_prism(
    p1: dict,
    p2: dict,
    options: dict[str, Any],
    gdf: gpd.GeoDataFrame | None = None,
    time_field: str | None = None,
) -> list[gpd.GeoDataFrame]:
    """Per-GPS-point PPA road-network reachability prism.

    Options consumed:
        speedMode             walking|driving|cycling|transit|custom
        customSpeed           km/h, when speedMode == 'custom'
        totalBudgetMinutes    T — defaults to anchor time span / numOrigins × 4
        minActivityMinutes    A — defaults to 5
        maxOrigins            cap on GPS points sampled between anchors
        roadNetworkData       inline GeoJSON FeatureCollection of road LineStrings
        roadNetworkPath       optional file path (.geojson / .shp) for the road network
    """
    t1, t2 = int(p1["timestamp"]), int(p2["timestamp"])
    dt_ms = t2 - t1
    if dt_ms <= 0:
        raise ValueError("Anchor A must be earlier in time than Anchor B")

    speed_mode = str(options.get("speedMode", "walking"))
    custom_kmh = (
        float(options.get("customSpeed", 5.0)) if speed_mode == "custom" else None
    )
    profile = make_mode_profile(speed_mode, custom_speed_kmh=custom_kmh)

    min_activity_sec = max(0.0, float(options.get("minActivityMinutes", 5)) * 60.0)
    total_budget_min_raw = options.get("totalBudgetMinutes")

    max_origins = max(1, int(options.get("maxOrigins", DEFAULT_MAX_ORIGINS)))

    # ── Extract GPS points between anchors ──────────────────────────────
    # Each origin carries its own Z (taken straight from the GPS point's
    # coordinate, which the time-geography preprocessing has already lifted
    # to the time axis). PPA roads + summary points emitted for that origin
    # all reuse this same Z, so they sit at exactly the trajectory's height.
    origin_lons, origin_lats, origin_zs, origin_ts = _origin_points_between_anchors(
        p1, p2, gdf, time_field, dt_ms, max_origins,
    )
    if origin_lons is None:
        # Fallback: at least use the two anchors as origins so the user sees
        # *something* even with no trajectory.
        origin_lons = np.array([p1["lng"], p2["lng"]], dtype=np.float64)
        origin_lats = np.array([p1["lat"], p2["lat"]], dtype=np.float64)
        origin_zs = np.array(
            [float(p1.get("alt", 0.0) or 0.0), float(p2.get("alt", 0.0) or 0.0)],
            dtype=np.float64,
        )
        origin_ts = np.array([t1, t2], dtype=np.int64)

    # ── Pick a metric CRS centered on the trajectory ────────────────────
    centroid_lon = float(np.mean(origin_lons))
    centroid_lat = float(np.mean(origin_lats))
    metric_crs = options.get("metricCrs") or _auto_utm_crs(centroid_lon, centroid_lat)

    # ── Load the road network ───────────────────────────────────────────
    # Order of resolution per PPA_ESTIMATION.md §7 + §29:
    #   1. options.roadNetworkData  (inline GeoJSON from the frontend)
    #   2. options.roadNetworkPath  (server-side file path)
    #   3. OSM auto-download for the padded analysis extent  (default on)
    # Auto-download can be disabled with autoDownloadOSM=false to avoid
    # surprise Overpass calls during tests / offline use.
    roads_wgs84 = _load_road_network_gdf(options)
    osm_warnings: list[str] = []
    if roads_wgs84 is None and options.get("autoDownloadOSM", True):
        raw_cap = options.get("maxAnalysisAreaKm2")
        max_area_km2 = float(raw_cap) if raw_cap is not None else None
        roads_wgs84 = _try_auto_download_osm(
            origin_lons, origin_lats, profile,
            min_activity_sec=min_activity_sec,
            total_budget_min_raw=total_budget_min_raw,
            origin_ts=origin_ts,
            anchor_a=p1, anchor_b=p2,
            warnings=osm_warnings,
            max_area_km2=max_area_km2,
        )

    # ── 3D height scaling ───────────────────────────────────────────────
    # Z comes straight from the input geometry now:
    #   • origin GPS points → their own Z coordinate (set by time-geography)
    #   • anchors           → the `alt` field on each anchor dict
    # That keeps the PPA stack exactly aligned with the rendered trajectory,
    # regardless of how the frontend chose its Z scale.
    z_anchor_a = float(p1.get("alt", 0.0) or 0.0)
    z_anchor_b = float(p2.get("alt", 0.0) or 0.0)

    # ── Resolve total time budget T ─────────────────────────────────────
    # Done before the fallback paths so the origin-point summaries always
    # carry the correct dwell-time budget, even when there is no road network.
    total_budget_sec = _auto_total_budget_sec(
        total_budget_min_raw, origin_ts, min_activity_sec,
    )

    for msg in osm_warnings:
        logger.info("ppa-osm: %s", msg)

    outputs: list[gpd.GeoDataFrame] = []
    if roads_wgs84 is None or roads_wgs84.empty:
        # Without a road network there is nothing to clip — emit empty PPA layer
        # but still return origins (with dwell budget stubs) + anchors.
        outputs.append(_empty_gdf())
        outputs.append(_unreachable_origins_gdf(
            origin_lons, origin_lats, origin_zs, origin_ts,
            total_budget_sec, min_activity_sec,
        ))
        outputs.append(_anchors_gdf(p1, p2, t1, t2, z_anchor_a, z_anchor_b))
        return outputs

    # ── Build road graph + spatial index ONCE (cached across requests) ──
    # The prism explorer re-runs this on every slider tick; the cache keeps
    # the same graph alive so we only pay for the rebuild when the road
    # network or travel mode actually changes.
    graph, edge_index = get_or_build_graph(roads_wgs84, metric_crs, profile)
    if graph.n_edges == 0:
        outputs.append(_empty_gdf())
        outputs.append(_unreachable_origins_gdf(
            origin_lons, origin_lats, origin_zs, origin_ts,
            total_budget_sec, min_activity_sec,
        ))
        outputs.append(_anchors_gdf(p1, p2, t1, t2, z_anchor_a, z_anchor_b))
        return outputs
    workspace = DijkstraWorkspace(graph.n_nodes)

    # ── Per-origin PPA computation ──────────────────────────────────────
    # Per origin we keep:
    #   • flat segment features (output 0)            — for visualization
    #   • per-origin dwell-time summary (output 1)    — attached to origin point
    ppa_features: list[dict] = []
    origin_summaries: list[dict] = []
    origin_warnings = 0

    for i in range(len(origin_lons)):
        lon = float(origin_lons[i])
        lat = float(origin_lats[i])
        ts = int(origin_ts[i])
        # Z is taken directly from the GPS point's coordinate — same value
        # the rendered trajectory uses, so the PPA stack lines up exactly.
        z_base = float(origin_zs[i])
        # Anchor-window-relative progress, kept only for the descriptive
        # `_time_progress` field on the emitted features.
        time_progress = (ts - t1) / max(dt_ms, 1)

        result = compute_origin_ppa(
            graph=graph,
            origin_lon=lon, origin_lat=lat,
            total_budget_sec=total_budget_sec,
            min_activity_sec=min_activity_sec,
            max_snap_m=profile.max_snap_m,
            edge_index=edge_index,
            workspace=workspace,
        )
        if result is None:
            origin_warnings += 1
            # Still emit a stub summary so the origin layer always has one row
            # per GPS point — makes per-origin filtering on the frontend easy.
            origin_summaries.append(_unreachable_origin_summary(
                i, lon, lat, ts, time_progress, z_base,
                total_budget_sec, min_activity_sec,
            ))
            continue

        # Per-origin aggregates over the reachable PPA segments.
        seg_count = len(result.features)
        total_len_m = 0.0
        dwell_mids: list[float] = []
        for feat in result.features:
            total_len_m += _segment_length_m(graph, feat.edge_id, feat.interval_a, feat.interval_b)
            dwell_mids.append(float(feat.activity_sec_mid))

            line = feature_linestring(feat)
            line_3d = _lift_geom_z(line, z_base)
            # Pre-compute the RGBA so the frontend LineLayer can colour by
            # dwell time per-segment without recomputing the ramp in JS.
            rgba = _dwell_color_rgba(
                float(feat.activity_sec_min), min_activity_sec, total_budget_sec,
            )
            ppa_features.append({
                "geometry": line_3d,
                "origin_index": i,
                "origin_lon": lon,
                "origin_lat": lat,
                "origin_timestamp": ts,
                "_timestamp": float(ts),
                "_time_progress": time_progress,
                "z": z_base,
                PROCESSED_HEIGHT_FIELD: z_base,
                "edge_id": int(feat.edge_id),
                "highway": feat.highway,
                "travel_sec_min": float(feat.travel_sec_min),
                "travel_sec_mid": float(feat.travel_sec_mid),
                "travel_sec_max": float(feat.travel_sec_max),
                # PPA_ESTIMATION.md calls this "activity time" — we expose both names
                # to make the dwell-time interpretation explicit at the API boundary.
                "activity_sec_min": float(feat.activity_sec_min),
                "activity_sec_mid": float(feat.activity_sec_mid),
                "activity_sec_max": float(feat.activity_sec_max),
                "dwell_sec_min": float(feat.activity_sec_min),
                "dwell_sec_mid": float(feat.activity_sec_mid),
                "dwell_sec_max": float(feat.activity_sec_max),
                "cutoff_sec": float(result.cutoff_sec),
                "total_budget_sec": float(total_budget_sec),
                "min_activity_sec": float(min_activity_sec),
                "color_rgba": rgba,
                "_dataset_type": "ppa-road-network",
            })

        mean_dwell = (sum(dwell_mids) / len(dwell_mids)) if dwell_mids else float(min_activity_sec)
        origin_summaries.append({
            "origin_index": i,
            "origin_lon": lon,
            "origin_lat": lat,
            "origin_timestamp": ts,
            "_timestamp": float(ts),
            "_time_progress": time_progress,
            "z": z_base,
            PROCESSED_HEIGHT_FIELD: z_base,
            # Dwell-time budget (echoed for legend / tooltips)
            "total_budget_sec": float(total_budget_sec),
            "min_activity_sec": float(min_activity_sec),
            "cutoff_sec": float(result.cutoff_sec),
            # Per-origin dwell stats (also exposed as 'activity_sec' for API consistency)
            "dwell_sec_at_origin": float(total_budget_sec),       # zero travel → full budget
            "dwell_sec_max": float(total_budget_sec),
            "dwell_sec_min": float(min_activity_sec),             # at the reachable boundary
            "dwell_sec_mean": float(mean_dwell),
            "activity_sec_at_origin": float(total_budget_sec),
            "activity_sec_max": float(total_budget_sec),
            "activity_sec_min": float(min_activity_sec),
            "activity_sec_mean": float(mean_dwell),
            # PPA extent metrics
            "ppa_reachable_segments": int(seg_count),
            "ppa_reachable_length_m": float(total_len_m),
            "snap_distance_m": float(result.snap_distance_m),
            "reachable": True,
        })

    if origin_warnings:
        logger.info(
            "execute_gps_road_network_anchor_prism: %d/%d origins could not be snapped",
            origin_warnings, len(origin_lons),
        )

    if ppa_features:
        outputs.append(gpd.GeoDataFrame(ppa_features, crs="EPSG:4326"))
    else:
        outputs.append(_empty_gdf())

    outputs.append(_origins_gdf_with_dwell(
        origin_lons, origin_lats, origin_summaries,
    ))
    outputs.append(_anchors_gdf(p1, p2, t1, t2, z_anchor_a, z_anchor_b))
    return outputs


# ────────────────────────────────────────────────────────────────────────
# helpers
# ────────────────────────────────────────────────────────────────────────

def _auto_total_budget_sec(
    total_budget_min_raw: Any,
    origin_ts: np.ndarray,
    min_activity_sec: float,
) -> float:
    """Resolve the total time budget T (seconds).

    When the caller supplies ``totalBudgetMinutes`` explicitly, that wins.
    Otherwise T tracks the GPS sampling cadence between the chosen anchors:
    we use the median gap between consecutive samples — the time the user
    has between observations is the natural per-origin budget. A small
    floor of ``min_activity_sec + 60 s`` keeps R = (T − A) / 2 strictly
    positive so the PPA never degenerates to a point.

    Earlier versions multiplied the cadence by 4×, which made the OSM
    auto-download bbox blow past the per-mode area cap even for small,
    short trajectories — see PPA_ESTIMATION.md §25.
    """
    if total_budget_min_raw is not None:
        return float(total_budget_min_raw) * 60.0
    if len(origin_ts) >= 2:
        gap_s = float(np.median(np.diff(origin_ts))) / 1000.0
        return max(min_activity_sec + 60.0, gap_s)
    return min_activity_sec + 600.0


def _origin_points_between_anchors(
    p1: dict,
    p2: dict,
    gdf: gpd.GeoDataFrame | None,
    time_field: str | None,
    dt_ms: int,
    max_origins: int,
) -> tuple[np.ndarray | None, np.ndarray | None, np.ndarray | None, np.ndarray | None]:
    """Filter, sort, and uniformly subsample GPS points between p1 and p2.

    Returns (lons, lats, zs, ts). ``zs`` carries the per-point Z value taken
    directly from the GPS point's coordinate (the time-axis height already
    baked in by the time-geography preprocessing). Points without a Z
    coordinate get 0.
    """
    if gdf is None or gdf.empty or not all(gdf.geometry.geom_type == "Point"):
        return None, None, None, None

    t1, t2 = int(p1["timestamp"]), int(p2["timestamp"])

    timestamps = None
    for tf in ([time_field] if time_field else []) + ["_timestamp", "timestamp", "time"]:
        if tf and tf in gdf.columns:
            try:
                timestamps = _parse_ts(gdf, tf)
                break
            except Exception:  # pragma: no cover — defensive
                pass
    if timestamps is None:
        return None, None, None, None

    order = np.argsort(timestamps)
    gdf_sorted = gdf.iloc[order].reset_index(drop=True)
    ts_sorted = timestamps[order]

    margin_ms = max(int(dt_ms * 0.02), 15_000)
    mask = (ts_sorted >= t1 - margin_ms) & (ts_sorted <= t2 + margin_ms)
    if mask.sum() < 1:
        return None, None, None, None

    filtered = gdf_sorted[mask]
    filt_ts = ts_sorted[mask]
    lons = filtered.geometry.x.values.astype(np.float64)
    lats = filtered.geometry.y.values.astype(np.float64)
    zs = np.array(
        [float(g.z) if getattr(g, "has_z", False) else 0.0 for g in filtered.geometry],
        dtype=np.float64,
    )

    # Uniformly subsample down to max_origins
    if len(lons) > max_origins:
        idxs = np.linspace(0, len(lons) - 1, max_origins).astype(int)
        lons = lons[idxs]
        lats = lats[idxs]
        zs = zs[idxs]
        filt_ts = filt_ts[idxs]

    return lons, lats, zs, filt_ts


def _try_auto_download_osm(
    origin_lons: np.ndarray,
    origin_lats: np.ndarray,
    profile,
    *,
    min_activity_sec: float,
    total_budget_min_raw: Any,
    origin_ts: np.ndarray,
    anchor_a: dict,
    anchor_b: dict,
    warnings: list[str],
    max_area_km2: float | None = None,
) -> gpd.GeoDataFrame | None:
    """Compute padded extent → cached Overpass query → road GeoDataFrame.

    Returns None on any failure (extent too large, network error, empty result).
    Appends a human-readable note to ``warnings`` so the caller can surface it.
    """
    # Resolve T to derive R for buffer sizing — share the main function's logic
    total_budget_sec = _auto_total_budget_sec(
        total_budget_min_raw, origin_ts, min_activity_sec,
    )

    cutoff_sec = max(0.0, (total_budget_sec - min_activity_sec) / 2.0)
    if cutoff_sec <= 0:
        warnings.append("OSM auto-download skipped: T ≤ A leaves no travel budget.")
        return None

    bbox = compute_padded_extent(
        origin_lons, origin_lats, profile, cutoff_sec,
        anchor_a=anchor_a, anchor_b=anchor_b,
    )
    too_large, area, cap = is_extent_too_large(bbox, profile.mode, max_area_km2)
    if too_large:
        warnings.append(
            f"OSM auto-download skipped: padded extent {area:.0f} km² exceeds "
            f"{cap:.0f} km² cap for mode '{profile.mode}'. "
            f"Pass options.maxAnalysisAreaKm2 to raise it, or load a road "
            f"network manually."
        )
        return None

    roads = fetch_or_cache_osm_roads(bbox, profile.mode)
    if roads is None or roads.empty:
        warnings.append(
            "OSM auto-download returned no roads — Overpass may be down. "
            "Load a road network dataset and re-run."
        )
        return None

    warnings.append(
        f"Auto-downloaded {len(roads)} road segments from OSM for "
        f"{area:.1f} km² extent."
    )
    return roads


def _load_road_network_gdf(options: dict[str, Any]) -> gpd.GeoDataFrame | None:
    """Resolve a WGS84 road-network GeoDataFrame from inline data or a file path."""
    rn_data = options.get("roadNetworkData")
    rn_path = str(options.get("roadNetworkPath") or "")

    roads: gpd.GeoDataFrame | None = None
    if rn_data and isinstance(rn_data, dict):
        roads = gpd.GeoDataFrame.from_features(
            rn_data.get("features", []), crs="EPSG:4326",
        )
    elif rn_path and os.path.exists(rn_path):
        roads = gpd.read_file(rn_path)

    if roads is None or roads.empty:
        return None
    if roads.crs is None:
        roads = roads.set_crs("EPSG:4326")
    else:
        roads = roads.to_crs("EPSG:4326")
    roads = roads[roads.geometry.notna() & ~roads.geometry.is_empty]
    roads = roads[roads.geometry.geom_type.isin(["LineString", "MultiLineString"])].copy()
    return roads if not roads.empty else None


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {"geometry": [], "_dataset_type": []}, crs="EPSG:4326",
    )


def _origins_gdf_with_dwell(
    lons: np.ndarray,
    lats: np.ndarray,
    summaries: list[dict],
) -> gpd.GeoDataFrame:
    """One Point feature per GPS origin enriched with the dwell-time summary.

    Each row groups: 3D position + dwell-time budget (T, A, R) + per-origin
    PPA aggregates (segments reachable, total reachable road length, mean dwell).
    """
    if not summaries:
        return _empty_gdf()
    rows = []
    for summary in summaries:
        idx = summary["origin_index"]
        z = float(summary.get("z", 0.0))
        row = {
            **summary,
            "geometry": Point(float(lons[idx]), float(lats[idx]), z),
            "_dataset_type": "ppa-origin-points",
        }
        rows.append(row)
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def _unreachable_origins_gdf(
    lons: np.ndarray, lats: np.ndarray, zs: np.ndarray, ts: np.ndarray,
    total_budget_sec: float, min_activity_sec: float,
) -> gpd.GeoDataFrame:
    """Build the origins layer when no PPA could be computed (no road network)."""
    summaries: list[dict] = []
    if len(ts) >= 2:
        t_min = float(np.min(ts))
        t_range = max(float(np.max(ts) - np.min(ts)), 1.0)
    else:
        t_min, t_range = 0.0, 1.0
    for i in range(len(lons)):
        progress = (float(ts[i]) - t_min) / t_range
        summaries.append(_unreachable_origin_summary(
            i, float(lons[i]), float(lats[i]), int(ts[i]),
            progress, float(zs[i]), total_budget_sec, min_activity_sec,
        ))
    return _origins_gdf_with_dwell(lons, lats, summaries)


def _unreachable_origin_summary(
    i: int, lon: float, lat: float, ts: int, time_progress: float,
    z_base: float, total_budget_sec: float, min_activity_sec: float,
) -> dict:
    """Summary stub for an origin that could not be snapped to the road network."""
    return {
        "origin_index": i,
        "origin_lon": lon,
        "origin_lat": lat,
        "origin_timestamp": ts,
        "_timestamp": float(ts),
        "_time_progress": time_progress,
        "z": z_base,
        PROCESSED_HEIGHT_FIELD: z_base,
        "total_budget_sec": float(total_budget_sec),
        "min_activity_sec": float(min_activity_sec),
        "cutoff_sec": float(max(0.0, (total_budget_sec - min_activity_sec) / 2.0)),
        "dwell_sec_at_origin": float(total_budget_sec),
        "dwell_sec_max": float(total_budget_sec),
        "dwell_sec_min": float(min_activity_sec),
        "dwell_sec_mean": float(min_activity_sec),
        "activity_sec_at_origin": float(total_budget_sec),
        "activity_sec_max": float(total_budget_sec),
        "activity_sec_min": float(min_activity_sec),
        "activity_sec_mean": float(min_activity_sec),
        "ppa_reachable_segments": 0,
        "ppa_reachable_length_m": 0.0,
        "snap_distance_m": math.inf,
        "reachable": False,
    }


def _segment_length_m(graph, edge_id: int, a: float, b: float) -> float:
    """Length of a fractional interval [a,b] on edge_id, in metres."""
    if edge_id < 0 or edge_id >= graph.n_edges:
        return 0.0
    return float(graph.edge_length_m[edge_id]) * max(0.0, b - a)


# Sequential blue → cyan → yellow → orange → red colour ramp (5 stops).
# Low dwell time = cool/blue (boundary of reachable), high dwell time = warm/red
# (close to the origin). Matches the colorRange declared in the frontend layer config.
_DWELL_RAMP: tuple[tuple[int, int, int], ...] = (
    (44, 123, 182),
    (171, 217, 233),
    (255, 255, 191),
    (253, 174, 97),
    (215, 25, 28),
)


def _dwell_color_rgba(
    dwell_sec: float, min_activity_sec: float, total_budget_sec: float,
    alpha: int = 230,
) -> list[int]:
    """Map a per-segment dwell time to an [r, g, b, a] colour.

    dwell_sec is clamped to [min_activity_sec, total_budget_sec] and the
    normalised fraction is used to pick + interpolate from the sequential ramp.
    """
    lo = float(min_activity_sec)
    hi = float(total_budget_sec)
    if hi <= lo:
        r, g, b = _DWELL_RAMP[-1]
        return [r, g, b, alpha]
    t = max(0.0, min(1.0, (dwell_sec - lo) / (hi - lo)))
    n = len(_DWELL_RAMP) - 1
    pos = t * n
    i0 = int(pos)
    if i0 >= n:
        r, g, b = _DWELL_RAMP[-1]
        return [r, g, b, alpha]
    frac = pos - i0
    c0 = _DWELL_RAMP[i0]
    c1 = _DWELL_RAMP[i0 + 1]
    r = int(round(c0[0] + (c1[0] - c0[0]) * frac))
    g = int(round(c0[1] + (c1[1] - c0[1]) * frac))
    b = int(round(c0[2] + (c1[2] - c0[2]) * frac))
    return [r, g, b, alpha]


def _anchors_gdf(
    p1: dict, p2: dict, t1: int, t2: int, z_a: float, z_b: float,
) -> gpd.GeoDataFrame:
    """Anchor A and B placed at the trajectory-aligned Z heights."""
    rows = [
        {
            "geometry": Point(float(p1["lng"]), float(p1["lat"]), float(z_a)),
            "_timestamp": float(t1),
            "_time_progress": 0.0,
            PROCESSED_HEIGHT_FIELD: float(z_a),
            "z": float(z_a),
            "anchor_role": "start_anchor",
            "anchor_label": p1.get("label", "Anchor A"),
            "_dataset_type": "prism-anchors",
        },
        {
            "geometry": Point(float(p2["lng"]), float(p2["lat"]), float(z_b)),
            "_timestamp": float(t2),
            "_time_progress": 1.0,
            PROCESSED_HEIGHT_FIELD: float(z_b),
            "z": float(z_b),
            "anchor_role": "end_anchor",
            "anchor_label": p2.get("label", "Anchor B"),
            "_dataset_type": "prism-anchors",
        },
    ]
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")
