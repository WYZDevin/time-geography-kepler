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

import hashlib
import json
import logging
import os
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Optional

import geopandas as gpd
import pandas as pd

from .profiles import ModeProfile


logger = logging.getLogger(__name__)


# Auto-download area cap (handbook §25). These bound how much OSM road data an
# interactive prism will pull *and build into a graph* per request — too large
# and the Overpass download + graph build + per-edge math grind for minutes.
# When the reachability extent exceeds the cap, the two-anchor prism downloads
# only a cap-sized corridor and clips (see network_prism._corridor_bbox_to_area).
# Faster modes reach farther, so their caps are larger; callers can override via
# ``options.maxAnalysisAreaKm2`` (e.g. when a local road dataset is loaded).
# Faster modes reach much farther in the same time budget, so their caps are
# larger. Vehicle modes (driving/transit) download only the through-road network
# (see road_network._DOWNLOAD_HIGHWAYS), so a large extent is still a modest
# download — their caps are sized for a realistic ~1.5 h trip.
MAX_ANALYSIS_AREA_KM2 = {
    "walking": 1_500.0,
    "cycling": 4_000.0,
    "transit": 15_000.0,
    "driving": 25_000.0,
}


_OSM_CACHE_MAX = 8
# (rounded_bbox, mode) -> GeoDataFrame
_osm_cache: "OrderedDict[tuple, gpd.GeoDataFrame]" = OrderedDict()

# Persistent on-disk cache so downloads survive backend restarts and Overpass
# outages. Each successful download is pickled under a bbox+mode hash, with an
# index.json recording every entry's bbox so a later *contained* request can
# reuse a larger cached extent (clipped) instead of re-hitting Overpass.
_DISK_LOCK = threading.Lock()


def _disk_cache_dir() -> Path:
    raw = os.environ.get("STP_OSM_CACHE_DIR")
    path = Path(raw) if raw else Path(tempfile.gettempdir()) / "stp-osm-cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _index_path() -> Path:
    return _disk_cache_dir() / "index.json"


def _load_disk_index() -> dict:
    # Read fresh each call (small file) so test isolation via STP_OSM_CACHE_DIR
    # works and concurrent writers are picked up.
    try:
        with _index_path().open() as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _entry_filename(bbox: tuple[float, float, float, float], mode: str) -> str:
    return hashlib.sha1(repr(_round_bbox_key(bbox, mode)).encode()).hexdigest() + ".pkl"


def _bbox_contains(outer, inner, tol: float = 1e-6) -> bool:
    return (
        outer[0] <= inner[0] + tol
        and outer[1] <= inner[1] + tol
        and outer[2] >= inner[2] - tol
        and outer[3] >= inner[3] - tol
    )


def _clip_to_bbox(gdf: gpd.GeoDataFrame, bbox) -> gpd.GeoDataFrame:
    """Whole road segments whose bounds intersect the bbox (keeps continuity)."""
    west, south, east, north = bbox
    return gdf.cx[west:east, south:north].copy()


def _read_pickle(path: Path) -> Optional[gpd.GeoDataFrame]:
    try:
        gdf = pd.read_pickle(path)
        if gdf is not None and not gdf.empty:
            return gdf
    except Exception:  # corrupt / version-incompatible pickle — ignore the entry
        logger.debug("osm disk cache: unreadable entry %s", path.name)
    return None


def _find_containing_in_memory(bbox, mode) -> Optional[gpd.GeoDataFrame]:
    # Newest first — prefer the most recently used containing extent.
    for key in reversed(list(_osm_cache.keys())):
        if key[4] != mode:
            continue
        if _bbox_contains(key[:4], bbox):
            clipped = _clip_to_bbox(_osm_cache[key], bbox)
            if not clipped.empty:
                return clipped
    return None


