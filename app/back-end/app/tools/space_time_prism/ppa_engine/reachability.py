"""Per-edge reachable interval clipping + activity-time attribute computation.

Implements the model from PPA_ESTIMATION.md §16-§18:

    activity_time(s) = T - 2 * d(s)

where d(s) is the shortest one-way travel time to fraction s along an edge.

For an undirected edge u-v with cost c, three route functions are considered:
    from u:      du + c*s
    from v:      dv + c*(1-s)
    from snap:   c*|s - f|   (only on the snapped edge)

The reachable interval is the union of:
    [0, (R-du)/c]        from u, when du ≤ R
    [1-(R-dv)/c, 1]      from v, when dv ≤ R
    [f - R/c, f + R/c]   from snap, on the snapped edge only

All intervals are clamped to [0, 1] and merged.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from shapely.geometry import LineString

from .dijkstra import bounded_dijkstra, DijkstraWorkspace
from .graph_build import Graph
from .snap import EdgeIndex, SnapResult, snap_origin_to_graph


@dataclass(frozen=True)
class PPAFeature:
    """A single reachable road segment for one origin."""
    edge_id: int
    interval_a: float       # fraction along edge — start
    interval_b: float       # fraction along edge — end
    highway: Optional[str]
    travel_sec_min: float
    travel_sec_mid: float
    travel_sec_max: float
    activity_sec_min: float
    activity_sec_mid: float
    activity_sec_max: float
    coords_wgs84: list[tuple[float, float]]


@dataclass(frozen=True)
class OriginPPAResult:
    """All PPA features for one origin."""
    origin_lon: float
    origin_lat: float
    cutoff_sec: float
    total_budget_sec: float
    min_activity_sec: float
    snap_distance_m: float
    features: list[PPAFeature]


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _merge_intervals(
    intervals: list[tuple[float, float]], eps: float = 1e-9
) -> list[tuple[float, float]]:
    if not intervals:
        return []
    intervals = sorted(intervals)
    merged = [intervals[0]]
    for a, b in intervals[1:]:
        last_a, last_b = merged[-1]
        if a <= last_b + eps:
            merged[-1] = (last_a, max(last_b, b))
        else:
            merged.append((a, b))
    return merged


def reachable_intervals_on_edge(
    du: float,
    dv: float,
    edge_cost: float,
    cutoff_sec: float,
    edge_id: int,
    snap_edge_id: Optional[int],
    snap_fraction: float,
) -> list[tuple[float, float]]:
    """Compute the reachable [a, b] sub-intervals of an edge.

    See module docstring for the model.
    """
    if edge_cost <= 0:
        return []

    intervals: list[tuple[float, float]] = []

    if du <= cutoff_sec:
        b = _clamp01((cutoff_sec - du) / edge_cost)
        if b > 0:
            intervals.append((0.0, b))

    if dv <= cutoff_sec:
        a = _clamp01(1.0 - (cutoff_sec - dv) / edge_cost)
        if a < 1.0:
            intervals.append((a, 1.0))

    if edge_id == snap_edge_id:
        delta = cutoff_sec / edge_cost
        a = _clamp01(snap_fraction - delta)
        b = _clamp01(snap_fraction + delta)
        if b > a:
            intervals.append((a, b))

    intervals = [(a, b) for a, b in intervals if b > a + 1e-9]
    return _merge_intervals(intervals)


def _route_functions(
    du: float,
    dv: float,
    c: float,
    edge_id: int,
    snap_edge_id: Optional[int],
    snap_fraction: float,
) -> list[tuple[float, float, float, float]]:
    """Return piecewise-linear travel-time functions as (slope, intercept, dom_a, dom_b).

    Each entry represents travel time at fraction s: ``slope * s + intercept``,
    valid only when dom_a ≤ s ≤ dom_b.
    """
    funcs: list[tuple[float, float, float, float]] = []
    if not math.isinf(du):
        funcs.append((c, du, 0.0, 1.0))
    if not math.isinf(dv):
        funcs.append((-c, dv + c, 0.0, 1.0))
    if edge_id == snap_edge_id:
        f = snap_fraction
        # c*|s - f| split at f
        funcs.append((-c, c * f, 0.0, f))
        funcs.append((c, -c * f, f, 1.0))
    return funcs


def _travel_time_at(
    s: float,
    funcs: list[tuple[float, float, float, float]],
) -> float:
    eps = 1e-9
    values = [
        m * s + b
        for (m, b, da, db) in funcs
        if da - eps <= s <= db + eps
    ]
    return min(values) if values else math.inf


def _candidate_s_values(
    a: float,
    b: float,
    funcs: list[tuple[float, float, float, float]],
) -> list[float]:
    """Endpoints + domain boundaries + pairwise intersections within [a, b]."""
    candidates: set[float] = {a, b, (a + b) / 2.0}
    for (_, _, da, db) in funcs:
        if a <= da <= b:
            candidates.add(da)
        if a <= db <= b:
            candidates.add(db)
    n = len(funcs)
    for i in range(n):
        m1, b1, da1, db1 = funcs[i]
        for j in range(i + 1, n):
            m2, b2, da2, db2 = funcs[j]
            if abs(m1 - m2) < 1e-12:
                continue
            s = (b2 - b1) / (m1 - m2)
            if not (a <= s <= b):
                continue
            if not (da1 - 1e-9 <= s <= db1 + 1e-9):
                continue
            if not (da2 - 1e-9 <= s <= db2 + 1e-9):
                continue
            candidates.add(s)
    return sorted(candidates)


def interval_attributes(
    a: float,
    b: float,
    du: float,
    dv: float,
    c: float,
    edge_id: int,
    snap_edge_id: Optional[int],
    snap_fraction: float,
    total_budget_sec: float,
) -> dict[str, float]:
    """Compute travel_sec_{min,mid,max} and activity_sec_{min,mid,max} over [a, b]."""
    funcs = _route_functions(du, dv, c, edge_id, snap_edge_id, snap_fraction)
    if not funcs:
        return {
            "travel_sec_min": math.inf, "travel_sec_mid": math.inf, "travel_sec_max": math.inf,
            "activity_sec_min": -math.inf, "activity_sec_mid": -math.inf, "activity_sec_max": -math.inf,
        }
    candidates = _candidate_s_values(a, b, funcs)
    travel_values = [_travel_time_at(s, funcs) for s in candidates]
    mid = (a + b) / 2.0
    travel_mid = _travel_time_at(mid, funcs)
    travel_min = min(travel_values)
    travel_max = max(travel_values)
    return {
        "travel_sec_min": travel_min,
        "travel_sec_mid": travel_mid,
        "travel_sec_max": travel_max,
        "activity_sec_min": total_budget_sec - 2.0 * travel_max,
        "activity_sec_mid": total_budget_sec - 2.0 * travel_mid,
        "activity_sec_max": total_budget_sec - 2.0 * travel_min,
    }


def _clip_edge_to_wgs84(
    graph: Graph, edge_id: int, a: float, b: float
) -> list[tuple[float, float]]:
    x0, y0, x1, y1 = graph.edge_endpoints_xy(edge_id)
    xa = x0 + a * (x1 - x0)
    ya = y0 + a * (y1 - y0)
    xb = x0 + b * (x1 - x0)
    yb = y0 + b * (y1 - y0)
    assert graph.metric_to_wgs84 is not None
    lon_a, lat_a = graph.metric_to_wgs84.transform(xa, ya)
    lon_b, lat_b = graph.metric_to_wgs84.transform(xb, yb)
    return [(lon_a, lat_a), (lon_b, lat_b)]


def build_origin_features(
    graph: Graph,
    snap: SnapResult,
    dist: list[float],
    candidate_edges: set[int],
    cutoff_sec: float,
    total_budget_sec: float,
    min_activity_sec: float,
) -> list[PPAFeature]:
    """Turn (dist, candidate_edges) into clipped reachable LineString features."""
    features: list[PPAFeature] = []
    for edge_id in candidate_edges:
        u, v = graph.edge_u[edge_id], graph.edge_v[edge_id]
        c = graph.edge_cost_sec[edge_id]
        du, dv = dist[u], dist[v]

        intervals = reachable_intervals_on_edge(
            du=du, dv=dv,
            edge_cost=c,
            cutoff_sec=cutoff_sec,
            edge_id=edge_id,
            snap_edge_id=snap.edge_id,
            snap_fraction=snap.fraction,
        )
        if not intervals:
            continue

        for a, b in intervals:
            attrs = interval_attributes(
                a=a, b=b,
                du=du, dv=dv, c=c,
                edge_id=edge_id,
                snap_edge_id=snap.edge_id,
                snap_fraction=snap.fraction,
                total_budget_sec=total_budget_sec,
            )
            if attrs["activity_sec_min"] + 1e-6 < min_activity_sec:
                continue
            coords = _clip_edge_to_wgs84(graph, edge_id, a, b)
            features.append(PPAFeature(
                edge_id=edge_id,
                interval_a=a,
                interval_b=b,
                highway=graph.edge_highway[edge_id],
                travel_sec_min=attrs["travel_sec_min"],
                travel_sec_mid=attrs["travel_sec_mid"],
                travel_sec_max=attrs["travel_sec_max"],
                activity_sec_min=attrs["activity_sec_min"],
                activity_sec_mid=attrs["activity_sec_mid"],
                activity_sec_max=attrs["activity_sec_max"],
                coords_wgs84=coords,
            ))
    return features


def compute_origin_ppa(
    graph: Graph,
    origin_lon: float,
    origin_lat: float,
    total_budget_sec: float,
    min_activity_sec: float,
    max_snap_m: float = 200.0,
    edge_index: EdgeIndex | None = None,
    workspace: DijkstraWorkspace | None = None,
) -> OriginPPAResult | None:
    """Full pipeline for one origin.

    Returns ``None`` when the origin cannot be snapped within ``max_snap_m`` or
    when ``total_budget_sec <= min_activity_sec`` (no travel time available).
    """
    if total_budget_sec <= min_activity_sec:
        return None
    cutoff_sec = (total_budget_sec - min_activity_sec) / 2.0
    if cutoff_sec <= 0:
        return None

    snap = snap_origin_to_graph(
        graph, origin_lon, origin_lat,
        max_snap_m=max_snap_m, edge_index=edge_index,
    )
    if snap is None:
        return None

    if workspace is not None:
        workspace.reset()
    dist, candidate_edges = bounded_dijkstra(
        graph, snap.seeds, cutoff_sec,
        workspace=workspace, snap_edge_id=snap.edge_id,
    )

    features = build_origin_features(
        graph=graph, snap=snap, dist=dist, candidate_edges=candidate_edges,
        cutoff_sec=cutoff_sec,
        total_budget_sec=total_budget_sec,
        min_activity_sec=min_activity_sec,
    )

    return OriginPPAResult(
        origin_lon=origin_lon,
        origin_lat=origin_lat,
        cutoff_sec=cutoff_sec,
        total_budget_sec=total_budget_sec,
        min_activity_sec=min_activity_sec,
        snap_distance_m=snap.distance_m,
        features=features,
    )


# Convenience: build a LineString from PPAFeature coords (caller-friendly)
def feature_linestring(feat: PPAFeature) -> LineString:
    return LineString(feat.coords_wgs84)
