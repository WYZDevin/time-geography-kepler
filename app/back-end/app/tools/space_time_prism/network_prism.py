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
    [1] ppa-dwell-surface  — flat H3 cells aggregated from *all* reachable
                             edges, coloured by best available activity time.
                             The default main-map rendering (the 3-D stack is
                             only legible in the focused single-prism view).
    [2] prism-anchors      — anchor A/B markers (start/end).

When the PPA is empty the surface is omitted and only [empty, anchors] return.
"""
from __future__ import annotations

import logging
import math
from time import perf_counter
from typing import Any

import geopandas as gpd
import numpy as np
from shapely.geometry import LineString

from ...constants import PROCESSED_HEIGHT_FIELD
from .dwell_surface import dwell_surface_gdf
from .road_network import _auto_utm_crs, _parse_timestamps
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
from .ppa_engine.speed_adjust import resolve_speed_factor
from .ppa_engine.two_anchor import (
    compute_ppa_fast,
    shortest_path_sec,
)
from .timing import log_phase

logger = logging.getLogger(__name__)

# Above this multiple of the per-mode download cap the prism is too large to be
# represented by a cap-sized corridor — fail fast with guidance instead.
_CLAMP_FACTOR = 4.0

# Highway tags treated as "minor" and dropped from the rendered result (the
# reachability search still uses the full graph, so this only declutters what is
# drawn — major corridors stay continuous). Mode-aware so a mode's primary
# network is never gutted: for walking/cycling, footways/paths/residential are
# the main network and are kept; only incidental connectors are dropped.
_MINOR_HIGHWAYS: dict[str, frozenset[str]] = {
    "driving": frozenset({"residential", "living_street", "service", "track", "unclassified"}),
    "transit": frozenset({"residential", "living_street", "service", "track", "unclassified"}),
    "custom": frozenset({"residential", "living_street", "service", "track", "unclassified"}),
    "walking": frozenset({"service", "track", "steps", "corridor", "platform"}),
    "cycling": frozenset({"service", "track", "steps", "corridor", "platform"}),
}


def execute_network_anchor_prism(
    p1: dict,
    p2: dict,
    options: dict[str, Any],
    *,
    z_start: float,
    z_end: float,
    total_height: float,
    trajectory_gdf: gpd.GeoDataFrame | None = None,
    time_field: str | None = None,
) -> list[gpd.GeoDataFrame]:
    """Compute the two-anchor network prism between A (p1) and B (p2).

    p1/p2 carry ``lng``, ``lat``, ``alt`` and ``timestamp`` (ms). The Z scale
    (z_start, z_end, total_height) is supplied by the caller so the prism lines
    up with the rendered trajectory's height axis. trajectory_gdf (optional)
    is the GPS trajectory — used by speedAdjustment='auto' to calibrate real
    travel speeds from observed movement.

    Options consumed:
        speedMode / customSpeed   travel mode + custom km/h
        speedAdjustment           'off' (default) | 'auto' | 'manual' — adjust
                                  free-flow speeds for real conditions: 'auto'
                                  calibrates from the GPS trajectory (fallback:
                                  time-of-day congestion factor), 'manual' uses
                                  speedFactor
        speedFactor               real speed = factor x profile speed ('manual')
        minActivityMinutes        A_min (default 5)
        totalBudgetMinutes        T override (default: t_B - t_A)
        timeSlices                number of 3-D slices (default 12)
        roadNetworkData / Path    explicit road network (else OSM auto-download)
        autoDownloadOSM           default True
        maxAnalysisAreaKm2        raise the OSM extent cap
        dropMinorRoads            drop residential/service/… from the result
                                  (default True; mode-aware, best-effort)
        maxRenderSegments         max drawn segments before subsampling (default 200k)
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
    _t = perf_counter()
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
            research_area=options.get("_researchArea"),
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

    # Pre-clip the road network to the research area (when defined). Keeps whole
    # segments that touch the area so LineString geometry stays intact for the
    # graph builder, while bounding the network — and the resulting prism — to it.
    research_geom = _research_area_geom(options.get("_researchArea"))
    if research_geom is not None:
        clipped = _segments_intersecting(roads_wgs84, research_geom).copy()
        if clipped.empty:
            logger.info("network-prism: research area excluded all roads; using unclipped network")
        else:
            logger.info(
                "network-prism: clipped road network to research area (%d → %d segments)",
                len(roads_wgs84), len(clipped),
            )
            roads_wgs84 = clipped

    _t = log_phase(f"network-prism: resolve roads ({len(roads_wgs84)} segments)", _t)

    # ── Build / fetch the cached road graph ─────────────────────────────────
    centroid_lon = float(np.mean(lons))
    centroid_lat = float(np.mean(lats))
    metric_crs = options.get("metricCrs") or _auto_utm_crs(centroid_lon, centroid_lat)
    graph, edge_index = get_or_build_graph(roads_wgs84, metric_crs, profile)
    if graph.n_edges == 0:
        raise ValueError("The road network produced no routable edges.")
    _t = log_phase(f"network-prism: build/cache graph ({graph.n_edges} edges)", _t)

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
    _t = log_phase("network-prism: snap anchors A+B", _t)

    # ── Realistic speed factor (speedAdjustment) ────────────────────────────
    # real speed = factor × profile speed. The cached graph stays in free-flow
    # units; we run Dijkstra with the cutoff scaled to graph units and convert
    # travel times back to real seconds via time_scale = 1/factor.
    speed_factor, speed_note = resolve_speed_factor(
        options,
        graph=graph, edge_index=edge_index, profile=profile,
        trajectory_points=_trajectory_points(trajectory_gdf, time_field),
        window_mid_ms=(t1 + t2) / 2.0,
        anchor_lon=float(p1["lng"]),
    )
    time_scale = 1.0 / speed_factor
    if speed_note:
        logger.info("network-prism: %s", speed_note)
    budget_k_graph = budget_k * speed_factor   # cutoff in graph (free-flow) units

    # ── Two bounded Dijkstra searches (forward from A, backward from B) ──────
    dist_a, cand_a = bounded_dijkstra(
        graph, snap_a.seeds, budget_k_graph, snap_edge_id=snap_a.edge_id,
    )
    _t = log_phase(f"network-prism: Dijkstra forward A ({len(cand_a)} edges)", _t)
    dist_b, cand_b = bounded_dijkstra(
        graph, snap_b.seeds, budget_k_graph, snap_edge_id=snap_b.edge_id,
    )
    _t = log_phase(f"network-prism: Dijkstra backward B ({len(cand_b)} edges)", _t)

    sp_sec = shortest_path_sec(dist_a, snap_b) * time_scale
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
        time_scale=time_scale,
    )
    _t = log_phase(
        f"network-prism: compute PPA ({0 if fast is None else len(fast)} reachable edges)", _t,
    )

    outputs: list[gpd.GeoDataFrame] = []
    if fast is None or len(fast) == 0:
        outputs.append(_empty_gdf())
        outputs.append(_anchors_gdf(p1, p2, t1, t2, z_a, z_b))
        return outputs

    # Drop minor roads (residential/service/…) for a cleaner, lighter result.
    # Reachability was computed over the full graph, so this only changes what is
    # drawn. Best-effort: if it would remove everything, keep all.
    n_all = len(fast)
    notes: list[str] = [speed_note] if speed_note else []
    keep_mask = np.ones(n_all, dtype=bool)
    if bool(options.get("dropMinorRoads", True)):
        minor = _MINOR_HIGHWAYS.get(profile.mode, _MINOR_HIGHWAYS["driving"])
        hw = [graph.edge_highway[int(e)] for e in fast.edge_id]
        candidate = np.fromiter((h not in minor for h in hw), dtype=bool, count=n_all)
        if candidate.any():
            keep_mask = candidate
            removed = int(n_all - int(candidate.sum()))
            if removed:
                notes.append(f"Removed {removed} minor-road segments ({profile.mode} hierarchy).")
        else:
            logger.info("network-prism: minor-road filter would remove all edges; keeping all")

    kept_idx = np.flatnonzero(keep_mask)
    n = kept_idx.size

    # Render cap: bound the payload (and per-edge feature build) by uniformly
    # subsampling only when the kept set is still very large. The default is
    # sized for the frontend, not the algorithm: a long driving budget reaches
    # the whole metro network (150k+ edges ≈ 120 MB of GeoJSON), which freezes
    # the browser before the layer can render — leaving only the anchor markers
    # on screen. 15k segments (~12 MB) still conveys the corridor and renders
    # smoothly; raise options.maxRenderSegments for an offline/export run.
    max_render = max(1000, int(options.get("maxRenderSegments", 15_000)))
    if n > max_render:
        sel = kept_idx[np.linspace(0, n - 1, max_render).astype(np.int64)]
        notes.append(f"Subsampled {max_render} of {n} reachable segments (maxRenderSegments).")
    else:
        sel = kept_idx

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
    fwd, bwd = fast.forward_sec[sel], fast.backward_sec[sel]

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
            # Forward/backward travel times let the focused view rebuild the
            # discrete prism (forward∩backward cone per time slice).
            "forward_sec": float(fwd[i]),
            "backward_sec": float(bwd[i]),
            "color_rgba": colors[i],
        })

    for note in notes:
        logger.info("network-prism: %s", note)

    out_gdf = gpd.GeoDataFrame(features, crs="EPSG:4326")
    if notes:
        out_gdf.attrs["warnings"] = notes
    outputs.append(out_gdf)
    surface = dwell_surface_gdf(fast, total_budget_sec, min_activity_sec, options)
    if surface is not None and not surface.empty:
        outputs.append(surface)
    outputs.append(_anchors_gdf(p1, p2, t1, t2, z_a, z_b))
    log_phase(f"network-prism: filter + build {len(features)} features", _t)
    return outputs


