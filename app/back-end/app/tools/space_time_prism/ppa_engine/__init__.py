"""PPA road-network reachability engine.

Implements the undirected, symmetric activity-time model from PPA_ESTIMATION.md:

    R = (T - A) / 2

where T = total time budget, A = minimum activity time, R = one-way travel cutoff.

Public entry points:
    build_road_graph     — convert a road-network GeoDataFrame into a Graph
    snap_origin_to_graph — snap a WGS84 origin to the nearest graph edge
    bounded_dijkstra     — bounded shortest-path from snapped origin seeds
    compute_origin_ppa   — convenience: snap + Dijkstra + reachable LineStrings
"""
from __future__ import annotations

from .extent import (
    clear_osm_cache,
    compute_padded_extent,
    extent_area_km2,
    fetch_or_cache_osm_roads,
    is_extent_too_large,
)
from .graph_build import Graph, build_road_graph
from .graph_cache import clear_cache, get_or_build_graph
from .profiles import ModeProfile, make_mode_profile
from .snap import SnapResult, snap_origin_to_graph
from .dijkstra import bounded_dijkstra, DijkstraWorkspace
from .reachability import compute_origin_ppa, OriginPPAResult, PPAFeature
from .two_anchor import (
    compute_ppa_fast,
    FastPPA,
    feasible_intervals,
    shortest_path_sec,
)

__all__ = [
    "Graph",
    "build_road_graph",
    "get_or_build_graph",
    "clear_cache",
    "ModeProfile",
    "make_mode_profile",
    "SnapResult",
    "snap_origin_to_graph",
    "bounded_dijkstra",
    "DijkstraWorkspace",
    "compute_origin_ppa",
    "OriginPPAResult",
    "PPAFeature",
    "compute_ppa_fast",
    "FastPPA",
    "feasible_intervals",
    "shortest_path_sec",
    "compute_padded_extent",
    "extent_area_km2",
    "is_extent_too_large",
    "fetch_or_cache_osm_roads",
    "clear_osm_cache",
]
