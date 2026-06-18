"""Lightweight per-phase timing for space-time prism computation.

Prism runs (especially the road-network mode) spend their time in a handful of
distinct phases — OSM download, graph build, Dijkstra, PPA assembly. These
helpers log how long each phase took so a slow run shows *where* the time went,
rather than just a single opaque total.

Two styles:

    # 1) Chained phase marks — minimal, no extra indentation:
    t = perf_counter()
    ...resolve roads...
    t = log_phase("network-prism: resolve roads", t)
    ...build graph...
    t = log_phase("network-prism: build graph", t)

    # 2) Context manager — when wrapping a block reads cleaner:
    with timed("network-prism: total"):
        ...

Output goes to the ``space_time_prism.timing`` logger at INFO, e.g.:

    space_time_prism.timing INFO: network-prism: build graph            842.3 ms
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from time import perf_counter

logger = logging.getLogger("space_time_prism.timing")


def log_phase(label: str, start: float) -> float:
    """Log elapsed ms since ``start`` for one phase; return a fresh start mark.

    The returned mark lets callers chain phases without restating
    ``perf_counter()`` at every boundary.
    """
    end = perf_counter()
    logger.info("%-40s %9.1f ms", label, (end - start) * 1000.0)
    return end


@contextmanager
def timed(label: str):
    """Log how long the wrapped block took, in milliseconds."""
    start = perf_counter()
    try:
        yield
    finally:
        logger.info("%-40s %9.1f ms", label, (perf_counter() - start) * 1000.0)
