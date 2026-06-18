"""Realistic speed adjustment for the PPA engine.

Free-flow class speeds (profiles.py) overestimate real urban travel. This module
derives a single speed factor f (real speed = f x profile speed) from, in order
of preference:

1. The observed GPS trajectory — ratio of achieved speed between consecutive
   fixes to the profile speed of the nearest road edge (personal calibration).
2. Time-of-day congestion factors keyed to the prism's time window (fallback
   heuristic for motorised modes; walking/cycling are unaffected by congestion).

A uniform factor never requires rebuilding the (cached) road graph: travel
times in graph units are divided by f at query time (see time_scale in
two_anchor.compute_ppa_fast).
"""
from __future__ import annotations

import math
from statistics import median

from .graph_build import Graph
from .profiles import ModeProfile
from .snap import EdgeIndex, _snap_point_to_segment

# Calibration guards
_MIN_SAMPLES = 8          # fewer valid pairs than this -> calibration unusable
_MAX_PAIRS = 300          # cap snap work on long trajectories (uniform stride)
_MIN_DT_S = 1.0           # consecutive-fix gaps outside this window are
_MAX_DT_S = 600.0         # teleports / data gaps, not movement
_MIN_SPEED_KMH = 0.7      # below: stationary (dwell), not travel
_SNAP_MAX_M = 100.0       # fix too far from any road -> off-network movement
_FACTOR_MIN = 0.25        # clamp: never slower than 1/4 of profile speed
_FACTOR_MAX = 1.5         # or faster than 1.5x

# Time-of-day congestion factors for motorised modes (urban heuristics).
# Hours are local solar time (UTC + lon/15).
_PEAK_HOURS = frozenset({7, 8, 16, 17, 18})
_SHOULDER_HOURS = frozenset({6, 9, 10, 11, 12, 13, 14, 15, 19, 20})
_PEAK_FACTOR = 0.55
_SHOULDER_FACTOR = 0.75
_NIGHT_FACTOR = 0.95

_MOTORISED_MODES = frozenset({"driving", "transit", "custom"})


def congestion_factor(mid_ms: float, lon: float, mode: str) -> tuple[float, str]:
    """Heuristic time-of-day speed factor for the prism's time window.

    mid_ms : window midpoint, epoch milliseconds (UTC)
    lon    : anchor longitude — local solar time = UTC + lon/15 hours
    mode   : profile mode; non-motorised modes always return 1.0
    """
    if mode not in _MOTORISED_MODES:
        return 1.0, "no congestion adjustment (non-motorised mode)"
    utc_hour = (mid_ms / 3_600_000.0) % 24.0
    local_hour = int((utc_hour + lon / 15.0) % 24.0)
    if local_hour in _PEAK_HOURS:
        return _PEAK_FACTOR, f"rush-hour factor x{_PEAK_FACTOR} (~{local_hour:02d}:00 local)"
    if local_hour in _SHOULDER_HOURS:
        return _SHOULDER_FACTOR, f"daytime factor x{_SHOULDER_FACTOR} (~{local_hour:02d}:00 local)"
    return _NIGHT_FACTOR, f"night factor x{_NIGHT_FACTOR} (~{local_hour:02d}:00 local)"


def calibrate_speed_factor(
    points_lon_lat_ms: list[tuple[float, float, float]],
    graph: Graph,
    profile: ModeProfile,
    edge_index: EdgeIndex | None,
) -> tuple[float, int] | None:
    """Personal speed factor from observed GPS movement.

    For each consecutive fix pair: observed speed = straight-line metric
    distance / time gap; expected speed = profile speed of the nearest road
    edge at the pair midpoint. factor = median(observed / expected), clamped.

    Returns (factor, n_samples) or None when the trajectory has too little
    usable movement (short, stationary, off-network, or noisy).
    """
    if graph.wgs84_to_metric is None or graph.n_edges == 0:
        return None
    pts = sorted(points_lon_lat_ms, key=lambda p: p[2])
    if len(pts) < _MIN_SAMPLES + 1:
        return None

    stride = max(1, (len(pts) - 1) // _MAX_PAIRS)
    ratios: list[float] = []
    for i in range(0, len(pts) - stride, stride):
        lon0, lat0, t0 = pts[i]
        lon1, lat1, t1 = pts[i + stride]
        dt = (t1 - t0) / 1000.0
        if not (_MIN_DT_S <= dt <= _MAX_DT_S):
            continue
        x0, y0 = graph.wgs84_to_metric.transform(lon0, lat0)
        x1, y1 = graph.wgs84_to_metric.transform(lon1, lat1)
        dist_m = math.hypot(x1 - x0, y1 - y0)
        v_obs_kmh = dist_m / dt * 3.6
        if v_obs_kmh < _MIN_SPEED_KMH or v_obs_kmh > profile.max_speed_kmh * 1.5:
            continue

        # Expected speed: class speed of the road edge nearest the midpoint.
        mx, my = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        edge_id = _nearest_edge(graph, edge_index, mx, my)
        if edge_id is None:
            continue
        v_exp_kmh = profile.speed_for_highway(graph.edge_highway[edge_id])
        if v_exp_kmh <= 0:
            continue
        ratios.append(v_obs_kmh / v_exp_kmh)

    if len(ratios) < _MIN_SAMPLES:
        return None
    factor = max(_FACTOR_MIN, min(_FACTOR_MAX, median(ratios)))
    return factor, len(ratios)


def _nearest_edge(
    graph: Graph, edge_index: EdgeIndex | None, px: float, py: float
) -> int | None:
    """Closest edge id within _SNAP_MAX_M of (px, py), else None."""
    candidates = edge_index.nearest_edges(px, py, k=4) if edge_index else range(min(graph.n_edges, 64))
    best_id, best_dist = None, _SNAP_MAX_M
    for eid in candidates:
        ax, ay, bx, by = graph.edge_endpoints_xy(eid)
        _, _, _, dist = _snap_point_to_segment(px, py, ax, ay, bx, by)
        if dist < best_dist:
            best_id, best_dist = eid, dist
    return best_id


def resolve_speed_factor(
    options: dict,
    *,
    graph: Graph,
    edge_index: EdgeIndex | None,
    profile: ModeProfile,
    trajectory_points: list[tuple[float, float, float]] | None,
    window_mid_ms: float,
    anchor_lon: float,
) -> tuple[float, str | None]:
    """Resolve the speed factor from options.speedAdjustment.

    'off' (default) -> 1.0 — free-flow profile speeds, exactly the old behaviour
    'manual'        -> options.speedFactor, clamped
    'auto'          -> GPS-trajectory calibration when usable, else the
                       time-of-day congestion heuristic

    Returns (factor, note) — note is None when nothing was adjusted.
    """
    mode = str(options.get("speedAdjustment", "off")).lower()
    if mode == "manual":
        raw = options.get("speedFactor")
        factor = max(_FACTOR_MIN, min(_FACTOR_MAX, float(raw))) if raw is not None else 1.0
        return factor, f"Manual speed factor x{factor:g} applied."
    if mode != "auto":
        return 1.0, None

    if trajectory_points:
        calibrated = calibrate_speed_factor(trajectory_points, graph, profile, edge_index)
        if calibrated is not None:
            factor, n = calibrated
            return factor, (
                f"Speeds calibrated x{factor:.2f} from the GPS trajectory "
                f"({n} movement samples)."
            )
    factor, why = congestion_factor(window_mid_ms, anchor_lon, profile.mode)
    if factor >= 1.0:
        return 1.0, None
    return factor, f"Speeds adjusted: {why}."
