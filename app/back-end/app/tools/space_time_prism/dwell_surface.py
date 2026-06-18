"""Flat H3 dwell-time surface aggregated from the network PPA edges.

The 3-D prism reads well only in the focused single-prism view: on the main map
the Z axis spans the whole (often multi-day) trajectory time range, so a prism
whose anchor window is small collapses into a sliver floating at altitude. The
default-mode visualization is therefore flat: each reachable road edge is
sampled into H3 cells and the cells are colored by the **best available
activity time** there — "if you stop here, how long could you stay and still
make it from A to B on time".

    dwell(cell) = max over edges in cell of activity_sec_max
                = T − min travel(A→x) − min travel(x→B)   (best point on edge)

The surface is an aggregate of the same two-cone PPA the 3-D prism shows; it
adds no new reachability information, just a ground-readable rendering of it.
"""
from __future__ import annotations

import logging
import math
from time import perf_counter
from typing import Any

import geopandas as gpd
import h3
import numpy as np
from shapely.geometry import Polygon

from .timing import log_phase
from .utils import _h3_cell_boundary

logger = logging.getLogger(__name__)

# Resolve the h3 API once (v4 names with v3 fallbacks, matching utils.py).
_LATLNG_TO_CELL = getattr(h3, "latlng_to_cell", None) or getattr(h3, "geo_to_h3")

# Average H3 cell area (km²) per resolution — drives auto-resolution.
_H3_CELL_KM2 = {6: 36.129, 7: 5.161, 8: 0.737, 9: 0.105, 10: 0.015, 11: 0.00214}

# Approximate hex width (m) per resolution — along-edge sampling step, so every
# hex a long road passes through receives at least one sample.
_H3_STEP_M = {6: 7000, 7: 2600, 8: 1000, 9: 370, 10: 140, 11: 53}

# Soft target for the number of emitted hex cells (rendering payload).
_TARGET_CELLS = 20_000

# Edges beyond this are uniformly subsampled before hexing — the surface is an
# aggregate, so thinning a pathological multi-hundred-thousand-edge PPA only
# costs coverage of the rarest cells.
_MAX_SURFACE_EDGES = 300_000


def _auto_resolution(bbox_km2: float) -> int:
    """Finest resolution whose expected cell count stays near the target.

    Roads visit only a fraction of the bounding box's cells; 0.4 is a generous
    estimate so the auto choice errs toward fewer, coarser cells.
    """
    for res in (10, 9, 8, 7):
        if 0.4 * bbox_km2 / _H3_CELL_KM2[res] <= _TARGET_CELLS:
            return res
    return 6


def dwell_surface_gdf(
    fast,
    total_budget_sec: float,
    min_activity_sec: float,
    options: dict[str, Any],
) -> gpd.GeoDataFrame | None:
    """Aggregate a FastPPA's edges into a flat H3 dwell-time surface.

    Uses the full reachable edge set (before the minor-road render filter and
    the render cap), so residential areas keep their dwell signal even when
    their roads are dropped from the drawn network.

    Returns None when there is nothing to aggregate.
    """
    n_all = len(fast.edge_id)
    if n_all == 0:
        return None

    _t = perf_counter()

    idx = np.arange(n_all)
    if n_all > _MAX_SURFACE_EDGES:
        idx = np.linspace(0, n_all - 1, _MAX_SURFACE_EDGES).astype(np.int64)

    lon0, lat0 = fast.lon0[idx], fast.lat0[idx]
    lon1, lat1 = fast.lon1[idx], fast.lat1[idx]
    a_max = fast.activity_sec_max[idx]

    # Resolution: explicit h3Resolution option, else auto from the reachable bbox.
    raw_res = options.get("h3Resolution")
    if raw_res is not None:
        resolution = max(6, min(11, int(raw_res)))
    else:
        west = float(min(lon0.min(), lon1.min()))
        east = float(max(lon0.max(), lon1.max()))
        south = float(min(lat0.min(), lat1.min()))
        north = float(max(lat0.max(), lat1.max()))
        cos_lat = max(0.1, abs(math.cos(math.radians((south + north) / 2.0))))
        bbox_km2 = max(
            (east - west) * 111.32 * cos_lat * (north - south) * 111.32, 1e-6,
        )
        resolution = _auto_resolution(bbox_km2)

    # Edge lengths (m) via equirectangular approximation — sampling only.
    mid_lat = float(np.mean(lat0))
    cos_mid = max(0.1, abs(math.cos(math.radians(mid_lat))))
    dx_m = (lon1 - lon0) * 111_320.0 * cos_mid
    dy_m = (lat1 - lat0) * 111_320.0
    length_m = np.hypot(dx_m, dy_m)
    step_m = _H3_STEP_M[resolution]
    # Samples per edge: both endpoints plus interior points every ~hex width.
    n_samples = np.clip(np.ceil(length_m / step_m).astype(np.int64) + 1, 2, 12)

    best_dwell: dict[str, float] = {}
    edge_count: dict[str, int] = {}
    to_cell = _LATLNG_TO_CELL
    for i in range(idx.size):
        k = int(n_samples[i])
        cells = {
            to_cell(
                float(lat0[i] + (lat1[i] - lat0[i]) * s / (k - 1)),
                float(lon0[i] + (lon1[i] - lon0[i]) * s / (k - 1)),
                resolution,
            )
            for s in range(k)
        }
        dwell = float(a_max[i])
        for cell in cells:
            if dwell > best_dwell.get(cell, -1.0):
                best_dwell[cell] = dwell
            edge_count[cell] = edge_count.get(cell, 0) + 1

    if not best_dwell:
        return None

    rows: list[dict] = []
    for cell, dwell_sec in best_dwell.items():
        boundary = _h3_cell_boundary(cell)
        ring = [(lng, lat) for lat, lng in boundary]
        ring.append(ring[0])
        rows.append({
            "geometry": Polygon(ring),
            "h3_index": cell,
            "dwell_minutes": round(dwell_sec / 60.0, 1),
            "edge_count": edge_count[cell],
            "total_budget_min": round(total_budget_sec / 60.0, 1),
            "min_activity_min": round(min_activity_sec / 60.0, 1),
            "_dataset_type": "ppa-dwell-surface",
        })

    gdf = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    gdf.attrs["warnings"] = [
        f"Dwell surface: {len(rows):,} H3 cells (resolution {resolution}) "
        f"from {idx.size:,} reachable edges."
    ]
    log_phase(f"dwell-surface: {len(rows)} cells at res {resolution}", _t)
    return gdf
