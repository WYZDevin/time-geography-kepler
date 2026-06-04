"""Two-anchor road-network space-time prism.

Given two anchors A and B picked in the Prism Explorer, build the potential path
area (PPA) and the 3-D time-sliced prism on the road network:

    T     = t_B - t_A                       total time budget
    A_min = minimum activity time
    keep road point x  <=>  travel(A -> x) + travel(x -> B) + A_min <= T

The computation is two bounded Dijkstra searches over a shared road graph — one
forward from A, one backward from B — followed by a per-edge intersection of the
two cones (see ``ppa_engine/two_anchor.py``). This replaces the old per-GPS-point
``gps_road_network`` model, where the two anchors only bounded a sampling window
and each GPS point produced its own single-cone round-trip PPA.

Outputs:
    [0] ppa-road-network   — reachable road segments stacked per time slice,
                             lifted to Z = time and coloured by available
                             activity time. The frontend mirrors this to a
                             ground-projected sibling = the flat 2-D PPA.
    [1] prism-anchors      — anchor A/B markers (start/end).
"""
from __future__ import annotations

import logging
import math
from typing import Any

import geopandas as gpd
import numpy as np
from shapely.geometry import LineString

from ...constants import PROCESSED_HEIGHT_FIELD
from .road_network import _auto_utm_crs
from .gps_road_network import (
    _anchors_gdf,
    _empty_gdf,
    _load_road_network_gdf,
)
from .ppa_engine import (
    bounded_dijkstra,
    extent_area_km2,
    fetch_or_cache_osm_roads,
    get_or_build_graph,
    is_extent_too_large,
    make_mode_profile,
    snap_origin_to_graph,
)
from .ppa_engine.two_anchor import (
    compute_ppa_fast,
    shortest_path_sec,
)

logger = logging.getLogger(__name__)

# Above this multiple of the per-mode download cap the prism is too large to be
# represented by a cap-sized corridor — fail fast with guidance instead.
_CLAMP_FACTOR = 4.0


