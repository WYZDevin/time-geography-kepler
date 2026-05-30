"""Bounded Dijkstra with reusable workspace.

Per PPA_ESTIMATION.md §15: for 100+ origins, the dist array is reused
between origin calls — only the *touched* nodes are reset each time.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

from .graph_build import Graph


@dataclass
class DijkstraWorkspace:
    """Reusable scratch arrays for bounded Dijkstra over a fixed graph.

    Caller pattern:
        ws = DijkstraWorkspace(graph)
        for origin in origins:
            ws.reset()
            dist, edges = bounded_dijkstra(graph, ws, seeds, cutoff)
            ...
    """
    n_nodes: int
    dist: list[float] = field(default_factory=list)
    touched_nodes: list[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.dist:
            self.dist = [math.inf] * self.n_nodes

    def reset(self) -> None:
        for node in self.touched_nodes:
            self.dist[node] = math.inf
        self.touched_nodes.clear()


def bounded_dijkstra(
    graph: Graph,
    seeds: tuple[tuple[int, float], ...] | list[tuple[int, float]],
    cutoff_sec: float,
    workspace: DijkstraWorkspace | None = None,
    snap_edge_id: int | None = None,
) -> tuple[list[float], set[int]]:
    """Bounded Dijkstra from seed nodes with travel-time cutoff.

    Returns (dist, candidate_edges) where:
        dist[i]         = shortest travel time to node i, or inf
        candidate_edges = every edge_id touched by the relaxation —
                          includes edges where one endpoint is in range but
                          the other is not (still useful for partial intervals)

    snap_edge_id, when given, is added to candidate_edges even if neither
    endpoint is reachable — handles the "origin in middle of long rural
    segment" case (Test 4 from PPA_ESTIMATION.md §26).
    """
    if workspace is None:
        workspace = DijkstraWorkspace(graph.n_nodes)

    dist = workspace.dist
    touched = workspace.touched_nodes
    candidate_edges: set[int] = set()
    if snap_edge_id is not None:
        candidate_edges.add(snap_edge_id)

    pq: list[tuple[float, int]] = []
    for node, cost in seeds:
        if not (0 <= node < graph.n_nodes):
            continue
        if cost <= cutoff_sec and cost < dist[node]:
            if dist[node] == math.inf:
                touched.append(node)
            dist[node] = cost
            heapq.heappush(pq, (cost, node))

    while pq:
        cost, u = heapq.heappop(pq)
        if cost != dist[u]:
            continue
        if cost > cutoff_sec:
            break
        for v, edge_cost, edge_id in graph.adj[u]:
            candidate_edges.add(edge_id)
            new_cost = cost + edge_cost
            if new_cost <= cutoff_sec and new_cost < dist[v]:
                if math.isinf(dist[v]):
                    touched.append(v)
                dist[v] = new_cost
                heapq.heappush(pq, (new_cost, v))

    return dist, candidate_edges
