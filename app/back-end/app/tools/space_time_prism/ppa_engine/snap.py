"""Snap a WGS84 origin point to the nearest edge of a road graph.

Uses ``shapely.STRtree`` over per-edge LineStrings — fast for the typical
100k-edge city extent and avoids the need for a separate grid index.
"""
from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from .graph_build import Graph


@dataclass(frozen=True)
class SnapResult:
    """Outcome of snapping an origin to a graph edge.

    seeds: Dijkstra start nodes — both endpoints of the snapped edge, weighted
    by the fraction along the edge from the snap point.

    fraction: snap location along the edge, 0 → graph.edge_u, 1 → graph.edge_v.
    """
    edge_id: int
    fraction: float
    distance_m: float
    snap_x: float
    snap_y: float
    seeds: tuple[tuple[int, float], ...]


def _snap_point_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> tuple[float, float, float, float]:
    """Closest point on segment AB to point P.

    Returns (fraction, sx, sy, dist) where 0 ≤ fraction ≤ 1.
    """
    vx, vy = bx - ax, by - ay
    denom = vx * vx + vy * vy
    if denom <= 0:
        dx, dy = px - ax, py - ay
        return 0.0, ax, ay, (dx * dx + dy * dy) ** 0.5
    wx, wy = px - ax, py - ay
    f = (wx * vx + wy * vy) / denom
    f = max(0.0, min(1.0, f))
    sx = ax + f * vx
    sy = ay + f * vy
    dx, dy = px - sx, py - sy
    return f, sx, sy, (dx * dx + dy * dy) ** 0.5


class EdgeIndex:
    """STRtree wrapper holding per-edge LineStrings in metric coordinates."""

    def __init__(self, graph: Graph):
        self._graph = graph
        self._lines: list[LineString] = []
        for i in range(graph.n_edges):
            x0, y0, x1, y1 = graph.edge_endpoints_xy(i)
            self._lines.append(LineString([(x0, y0), (x1, y1)]))
        self._tree = STRtree(self._lines) if self._lines else None

    def nearest_edges(self, px: float, py: float, k: int = 8) -> list[int]:
        """Return up to k candidate edge ids whose bbox is nearest to (px, py)."""
        if self._tree is None or not self._lines:
            return []
        pt = Point(px, py)
        # STRtree.query with predicate=None returns intersecting/nearby boxes;
        # query_nearest is available on Shapely 2.x.
        try:
            idxs = self._tree.query_nearest(pt, max_distance=None, return_distance=False)
        except (AttributeError, TypeError):
            # Fallback: brute query (small graphs / older shapely)
            idxs = list(range(len(self._lines)))
        result = list(map(int, idxs))[:k]
        return result


def snap_origin_to_graph(
    graph: Graph,
    origin_lon: float,
    origin_lat: float,
    max_snap_m: float = 200.0,
    edge_index: EdgeIndex | None = None,
) -> SnapResult | None:
    """Snap an origin lon/lat to the closest graph edge.

    Returns ``None`` when the closest edge is farther than ``max_snap_m``.
    """
    if graph.n_edges == 0 or graph.wgs84_to_metric is None:
        return None

    px, py = graph.wgs84_to_metric.transform(origin_lon, origin_lat)

    if edge_index is None:
        # No index — exhaustive search. Acceptable for small graphs and tests.
        candidates = range(graph.n_edges)
    else:
        candidates = edge_index.nearest_edges(px, py, k=16)
        if not candidates:
            candidates = range(graph.n_edges)

    best_dist = float("inf")
    best_edge = -1
    best_frac = 0.0
    best_sx = best_sy = 0.0

    for edge_id in candidates:
        u, v = graph.edge_u[edge_id], graph.edge_v[edge_id]
        ax, ay = graph.xs[u], graph.ys[u]
        bx, by = graph.xs[v], graph.ys[v]
        f, sx, sy, dist = _snap_point_to_segment(px, py, ax, ay, bx, by)
        if dist < best_dist:
            best_dist = dist
            best_edge = edge_id
            best_frac = f
            best_sx, best_sy = sx, sy

    if best_edge < 0 or best_dist > max_snap_m:
        return None

    cost = graph.edge_cost_sec[best_edge]
    u, v = graph.edge_u[best_edge], graph.edge_v[best_edge]
    seeds = (
        (u, best_frac * cost),
        (v, (1.0 - best_frac) * cost),
    )

    return SnapResult(
        edge_id=best_edge,
        fraction=best_frac,
        distance_m=best_dist,
        snap_x=best_sx,
        snap_y=best_sy,
        seeds=seeds,
    )