def execute_network_anchor_prism(
    p1: dict,
    p2: dict,
    options: dict[str, Any],
    *,
    z_start: float,
    z_end: float,
    total_height: float,
) -> list[gpd.GeoDataFrame]:
    """Compute the two-anchor network prism between A (p1) and B (p2).

    p1/p2 carry ``lng``, ``lat``, ``alt`` and ``timestamp`` (ms). The Z scale
    (z_start, z_end, total_height) is supplied by the caller so the prism lines
    up with the rendered trajectory's height axis.

    Options consumed:
        speedMode / customSpeed   travel mode + custom km/h
        minActivityMinutes        A_min (default 5)
        totalBudgetMinutes        T override (default: t_B - t_A)
        timeSlices                number of 3-D slices (default 12)
        roadNetworkData / Path    explicit road network (else OSM auto-download)
        autoDownloadOSM           default True
        maxAnalysisAreaKm2        raise the OSM extent cap
    """
    t1, t2 = int(p1["timestamp"]), int(p2["timestamp"])
    dt_ms = t2 - t1
    if dt_ms <= 0:
        raise ValueError("Anchor A must be earlier in time than Anchor B")

    # ── Time budget T and activity floor A_min ──────────────────────────────
    budget_override = options.get("totalBudgetMinutes")
    total_budget_sec = (
        float(budget_override) * 60.0 if budget_override is not None else dt_ms / 1000.0
    )
    min_activity_sec = max(0.0, float(options.get("minActivityMinutes", 5)) * 60.0)
    if total_budget_sec <= min_activity_sec:
        raise ValueError(
            f"Time budget ({total_budget_sec / 60:.0f} min) must exceed the "
            f"minimum activity time ({min_activity_sec / 60:.0f} min)."
        )
    budget_k = total_budget_sec - min_activity_sec   # round-trip travel cutoff

    speed_mode = str(options.get("speedMode", "walking"))
    custom_kmh = float(options.get("customSpeed", 5.0)) if speed_mode == "custom" else None
    profile = make_mode_profile(speed_mode, custom_speed_kmh=custom_kmh)

    z_a = float(p1.get("alt", z_start) or 0.0)
    z_b = float(p2.get("alt", z_end) or 0.0)

    # ── Resolve the road network ────────────────────────────────────────────
    lons = np.array([p1["lng"], p2["lng"]], dtype=np.float64)
    lats = np.array([p1["lat"], p2["lat"]], dtype=np.float64)
    roads_wgs84 = _load_road_network_gdf(options)
    osm_warnings: list[str] = []
    if roads_wgs84 is None and options.get("autoDownloadOSM", True):
        raw_cap = options.get("maxAnalysisAreaKm2")
        roads_wgs84 = _try_auto_download_osm_for_anchors(
            profile, budget_k,
            anchor_a=p1, anchor_b=p2, warnings=osm_warnings,
            max_area_km2=float(raw_cap) if raw_cap is not None else None,
        )
    for msg in osm_warnings:
        logger.info("network-prism-osm: %s", msg)

    if roads_wgs84 is None or roads_wgs84.empty:
        # Lead with the specific reason (e.g. extent too large) when we have one.
        if osm_warnings:
            raise ValueError(" ".join(osm_warnings))
        raise ValueError(
            "No road network available for the prism. Load a road LineString "
            "dataset, or enable OSM auto-download."
        )

    # ── Build / fetch the cached road graph ─────────────────────────────────
    centroid_lon = float(np.mean(lons))
    centroid_lat = float(np.mean(lats))
    metric_crs = options.get("metricCrs") or _auto_utm_crs(centroid_lon, centroid_lat)
    graph, edge_index = get_or_build_graph(roads_wgs84, metric_crs, profile)
    if graph.n_edges == 0:
        raise ValueError("The road network produced no routable edges.")

    # Safety backstop only — the vectorised PPA is O(edges) so large graphs
    # compute fine; this just guards against a pathological multi-million-edge
    # build (and its slow graph construction).
    max_graph_edges = int(options.get("maxGraphEdges", 2_000_000))
    if graph.n_edges > max_graph_edges:
        raise ValueError(
            f"Road network too large ({graph.n_edges:,} segments). Reduce the "
            f"extent or load a simplified road dataset. Raise options.maxGraphEdges "
            f"to override."
        )

    # ── Snap both anchors ───────────────────────────────────────────────────
    snap_a = snap_origin_to_graph(
        graph, float(p1["lng"]), float(p1["lat"]),
        max_snap_m=profile.max_snap_m, edge_index=edge_index,
    )
    snap_b = snap_origin_to_graph(
        graph, float(p2["lng"]), float(p2["lat"]),
        max_snap_m=profile.max_snap_m, edge_index=edge_index,
    )
    if snap_a is None or snap_b is None:
        which = "A" if snap_a is None else "B"
        raise ValueError(
            f"Anchor {which} is too far from any road "
            f"(> {profile.max_snap_m:.0f} m). Pick a point closer to the network."
        )

    # ── Two bounded Dijkstra searches (forward from A, backward from B) ──────
    dist_a, cand_a = bounded_dijkstra(
        graph, snap_a.seeds, budget_k, snap_edge_id=snap_a.edge_id,
    )
    dist_b, cand_b = bounded_dijkstra(
        graph, snap_b.seeds, budget_k, snap_edge_id=snap_b.edge_id,
    )

    sp_sec = shortest_path_sec(dist_a, snap_b)
    if not np.isfinite(sp_sec) or sp_sec > budget_k + 1e-6:
        sp_txt = "unreachable" if not np.isfinite(sp_sec) else f"{sp_sec / 60:.1f} min"
        raise ValueError(
            f"Anchors are infeasible on the road network: shortest A→B travel "
            f"({sp_txt}) plus {min_activity_sec / 60:.0f} min activity exceeds the "
            f"{total_budget_sec / 60:.0f} min budget."
        )

    # ── Vectorised two-cone PPA: one whole road edge per reachable segment ──
    # Each edge is lifted to a height from its occupiable time window, so the
    # roads form the 3-D prism (low near A, high near B) and their flat ground
    # projection is the 2-D PPA. This is O(edges) — emitting a copy per time
    # slice would be O(edges × slices), millions of features on a city network.
    candidate_edges = cand_a | cand_b
    fast = compute_ppa_fast(
        graph, dist_a, dist_b, candidate_edges,
        total_budget_sec, min_activity_sec, z_start, z_end,
    )

    outputs: list[gpd.GeoDataFrame] = []
    if fast is None or len(fast) == 0:
        outputs.append(_empty_gdf())
        outputs.append(_anchors_gdf(p1, p2, t1, t2, z_a, z_b))
        return outputs

    # Render cap: keep the payload (and per-edge feature build) bounded by
    # uniformly subsampling the reachable edges when there are too many.
    max_render = max(1000, int(options.get("maxRenderSegments", 50_000)))
    n = len(fast)
    sel = (
        np.linspace(0, n - 1, max_render).astype(np.int64)
        if n > max_render else np.arange(n)
    )

    colors = _dwell_colors_vec(
        fast.activity_sec_min[sel], min_activity_sec, total_budget_sec,
    )
    ei = fast.edge_id[sel]
    lon0, lat0 = fast.lon0[sel], fast.lat0[sel]
    lon1, lat1 = fast.lon1[sel], fast.lat1[sel]
    zz, tp = fast.z[sel], fast.time_progress[sel]
    a_min, a_mid, a_max = (
        fast.activity_sec_min[sel], fast.activity_sec_mid[sel], fast.activity_sec_max[sel],
    )

    features: list[dict] = []
    for i in range(sel.size):
        z_i = float(zz[i])
        features.append({
            "geometry": LineString([
                (float(lon0[i]), float(lat0[i]), z_i),
                (float(lon1[i]), float(lat1[i]), z_i),
            ]),
            "_dataset_type": "ppa-road-network",
            "_timestamp": float(t1 + float(tp[i]) * dt_ms),
            "_time_progress": float(tp[i]),
            "z": z_i,
            PROCESSED_HEIGHT_FIELD: z_i,
            "edge_id": int(ei[i]),
            "highway": graph.edge_highway[int(ei[i])],
            "activity_sec_min": float(a_min[i]),
            "activity_sec_mid": float(a_mid[i]),
            "activity_sec_max": float(a_max[i]),
            # dwell_* aliases kept for API/legend consistency with prior outputs.
            "dwell_sec_min": float(a_min[i]),
            "dwell_sec_mid": float(a_mid[i]),
            "dwell_sec_max": float(a_max[i]),
            "total_budget_sec": float(total_budget_sec),
            "min_activity_sec": float(min_activity_sec),
            "shortest_path_sec": float(sp_sec),
            "color_rgba": colors[i],
        })

    if n > max_render:
        logger.info(
            "network-prism: subsampled %d of %d reachable edges (maxRenderSegments)",
            max_render, n,
        )

    outputs.append(gpd.GeoDataFrame(features, crs="EPSG:4326"))
    outputs.append(_anchors_gdf(p1, p2, t1, t2, z_a, z_b))
    return outputs