def _trajectory_points(
    gdf: gpd.GeoDataFrame | None, time_field: str | None
) -> list[tuple[float, float, float]] | None:
    """(lon, lat, t_ms) tuples from a GPS point trajectory, or None."""
    if gdf is None or gdf.empty:
        return None
    pts = gdf[gdf.geometry.notna() & (gdf.geometry.geom_type == "Point")]
    if len(pts) < 2:
        return None
    ts = None
    for tf in ([time_field] if time_field else []) + ["_timestamp", "timestamp", "time"]:
        if tf and tf in pts.columns:
            try:
                ts = _parse_timestamps(pts, tf)
                break
            except Exception:
                continue
    if ts is None or len(ts) != len(pts):
        return None
    return [
        (float(geom.x), float(geom.y), float(t))
        for geom, t in zip(pts.geometry, ts)
        if not geom.is_empty
    ]


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
    research_area: dict | None = None,
) -> gpd.GeoDataFrame | None:
    """Reachability-ellipse extent around A/B → cached Overpass → road GeoDataFrame."""
    if budget_k <= 0:
        warnings.append("OSM auto-download skipped: no travel budget after activity.")
        return None
    bbox = _anchor_ellipse_bbox(anchor_a, anchor_b, profile, budget_k)

    # When a research area is defined, only the part of the reachable extent that
    # overlaps it can ever survive the output clip — so download just that. This
    # shrinks the fetch (often under the cap, avoiding the "too large" failure).
    research_geom = _research_area_geom(research_area)
    if research_geom is not None:
        clipped_bbox = _intersect_bbox(bbox, research_geom.bounds)
        if clipped_bbox is None:
            warnings.append(
                "Research area does not overlap the reachable extent between the "
                "anchors — cannot fetch a road network. Move the anchors inside "
                "the research area or disable clipping."
            )
            return None
        bbox = clipped_bbox
        warnings.append(
            f"Clipped OSM download extent to the research area "
            f"({extent_area_km2(bbox):.1f} km²)."
        )

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
    source: list[str] = []
    roads = fetch_or_cache_osm_roads(bbox, profile.mode, source_out=source)
    if roads is None or roads.empty:
        warnings.append("OSM auto-download returned no roads — Overpass may be down.")
        return None
    # Report where the roads actually came from — a cache hit is not a download.
    origin = {
        "memory": "from the in-memory OSM cache",
        "memory-extent": "from the in-memory OSM cache (clipped from a larger extent)",
        "disk": "from the on-disk OSM cache",
        "network": "downloaded from OSM",
    }.get(source[0] if source else "", "from OSM")
    warnings.append(
        f"{len(roads)} road segments {origin} for {extent_area_km2(bbox):.1f} km²."
    )
    return roads


