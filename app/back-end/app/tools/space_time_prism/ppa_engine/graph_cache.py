"""Session-level cache for built road graphs + spatial indices.

Per PPA_ESTIMATION.md §24: even though the backend is stateless from the
user-data perspective, an in-process cache avoids rebuilding the same graph
when an interactive client (the prism explorer) rapidly re-runs the same
query while dragging sliders.

Cache key fingerprint includes:
    mode + profile signature  — different modes traverse the network differently
    metric CRS                — graph nodes are stored in this CRS
    road fingerprint          — feature count + bbox + sampled coords

We never identity-compare the road dict because Flask deserialises a fresh
copy per request. The fingerprint is cheap to compute and robust to
re-serialisation.

LRU eviction caps memory growth — recent graphs win.
"""
from __future__ import annotations

import logging
from collections import OrderedDict
from typing import Optional

import geopandas as gpd

from .graph_build import Graph, build_road_graph
from .profiles import ModeProfile
from .snap import EdgeIndex


logger = logging.getLogger(__name__)


_MAX_ENTRIES = 8


# (key) -> (Graph, EdgeIndex)
_cache: "OrderedDict[tuple, tuple[Graph, EdgeIndex]]" = OrderedDict()


def _fingerprint_roads(roads_wgs84: gpd.GeoDataFrame) -> tuple:
    """Cheap content fingerprint stable across request boundaries."""
    n = len(roads_wgs84)
    if n == 0:
        return (0,)
    bounds = roads_wgs84.total_bounds
    # Sample a handful of representative coordinates to disambiguate
    # networks with identical feature counts + bbox.
    sample_idxs = (0, n // 4, n // 2, 3 * n // 4, n - 1)
    samples = []
    for i in sample_idxs:
        geom = roads_wgs84.geometry.iloc[i]
        if geom is None or geom.is_empty:
            samples.append(0.0)
            continue
        # First coord pair of LineString / first ring of MultiLineString
        try:
            if geom.geom_type == "LineString":
                x, y = geom.coords[0]
            else:
                x, y = geom.geoms[0].coords[0]
            samples.append(round(x, 5))
            samples.append(round(y, 5))
        except (IndexError, AttributeError):
            samples.append(0.0)
    return (n, *(round(b, 5) for b in bounds), *samples)


def _profile_signature(profile: ModeProfile) -> tuple:
    return (profile.mode, profile.default_kmh, profile.max_speed_kmh)


def get_or_build_graph(
    roads_wgs84: gpd.GeoDataFrame,
    metric_crs: str,
    profile: ModeProfile,
) -> tuple[Graph, EdgeIndex]:
    """Return a cached (graph, edge_index) pair or build + cache a new one."""
    key = (
        metric_crs,
        _profile_signature(profile),
        _fingerprint_roads(roads_wgs84),
    )
    hit = _cache.get(key)
    if hit is not None:
        # Move to end — LRU touch
        _cache.move_to_end(key)
        logger.debug("ppa graph cache hit: %d nodes / %d edges", hit[0].n_nodes, hit[0].n_edges)
        return hit

    graph = build_road_graph(roads_wgs84, metric_crs, profile)
    edge_index = EdgeIndex(graph) if graph.n_edges else EdgeIndex(graph)
    _cache[key] = (graph, edge_index)

    # Evict oldest entries above cap
    while len(_cache) > _MAX_ENTRIES:
        evicted_key, _ = _cache.popitem(last=False)
        logger.debug("ppa graph cache evicted entry: %s", evicted_key[:2])

    logger.debug("ppa graph cache miss: built %d nodes / %d edges", graph.n_nodes, graph.n_edges)
    return graph, edge_index


def clear_cache() -> None:
    """Wipe the cache — used by tests."""
    _cache.clear()


def cache_size() -> int:
    return len(_cache)


def cache_stats() -> dict:
    """Snapshot for debugging."""
    return {
        "entries": len(_cache),
        "capacity": _MAX_ENTRIES,
        "keys": [k[:2] for k in _cache.keys()],
    }


def _peek_key(roads_wgs84: gpd.GeoDataFrame, metric_crs: str, profile: ModeProfile) -> Optional[tuple]:
    """Test helper — return the key without touching LRU order."""
    return (
        metric_crs,
        _profile_signature(profile),
        _fingerprint_roads(roads_wgs84),
    )