# Sequential blue→red dwell ramp (matches gps_road_network._DWELL_RAMP), as a
# (5, 3) array for vectorised interpolation.
_RAMP = np.array(
    [(44, 123, 182), (171, 217, 233), (255, 255, 191), (253, 174, 97), (215, 25, 28)],
    dtype=np.float64,
)


def _dwell_colors_vec(
    activity_sec: np.ndarray, lo: float, hi: float, alpha: int = 230,
) -> list[list[int]]:
    """Vectorised per-segment [r, g, b, a] colour from the dwell ramp."""
    if hi <= lo:
        frac = np.ones(activity_sec.shape, dtype=np.float64)
    else:
        frac = np.clip((activity_sec - lo) / (hi - lo), 0.0, 1.0)
    pos = frac * (len(_RAMP) - 1)
    i0 = np.clip(pos.astype(np.int64), 0, len(_RAMP) - 2)
    t = (pos - i0)[:, None]
    rgb = np.rint(_RAMP[i0] + (_RAMP[i0 + 1] - _RAMP[i0]) * t).astype(np.int64)
    return [[int(r), int(g), int(b), alpha] for r, g, b in rgb]


def _try_auto_download_osm_for_anchors(
    profile,
    budget_k: float,
    *,
    anchor_a: dict,
    anchor_b: dict,
    warnings: list[str],
    max_area_km2: float | None,
) -> gpd.GeoDataFrame | None:
    """Reachability-ellipse extent around A/B → cached Overpass → road GeoDataFrame."""
    if budget_k <= 0:
        warnings.append("OSM auto-download skipped: no travel budget after activity.")
        return None
    bbox = _anchor_ellipse_bbox(anchor_a, anchor_b, profile, budget_k)
    too_large, area, cap = is_extent_too_large(bbox, profile.mode, max_area_km2)
    if too_large:
        # When the prism is only modestly over the cap, a cap-sized corridor
        # between the anchors still captures most of it — download that and clip.
        # When it is *far* over the cap (a multi-hour budget for this mode), a
        # cap-sized sliver would be a misleading fraction and slow to fetch, so
        # fail fast with actionable guidance instead.
        if area > _CLAMP_FACTOR * cap:
            warnings.append(
                f"Reachable extent {area:.0f} km² is ~{area / cap:.0f}× the "
                f"{cap:.0f} km² auto-download cap for mode '{profile.mode}' — too "
                f"large to fetch. Pick anchors closer in time, use a slower travel "
                f"mode, or load a road dataset. Raise options.maxAnalysisAreaKm2 to "
                f"force it."
            )
            return None
        bbox = _corridor_bbox_to_area(anchor_a, anchor_b, cap)
        warnings.append(
            f"Reachable extent {area:.0f} km² exceeds the {cap:.0f} km² download "
            f"cap for mode '{profile.mode}'; fetching only the central {cap:.0f} km² "
            f"corridor between the anchors — the prism is clipped to it."
        )
    roads = fetch_or_cache_osm_roads(bbox, profile.mode)
    if roads is None or roads.empty:
        warnings.append("OSM auto-download returned no roads — Overpass may be down.")
        return None
    warnings.append(
        f"Auto-downloaded {len(roads)} road segments from OSM for "
        f"{extent_area_km2(bbox):.1f} km²."
    )
    return roads