def _segments_intersecting(roads: gpd.GeoDataFrame, geom) -> gpd.GeoDataFrame:
    """Whole road segments that intersect ``geom``.

    Equivalent to ``roads[roads.intersects(geom)]`` but goes through the GEOS
    STRtree spatial index (bbox prefilter in C, then an ``intersects`` refine on
    only the candidates) instead of evaluating every segment in Python. On a
    ~300k-segment metro network that is the difference between tens of seconds
    and well under a second.
    """
    pos = roads.sindex.query(geom, predicate="intersects")
    return roads.iloc[pos]


def _research_area_geom(research_area: dict | None):
    """Union of the research-area polygons as a single shapely geom (EPSG:4326).

    Returns None when no area is supplied or it carries no usable geometry.
    """
    if not research_area:
        return None
    feats = research_area.get("features")
    if feats is None and research_area.get("type") == "Feature":
        feats = [research_area]
    if not feats:
        return None
    area = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
    geom = area.geometry.union_all()
    return None if geom.is_empty else geom


def _intersect_bbox(
    b1: tuple[float, float, float, float], b2: tuple[float, float, float, float]
) -> tuple[float, float, float, float] | None:
    """Overlap of two (west, south, east, north) boxes, or None if disjoint."""
    west = max(b1[0], b2[0])
    south = max(b1[1], b2[1])
    east = min(b1[2], b2[2])
    north = min(b1[3], b2[3])
    if east <= west or north <= south:
        return None
    return (west, south, east, north)


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
