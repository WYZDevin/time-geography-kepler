"""Two-anchor network space-time prism.

This generalises the single-origin symmetric model in ``reachability.py`` to the
classic Hägerstrand prism defined by *two* anchor points A and B:

    T     = t_B - t_A                       total time budget (sec)
    A_min = minimum activity time (sec)
    d_a(x) = shortest travel time from anchor A to x   (forward cone)
    d_b(x) = shortest travel time from x to anchor B    (backward cone, undirected)

A road point x belongs to the *potential path area* (PPA) when there is still
time to perform the activity after travelling A -> x -> B::

    d_a(x) + d_b(x) + A_min <= T          <=>     d_a(x) + d_b(x) <= K,  K = T - A_min

and the activity time actually available at x is::

    activity(x) = T - d_a(x) - d_b(x)      (>= A_min on the PPA)

Both ``d_a`` and ``d_b`` are piecewise-linear along an edge (the lower envelope of
the "from u", "from v" and — on the snapped edge — "from snap point" route lines,
exactly as in ``reachability.py``). The feasible PPA region on an edge is therefore
the set where the *sum* of the two envelopes stays below ``K``.

This module exposes two paths:

* ``feasible_intervals`` — the exact per-edge breakpoint solver (unit-tested
  reference for the two-cone interval math).
* ``compute_ppa_fast`` — the vectorised path used in production: it labels every
  candidate edge from the two Dijkstra distance arrays at once, keeps whole edges
  whose best point is feasible, and lifts each to a height from the midpoint of
  its occupiable time window (low near A, high near B). This is O(edges); the 3-D
  prism is the height-stacked roads and the flat ground projection is the 2-D PPA.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .graph_build import Graph
from .reachability import _merge_intervals

_EPS = 1e-9

# Sentinel for "unreached" node distances in the vectorised path — large enough
# to dominate any min() but finite, so numpy arithmetic never produces inf/nan.
_SENTINEL = 1.0e15

# A route line is (slope, intercept, domain_a, domain_b); its value at fraction s
# is ``slope * s + intercept`` and it is only valid for domain_a <= s <= domain_b.
RouteLine = tuple[float, float, float, float]


def _cone_lines(
    du: float, dv: float, c: float, is_snap_edge: bool, snap_fraction: float
) -> list[RouteLine]:
    """Route lines whose lower envelope is the travel time ``d(s)`` along an edge."""
    lines: list[RouteLine] = []
    if not math.isinf(du):
        lines.append((c, du, 0.0, 1.0))           # du + c*s
    if not math.isinf(dv):
        lines.append((-c, dv + c, 0.0, 1.0))       # dv + c*(1-s)
    if is_snap_edge:
        f = snap_fraction
        lines.append((-c, c * f, 0.0, f))          # c*(f - s) for s <= f
        lines.append((c, -c * f, f, 1.0))          # c*(s - f) for s >= f
    return lines


def _envelope_at(s: float, lines: list[RouteLine]) -> float:
    """Lower envelope value ``d(s)`` (min over the route lines valid at ``s``)."""
    best = math.inf
    for m, b, da, db in lines:
        if da - _EPS <= s <= db + _EPS:
            v = m * s + b
            if v < best:
                best = v
    return best


def _cone_breaks(lines: list[RouteLine]) -> set[float]:
    """Fractions in [0, 1] where the lower envelope may switch active line."""
    brks: set[float] = set()
    for _, _, da, db in lines:
        if 0.0 <= da <= 1.0:
            brks.add(da)
        if 0.0 <= db <= 1.0:
            brks.add(db)
    n = len(lines)
    for i in range(n):
        m1, b1, _, _ = lines[i]
        for j in range(i + 1, n):
            m2, b2, _, _ = lines[j]
            if abs(m1 - m2) < 1e-12:
                continue
            s = (b2 - b1) / (m1 - m2)
            if 0.0 <= s <= 1.0:
                brks.add(s)
    return brks


def feasible_intervals(
    lines_a: list[RouteLine],
    lines_b: list[RouteLine],
    budget_k: float,
) -> list[tuple[float, float]]:
    """Sub-intervals of [0, 1] where ``d_a(s) + d_b(s) <= budget_k``.

    ``g = d_a + d_b`` is piecewise-linear; within each gap between consecutive
    breakpoints both envelopes are a single line, so ``g`` is linear there and the
    feasible part is found by thresholding the segment.
    """
    if not lines_a or not lines_b:
        return []

    breaks = {0.0, 1.0}
    breaks |= _cone_breaks(lines_a)
    breaks |= _cone_breaks(lines_b)
    pts = sorted(b for b in breaks if 0.0 <= b <= 1.0)

    out: list[tuple[float, float]] = []
    for s0, s1 in zip(pts[:-1], pts[1:]):
        if s1 - s0 < _EPS:
            continue
        g0 = _envelope_at(s0, lines_a) + _envelope_at(s0, lines_b)
        g1 = _envelope_at(s1, lines_a) + _envelope_at(s1, lines_b)
        if math.isinf(g0) or math.isinf(g1):
            continue
        in0 = g0 <= budget_k + 1e-6
        in1 = g1 <= budget_k + 1e-6
        if in0 and in1:
            out.append((s0, s1))
        elif not in0 and not in1:
            continue
        else:
            # One endpoint feasible: find the crossing of the linear g with K.
            denom = g1 - g0
            t = 0.5 if abs(denom) < 1e-12 else (budget_k - g0) / denom
            t = max(0.0, min(1.0, t))
            s_cross = s0 + t * (s1 - s0)
            if in0:
                out.append((s0, s_cross))
            else:
                out.append((s_cross, s1))
    return _merge_intervals(out)


@dataclass(frozen=True)
class FastPPA:
    """Vectorised PPA result — one reachable road edge per array entry.

    Each edge is kept whole (no sub-edge interval clipping); boundary edges are
    over-included by at most one short segment, which is invisible at road
    scale and avoids the per-edge interval math that does not scale to a full
    city network.
    """
    edge_id: np.ndarray         # int64 [N]
    lon0: np.ndarray            # float64 [N]
    lat0: np.ndarray
    lon1: np.ndarray
    lat1: np.ndarray
    z: np.ndarray               # height of the edge (time-window midpoint)
    time_progress: np.ndarray   # z mapped back to [0, 1]
    activity_sec_min: np.ndarray
    activity_sec_mid: np.ndarray
    activity_sec_max: np.ndarray
    travel_total_min: np.ndarray
    forward_sec: np.ndarray     # d_a: shortest travel time A → edge (best endpoint)
    backward_sec: np.ndarray    # d_b: shortest travel time edge → B (best endpoint)

    def __len__(self) -> int:
        return int(self.edge_id.size)


def compute_ppa_fast(
    graph: Graph,
    dist_a: list[float],
    dist_b: list[float],
    candidate_edges,
    total_budget_sec: float,
    min_activity_sec: float,
    z_start: float,
    z_end: float,
    time_scale: float = 1.0,
) -> FastPPA | None:
    """Vectorised two-cone PPA — O(edges), one whole edge per reachable road.

    Each edge is lifted to a height from the midpoint of the time window during
    which it can be occupied (``[t_A + d_a, t_B - d_b]`` at the edge's best
    point), so roads near A sit low, roads near B sit high, and the stack forms
    the 3-D prism. The flat ground projection of the same edges is the 2-D PPA.

    time_scale converts graph-unit travel times (free-flow profile speeds) to
    real seconds: real = graph_time x time_scale. A uniform speed factor f
    (real speed = f x profile speed) gives time_scale = 1/f, so the cached
    graph never needs rebuilding. Budgets stay in real seconds.
    """
    budget_k = total_budget_sec - min_activity_sec
    edges = np.fromiter(candidate_edges, dtype=np.int64, count=len(candidate_edges))
    if edges.size == 0:
        return None

    eu = np.asarray(graph.edge_u, dtype=np.int64)[edges]
    ev = np.asarray(graph.edge_v, dtype=np.int64)[edges]
    c = np.asarray(graph.edge_cost_sec, dtype=np.float64)[edges] * time_scale

    da = np.asarray(dist_a, dtype=np.float64).copy() * time_scale
    db = np.asarray(dist_b, dtype=np.float64).copy() * time_scale
    da[~np.isfinite(da)] = _SENTINEL
    db[~np.isfinite(db)] = _SENTINEL
    du_a, dv_a = da[eu], da[ev]
    du_b, dv_b = db[eu], db[ev]

    def _g_at(s: float) -> np.ndarray:
        # d_a(s) + d_b(s) using the lower-envelope tent for each cone.
        d_a = np.minimum(du_a + c * s, dv_a + c * (1.0 - s))
        d_b = np.minimum(du_b + c * s, dv_b + c * (1.0 - s))
        return d_a + d_b

    # g is piecewise-linear and concave; its minimum is at an endpoint and its
    # maximum at an interior breakpoint. Sample a few fractions for min/max —
    # exact enough for the reachability fringe of a viz.
    g0, g1 = _g_at(0.0), _g_at(1.0)
    g_mid = _g_at(0.5)
    g_max = np.maximum.reduce([g0, g1, g_mid, _g_at(0.25), _g_at(0.75)])
    g_min = np.minimum(g0, g1)

    feasible = g_min <= budget_k + 1e-6
    if not feasible.any():
        return None

    edges = edges[feasible]
    eu, ev, c = eu[feasible], ev[feasible], c[feasible]
    du_a, dv_a = du_a[feasible], dv_a[feasible]
    du_b, dv_b = du_b[feasible], dv_b[feasible]
    g_min, g_mid, g_max = g_min[feasible], g_mid[feasible], g_max[feasible]

    # Height: midpoint of the occupiable window at the edge's best-reached point.
    # window = [t_A + d_a_min, t_B - d_b_min]; centre fraction in [0, 1] is
    # 0.5 + (d_a_min - d_b_min) / (2T).
    t = float(total_budget_sec)
    da_min = np.minimum(du_a, dv_a)
    db_min = np.minimum(du_b, dv_b)
    frac = np.clip(0.5 + (da_min - db_min) / (2.0 * t), 0.0, 1.0)
    z = z_start + frac * (z_end - z_start)

    # Batched metric -> WGS84 for both endpoints.
    xs = np.asarray(graph.xs, dtype=np.float64)
    ys = np.asarray(graph.ys, dtype=np.float64)
    lon0, lat0 = graph.metric_to_wgs84.transform(xs[eu], ys[eu])
    lon1, lat1 = graph.metric_to_wgs84.transform(xs[ev], ys[ev])

    return FastPPA(
        edge_id=edges,
        lon0=np.asarray(lon0), lat0=np.asarray(lat0),
        lon1=np.asarray(lon1), lat1=np.asarray(lat1),
        z=z, time_progress=frac,
        activity_sec_min=np.maximum(0.0, t - g_max),
        activity_sec_mid=t - g_mid,
        activity_sec_max=t - g_min,
        travel_total_min=g_min,
        forward_sec=da_min,
        backward_sec=db_min,
    )


def shortest_path_sec(dist_a: list[float], snap_b) -> float:
    """Shortest A->B travel time using A's distance labels at B's snap seeds."""
    best = math.inf
    for node, seed_cost in snap_b.seeds:
        if 0 <= node < len(dist_a):
            d = dist_a[node]
            if not math.isinf(d):
                best = min(best, d + seed_cost)
    return best