def _disk_get(bbox, mode) -> Optional[gpd.GeoDataFrame]:
    cache_dir = _disk_cache_dir()
    exact = cache_dir / _entry_filename(bbox, mode)
    if exact.exists():
        gdf = _read_pickle(exact)
        if gdf is not None:
            return gdf
    # Containment: reuse a larger cached extent, clipped to the request.
    for fname, meta in _load_disk_index().items():
        if meta.get("mode") != mode:
            continue
        if _bbox_contains(meta.get("bbox", (0, 0, 0, 0)), bbox):
            gdf = _read_pickle(cache_dir / fname)
            if gdf is None:
                continue
            clipped = _clip_to_bbox(gdf, bbox)
            if not clipped.empty:
                return clipped
    return None


def _disk_put(bbox, mode, gdf: gpd.GeoDataFrame) -> None:
    cache_dir = _disk_cache_dir()
    fname = _entry_filename(bbox, mode)
    with _DISK_LOCK:
        try:
            gdf.to_pickle(cache_dir / fname)
            index = _load_disk_index()
            index[fname] = {"bbox": [round(float(v), 6) for v in bbox], "mode": mode}
            tmp = _index_path().with_suffix(".json.tmp")
            with tmp.open("w") as fh:
                json.dump(index, fh)
            os.replace(tmp, _index_path())
        except OSError as exc:  # disk full / permission — caching is best-effort
            logger.debug("osm disk cache: write failed: %s", exc)


def _evict_osm_cache() -> None:
    while len(_osm_cache) > _OSM_CACHE_MAX:
        evicted, _ = _osm_cache.popitem(last=False)
        logger.debug("osm cache evicted %s", evicted[:4])


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
    source_out: list[str] | None = None,
) -> Optional[gpd.GeoDataFrame]:
    """Cached OSM road download.

    fetch_fn is injectable for tests — defaults to road_network._fetch_osm_roads.
    Returns None when the download fails. Always logs failures rather than
    propagating; the caller's PPA layer simply becomes empty for that request.

    ``source_out`` (optional) receives a single string naming where the roads
    came from — ``"memory"``, ``"memory-extent"``, ``"disk"`` or ``"network"`` —
    so callers can log "downloaded" vs "served from cache" truthfully instead of
    always claiming a download.
    """
    def _mark(source: str) -> None:
        if source_out is not None:
            source_out.append(source)

    key = _round_bbox_key(bbox, mode)
    hit = _osm_cache.get(key)
    if hit is not None:
        _osm_cache.move_to_end(key)
        logger.debug("osm cache hit for bbox %s mode=%s", key[:4], mode)
        _mark("memory")
        return hit

    # Reuse a larger already-downloaded extent (clipped) before going to network:
    # in-memory first, then the persistent disk cache (survives restarts/outages).
    contained = _find_containing_in_memory(bbox, mode)
    if contained is not None:
        logger.info("osm cache: reusing larger in-memory extent for bbox %s", key[:4])
        _mark("memory-extent")
        return contained

    disk = _disk_get(bbox, mode)
    if disk is not None:
        _osm_cache[key] = disk
        _evict_osm_cache()
        logger.info("osm cache: served bbox %s mode=%s from disk", key[:4], mode)
        _mark("disk")
        return disk

    try:
        if fetch_fn is None:
            # Lazy import to avoid pulling requests at module-load time. The real
            # fetcher takes ``mode`` so it can restrict the download to the road
            # classes that mode uses (much smaller for driving over big extents).
            from ..road_network import _fetch_osm_roads
            gdf = _fetch_osm_roads(bbox, buffer_deg=0.0, mode=mode)
        else:
            gdf = fetch_fn(bbox, buffer_deg=0.0)  # injected (tests) — old signature
    except Exception as exc:  # pragma: no cover — network failure path
        logger.warning("OSM download failed: %s", exc)
        return None

    if gdf is None or gdf.empty:
        return None

    _osm_cache[key] = gdf
    _evict_osm_cache()
    _disk_put(bbox, mode, gdf)
    _mark("network")
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
