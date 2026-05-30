"""Build a compact undirected graph from a road-network GeoDataFrame.

The input is a GeoDataFrame of LineString/MultiLineString features that may
or may not carry OSM ``highway`` tags. We slice each line into per-segment
edges (consecutive coordinate pairs) so per-edge interval clipping is trivial.

Coordinate-rounded node deduplication merges shared endpoints between lines,
which is essential — otherwise a "T-intersection" between two LineStrings
that touch at the same coordinate would not actually share a graph node.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import geopandas as gpd
import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString

from .profiles import ModeProfile, parse_maxspeed_kmh


# Rounding precision for node deduplication in metric coordinates.
# 1 cm is well below GPS noise but tight enough to catch genuine shared nodes.
_NODE_ROUND_M = 0.01


@dataclass
class Graph:
    """Compact representation. Parallel arrays keyed by node/edge index."""
    # Node arrays — index in [0, n_nodes)
    xs: list[float] = field(default_factory=list)        # projected metric x
    ys: list[float] = field(default_factory=list)        # projected metric y

    # Edge arrays — index in [0, n_edges)
    edge_u: list[int] = field(default_factory=list)
    edge_v: list[int] = field(default_factory=list)
    edge_cost_sec: list[float] = field(default_factory=list)
    edge_length_m: list[float] = field(default_factory=list)
    edge_highway: list[Optional[str]] = field(default_factory=list)
    edge_source_id: list[int] = field(default_factory=list)  # source feature index

    # Adjacency: adj[u] = [(v, cost_sec, edge_id), ...]
    adj: list[list[tuple[int, float, int]]] = field(default_factory=list)

    # Projection metadata so callers can lift results back to WGS84
    metric_crs: Optional[str] = None
    metric_to_wgs84: Optional[Transformer] = None
    wgs84_to_metric: Optional[Transformer] = None

    # Quick stats
    n_excluded: int = 0      # features skipped by mode profile
    n_segments: int = 0      # edges produced

    @property
    def n_nodes(self) -> int:
        return len(self.xs)

    @property
    def n_edges(self) -> int:
        return len(self.edge_u)

    def edge_endpoints_xy(self, edge_id: int) -> tuple[float, float, float, float]:
        u, v = self.edge_u[edge_id], self.edge_v[edge_id]
        return self.xs[u], self.ys[u], self.xs[v], self.ys[v]


def _iter_segments(geom):
    """Yield consecutive (x0, y0, x1, y1) pairs from a LineString/MultiLineString."""
    if isinstance(geom, LineString):
        coords = list(geom.coords)
        for i in range(len(coords) - 1):
            yield coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]
    elif isinstance(geom, MultiLineString):
        for line in geom.geoms:
            yield from _iter_segments(line)


def _node_key(x: float, y: float) -> tuple[int, int]:
    """Rounded integer key for node deduplication."""
    return (int(round(x / _NODE_ROUND_M)), int(round(y / _NODE_ROUND_M)))


def build_road_graph(
    roads_wgs84: gpd.GeoDataFrame,
    metric_crs: str,
    profile: ModeProfile,
    highway_col: str = "highway",
    maxspeed_col: str = "maxspeed",
) -> Graph:
    """Build an undirected graph from a WGS84 road-network GeoDataFrame.

    Each LineString is cut into per-segment edges; shared endpoints become
    shared graph nodes via coordinate rounding.

    The output stores nodes in *metric* (projected) coordinates. Use
    ``graph.metric_to_wgs84.transform(x, y)`` to convert back when emitting GeoJSON.
    """
    graph = Graph(metric_crs=metric_crs)
    graph.metric_to_wgs84 = Transformer.from_crs(metric_crs, "EPSG:4326", always_xy=True)
    graph.wgs84_to_metric = Transformer.from_crs("EPSG:4326", metric_crs, always_xy=True)

    if roads_wgs84 is None or roads_wgs84.empty:
        return graph

    # Project to metric CRS for distance computation
    if roads_wgs84.crs is None:
        roads_wgs84 = roads_wgs84.set_crs("EPSG:4326")
    roads_m = roads_wgs84.to_crs(metric_crs)

    # Find highway/maxspeed columns case-insensitively
    cols = {c.lower(): c for c in roads_m.columns}
    hwy_col = cols.get(highway_col.lower())
    maxspeed_col_actual = cols.get(maxspeed_col.lower())

    node_index: dict[tuple[int, int], int] = {}

    def _get_or_add_node(x: float, y: float) -> int:
        key = _node_key(x, y)
        idx = node_index.get(key)
        if idx is None:
            idx = len(graph.xs)
            node_index[key] = idx
            graph.xs.append(x)
            graph.ys.append(y)
            graph.adj.append([])
        return idx

    for source_id, row in enumerate(roads_m.itertuples(index=False)):
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        highway = getattr(row, hwy_col, None) if hwy_col else None
        if isinstance(highway, float) and math.isnan(highway):
            highway = None
        if highway is not None:
            highway = str(highway).strip() or None

        if profile.is_excluded(highway):
            graph.n_excluded += 1
            continue

        # Resolve effective speed: maxspeed tag → profile lookup → default
        speed_kmh: Optional[float] = None
        if maxspeed_col_actual:
            raw = getattr(row, maxspeed_col_actual, None)
            speed_kmh = parse_maxspeed_kmh(raw)
        if speed_kmh is None:
            speed_kmh = profile.speed_for_highway(highway)
        speed_kmh = max(0.5, min(speed_kmh, profile.max_speed_kmh * 1.1))
        speed_mps = speed_kmh / 3.6

        for x0, y0, x1, y1 in _iter_segments(geom):
            dx, dy = x1 - x0, y1 - y0
            length_m = math.sqrt(dx * dx + dy * dy)
            if length_m < _NODE_ROUND_M:
                continue
            cost_sec = length_m / speed_mps
            u = _get_or_add_node(x0, y0)
            v = _get_or_add_node(x1, y1)
            if u == v:
                continue
            edge_id = len(graph.edge_u)
            graph.edge_u.append(u)
            graph.edge_v.append(v)
            graph.edge_cost_sec.append(cost_sec)
            graph.edge_length_m.append(length_m)
            graph.edge_highway.append(highway)
            graph.edge_source_id.append(source_id)
            graph.adj[u].append((v, cost_sec, edge_id))
            graph.adj[v].append((u, cost_sec, edge_id))

    graph.n_segments = len(graph.edge_u)
    return graph


def edge_bbox(graph: Graph, edge_id: int) -> tuple[float, float, float, float]:
    """(min_x, min_y, max_x, max_y) bounding box for an edge in metric coords."""
    x0, y0, x1, y1 = graph.edge_endpoints_xy(edge_id)
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def edge_bboxes(graph: Graph) -> np.ndarray:
    """Return a (n_edges, 4) array of edge bboxes for vectorised spatial queries."""
    n = graph.n_edges
    out = np.empty((n, 4), dtype=np.float64)
    for i in range(n):
        x0, y0, x1, y1 = graph.edge_endpoints_xy(i)
        out[i, 0] = min(x0, x1)
        out[i, 1] = min(y0, y1)
        out[i, 2] = max(x0, x1)
        out[i, 3] = max(y0, y1)
    return out
