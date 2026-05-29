"""Analysis extent computation + cached OSM download.

Per PPA_ESTIMATION.md §6, §7, §21, §24:

    R = (T - A) / 2
    buffer_m = max_speed_mps × R × safety_factor

Origins must be covered, the user-visible extent should be covered, and a
travel buffer is added so a route briefly leaving the visible extent still
finds the correct shortest path.

OSM download results are cached by rounded bbox + mode to avoid hammering
Overpass on every slider tick of an interactive prism explorer.
"""
from __future__ import annotations

import logging
from collections import OrderedDict
from typing import Optional

import geopandas as gpd

from .profiles import ModeProfile


logger = logging.getLogger(__name__)


# Soft area cap (handbook §25) — guards against pathological extent that
# would hammer Overpass. The interactive prism explorer relies on real
# trajectories whose padded extents routinely exceed the handbook defaults,
# so the caps here are generous; callers can override via
# ``options.maxAnalysisAreaKm2`` when even larger downloads are desired.
MAX_ANALYSIS_AREA_KM2 = {
    "walking": 5_000.0,
    "cycling": 10_000.0,
    "transit": 20_000.0,
    "driving": 50_000.0,
}


_OSM_CACHE_MAX = 8
# (rounded_bbox, mode) -> GeoDataFrame
_osm_cache: "OrderedDict[tuple, gpd.GeoDataFrame]" = OrderedDict()


def compute_padded_extent(
    origin_lons,
    origin_lats,
    profile: ModeProfile,
    cutoff_sec: float,
    safety_factor: float = 1.2,
    anchor_a: dict | None = None,
    anchor_b: dict | None = None,
) -> tuple[float, float, float, float]:
    """Bounding box (west, south, east, north) in WGS84 with a travel buffer.

    Covers all origins + both anchors and pads by the maximum reachable distance
    at the profile's top speed within cutoff_sec.
    """
    import numpy as np

    lons = list(np.asarray(origin_lons, dtype=float).flatten())
    lats = list(np.asarray(origin_lats, dtype=float).flatten())
    if anchor_a is not None:
        lons.append(float(anchor_a["lng"]))
        lats.append(float(anchor_a["lat"]))
    if anchor_b is not None:
        lons.append(float(anchor_b["lng"]))
        lats.append(float(anchor_b["lat"]))
    if not lons:
        raise ValueError("compute_padded_extent: no points supplied")

    min_lng, max_lng = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)

    max_speed_mps = profile.max_speed_kmh / 3.6
    buffer_m = max_speed_mps * max(0.0, cutoff_sec) * safety_factor
    # 1 degree latitude ≈ 111 km; longitude shrinks with cos(lat).
    avg_lat = (min_lat + max_lat) / 2.0
    cos_lat = max(0.1, abs(_cos_deg(avg_lat)))
    buffer_lat_deg = buffer_m / 111_000.0
    buffer_lng_deg = buffer_m / (111_000.0 * cos_lat)

    return (
        min_lng - buffer_lng_deg,
        min_lat - buffer_lat_deg,
        max_lng + buffer_lng_deg,
        max_lat + buffer_lat_deg,
    )


def extent_area_km2(bbox: tuple[float, float, float, float]) -> float:
    """Approximate area of a WGS84 bbox in km²."""
    west, south, east, north = bbox
    avg_lat = (north + south) / 2.0
    cos_lat = max(0.1, abs(_cos_deg(avg_lat)))
    dx_km = (east - west) * 111.0 * cos_lat
    dy_km = (north - south) * 111.0
    return max(0.0, dx_km) * max(0.0, dy_km)


def is_extent_too_large(
    bbox: tuple[float, float, float, float],
    mode: str,
    cap_override_km2: float | None = None,
) -> tuple[bool, float, float]:
    """Return (too_large, actual_km2, cap_km2).

    ``cap_override_km2`` lets callers raise (or lower) the per-mode cap for
    a single request, e.g. via ``options.maxAnalysisAreaKm2``.
    """
    cap = (
        float(cap_override_km2)
        if cap_override_km2 is not None and cap_override_km2 > 0
        else MAX_ANALYSIS_AREA_KM2.get(mode, MAX_ANALYSIS_AREA_KM2["walking"])
    )
    area = extent_area_km2(bbox)
    return area > cap, area, cap


def fetch_or_cache_osm_roads(
    bbox: tuple[float, float, float, float],
    mode: str,
    *,
    fetch_fn=None,
) -> Optional[gpd.GeoDataFrame]:
    """Cached OSM road download.

    fetch_fn is injectable for tests — defaults to road_network._fetch_osm_roads.
    Returns None when the download fails. Always logs failures rather than
    propagating; the caller's PPA layer simply becomes empty for that request.
    """
    key = _round_bbox_key(bbox, mode)
    hit = _osm_cache.get(key)
    if hit is not None:
        _osm_cache.move_to_end(key)
        logger.debug("osm cache hit for bbox %s mode=%s", key[:4], mode)
        return hit

    if fetch_fn is None:
        # Lazy import to avoid pulling requests at module-load time
        from ..road_network import _fetch_osm_roads
        fetch_fn = _fetch_osm_roads

    try:
        gdf = fetch_fn(bbox, buffer_deg=0.0)  # bbox already padded
    except Exception as exc:  # pragma: no cover — network failure path
        logger.warning("OSM download failed: %s", exc)
        return None

    if gdf is None or gdf.empty:
        return None

    _osm_cache[key] = gdf
    while len(_osm_cache) > _OSM_CACHE_MAX:
        evicted, _ = _osm_cache.popitem(last=False)
        logger.debug("osm cache evicted %s", evicted[:4])
    return gdf


def clear_osm_cache() -> None:
    _osm_cache.clear()


def osm_cache_size() -> int:
    return len(_osm_cache)


# ────────────────────────────────────────────────────────────────────────

def _round_bbox_key(
    bbox: tuple[float, float, float, float], mode: str,
) -> tuple:
    # ~110 m precision at the equator — enough to dedupe semantically identical
    # repeat requests from a slider drag while still resolving distinct extents.
    return tuple(round(v, 3) for v in bbox) + (mode,)


def _cos_deg(deg: float) -> float:
    import math
    return math.cos(math.radians(deg))