def _corridor_bbox_to_area(
    anchor_a: dict, anchor_b: dict, target_km2: float
) -> tuple[float, float, float, float]:
    """Bbox covering A and B with a uniform margin sized to ``target_km2``.

    Starts from the anchors' own bounding box (so both anchors are always
    inside) and grows it by an equal kilometre margin on every side until the
    area reaches the cap. When the anchors alone already span more than the cap
    (very far apart) the margin clamps to zero.
    """
    lng_a, lat_a = float(anchor_a["lng"]), float(anchor_a["lat"])
    lng_b, lat_b = float(anchor_b["lng"]), float(anchor_b["lat"])
    west, east = min(lng_a, lng_b), max(lng_a, lng_b)
    south, north = min(lat_a, lat_b), max(lat_a, lat_b)
    cos_lat = max(0.1, abs(math.cos(math.radians((south + north) / 2.0))))

    w0 = (east - west) * 111.0 * cos_lat   # A–B span width, km
    h0 = (north - south) * 111.0           # A–B span height, km
    # Solve (w0 + 2m)(h0 + 2m) = target for the margin m (km), m >= 0.
    disc = (w0 - h0) ** 2 + 4.0 * target_km2
    margin_km = max(0.0, (-(w0 + h0) + math.sqrt(disc)) / 4.0)

    d_lng = margin_km / (111.0 * cos_lat)
    d_lat = margin_km / 111.0
    return (west - d_lng, south - d_lat, east + d_lng, north + d_lat)


def _anchor_ellipse_bbox(
    anchor_a: dict,
    anchor_b: dict,
    profile,
    budget_k: float,
    safety: float = 1.15,
) -> tuple[float, float, float, float]:
    """WGS84 bbox of the reachability ellipse with foci A and B.

    A road point x is reachable only when ``straight(A,x) + straight(x,B)`` is
    within the travel budget at top speed, i.e. inside the ellipse with foci
    A, B and string length ``budget_k * v_max``. The true network-reachable set
    is a subset of this ellipse, so downloading its bounding box never clips a
    reachable road — yet it hugs the A–B corridor (semi-minor shrinks as the
    anchors move apart), which is far smaller than padding the A–B box by the
    full reach in every direction.

        a = budget_k * v_max / 2        (semi-major, along A–B)
        c = dist(A, B) / 2              (focal half-distance)
        b = sqrt(a^2 - c^2)             (semi-minor, perpendicular)

    The axis-aligned bbox of that rotated ellipse has half-extents
    ``hx = sqrt((a cosθ)^2 + (b sinθ)^2)`` and ``hy`` symmetrically.
    """
    lat_a, lng_a = float(anchor_a["lat"]), float(anchor_a["lng"])
    lat_b, lng_b = float(anchor_b["lat"]), float(anchor_b["lng"])
    mid_lat = (lat_a + lat_b) / 2.0
    mid_lng = (lng_a + lng_b) / 2.0
    cos_lat = max(0.1, abs(math.cos(math.radians(mid_lat))))

    # A–B vector in metres (local equirectangular around the midpoint).
    dx = (lng_b - lng_a) * 111_320.0 * cos_lat
    dy = (lat_b - lat_a) * 111_320.0
    dist_ab = math.hypot(dx, dy)

    v_max = profile.max_speed_kmh / 3.6
    a = budget_k * v_max / 2.0
    c = dist_ab / 2.0
    # Feasibility is enforced later via the actual network shortest path; here we
    # only need a valid, complete download box, so clamp the degenerate case.
    a = max(a, c + 1.0)
    b = math.sqrt(max(a * a - c * c, 0.0))

    theta = math.atan2(dy, dx)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    hx = math.hypot(a * cos_t, b * sin_t) * safety
    hy = math.hypot(a * sin_t, b * cos_t) * safety

    d_lng = hx / (111_320.0 * cos_lat)
    d_lat = hy / 111_320.0
    return (mid_lng - d_lng, mid_lat - d_lat, mid_lng + d_lng, mid_lat + d_lat)
