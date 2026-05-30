import math
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import h3
import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon


SPEED_PRESETS = {
    "walking": 5,
    "cycling": 15,
    "transit": 30,
    "driving": 60,
}


@dataclass(frozen=True)
class ActivityEpisode:
    person_id: str
    index: int
    x: float
    y: float
    start_ms: int
    end_ms: int
    activity_type: str
    mode: str
    weight: float
    is_fixed: bool


@dataclass(frozen=True)
class AnchorWindow:
    person_id: str
    window_id: str
    start: ActivityEpisode
    end: ActivityEpisode
    flexible_indices: tuple[int, ...]
    mode: str
    weight: float


def _optimal_z_height(min_lng: float, max_lng: float, min_lat: float, max_lat: float) -> float:
    spatial_extent = max(max_lng - min_lng, max_lat - min_lat, 1e-9)
    return max(spatial_extent * 111_000 * 0.5, 1000.0)


def _haversine_meters(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _parse_epoch_ms(value: Any) -> int | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        numeric = float(value)
        return int(numeric * 1000) if abs(numeric) < 1e12 else int(numeric)
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return int(parsed.value // 10**6)


def _option_list(options: dict, key: str, fallback: list[str]) -> set[str]:
    raw = options.get(key)
    if raw is None or raw == "":
        return {v.lower() for v in fallback}
    if isinstance(raw, str):
        values = [v.strip() for v in raw.split(",")]
    elif isinstance(raw, (list, tuple, set)):
        values = [str(v).strip() for v in raw]
    else:
        values = [str(raw).strip()]
    return {v.lower() for v in values if v}


def _speed_for_mode(mode: str, fallback_kmh: float) -> tuple[float, float]:
    speed_kmh = float(SPEED_PRESETS.get((mode or "").lower(), fallback_kmh))
    return speed_kmh, speed_kmh * 1000 / 3600


def _haversine_batch(
    lat1: float, lng1: float,
    lat2: np.ndarray, lng2: np.ndarray,
) -> np.ndarray:
    """Vectorized great-circle distance (metres) from one point to an array."""
    R = 6_371_000.0
    dphi = np.radians(lat2 - lat1)
    dlam = np.radians(lng2 - lng1)
    phi2 = np.radians(lat2)
    a = (np.sin(dphi / 2) ** 2
         + math.cos(math.radians(lat1)) * np.cos(phi2) * np.sin(dlam / 2) ** 2)
    return R * 2 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


@lru_cache(maxsize=120)
def _get_projectors(utm_crs: str) -> tuple[Transformer, Transformer]:
    return (
        Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True),
        Transformer.from_crs(utm_crs, "EPSG:4326", always_xy=True),
    )


def _h3_cell_latlng(cell: str) -> tuple[float, float]:
    try:
        return h3.cell_to_latlng(cell)
    except AttributeError:
        return h3.h3_to_geo(cell)


def _h3_cell_boundary(cell: str) -> list[tuple[float, float]]:
    try:
        return list(h3.cell_to_boundary(cell))
    except AttributeError:
        return list(h3.h3_to_geo_boundary(cell))


def _cell_polygon(min_lng: float, min_lat: float, cell_deg: float, col: int, row: int, z: float | None = None) -> Polygon:
    coords_2d = [
        (min_lng + col * cell_deg, min_lat + row * cell_deg),
        (min_lng + (col + 1) * cell_deg, min_lat + row * cell_deg),
        (min_lng + (col + 1) * cell_deg, min_lat + (row + 1) * cell_deg),
        (min_lng + col * cell_deg, min_lat + (row + 1) * cell_deg),
        (min_lng + col * cell_deg, min_lat + row * cell_deg),
    ]
    if z is None:
        return Polygon(coords_2d)
    return Polygon([(x, y, z) for x, y in coords_2d])


def _create_circle(lng: float, lat: float, radius_m: float, steps: int = 32) -> Polygon:
    """Create a circle polygon around a point with given radius in meters."""
    # Convert radius from meters to approximate degrees
    r_deg_lat = radius_m / 111_000
    r_deg_lng = radius_m / (111_000 * math.cos(math.radians(lat)))

    angles = np.linspace(0, 2 * math.pi, steps + 1)
    coords = [(lng + r_deg_lng * math.cos(a), lat + r_deg_lat * math.sin(a)) for a in angles]
    return Polygon(coords)


def _anchor_timestamp_ms(anchor: dict, fallback: int | None = None) -> int:
    parsed = _parse_epoch_ms(anchor.get("timestamp"))
    if parsed is not None:
        return parsed
    return int(fallback or 0)


def _anchor_label(anchor: dict, fallback: str) -> str:
    label = anchor.get("label")
    return str(label) if label else fallback


def _identify_anchors(xs: np.ndarray, ys: np.ndarray, times: np.ndarray, n: int) -> list[int]:
    """Identify meaningful anchor indices from dense trajectory data.

    Returns indices of: first point, last point, and points separated by
    significant time/distance gaps (>=10 min AND >=200 m from previous anchor).
    """
    if n <= 3:
        return list(range(n))

    MIN_TIME_GAP_MS = 600_000  # 10 minutes
    MIN_DISTANCE_M = 200

    anchors = [0]
    for i in range(1, n - 1):
        prev = anchors[-1]
        dt = times[i] - times[prev]
        dist = _haversine_meters(xs[prev], ys[prev], xs[i], ys[i])
        if dt >= MIN_TIME_GAP_MS and dist >= MIN_DISTANCE_M:
            anchors.append(i)

    if anchors[-1] != n - 1:
        anchors.append(n - 1)

    if len(anchors) < 2:
        return [0, n - 1]

    return anchors


def _lift_polygon_z(geom: Polygon | MultiPolygon, z: float) -> Polygon | MultiPolygon:
    """Add Z coordinate to all vertices of a polygon geometry."""
    if geom.geom_type == "Polygon":
        new_exterior = [(x, y, z) for x, y in geom.exterior.coords]
        new_interiors = [[(x, y, z) for x, y in hole.coords] for hole in geom.interiors]
        return Polygon(new_exterior, new_interiors)
    elif geom.geom_type == "MultiPolygon":
        polys = []
        for poly in geom.geoms:
            new_ext = [(x, y, z) for x, y in poly.exterior.coords]
            new_ints = [[(x, y, z) for x, y in h.coords] for h in poly.interiors]
            polys.append(Polygon(new_ext, new_ints))
        return MultiPolygon(polys)
    return geom


def _deduplicate_circles_by_location(circle_features: list[dict]) -> list[dict]:
    """Keep one circle per distinct location; drop circles where the person has not moved.

    A new circle is kept only when the centre has shifted more than
    15 % of its own radius since the last kept circle.  When stationary
    the first (largest) circle in the run is kept, since radius shrinks
    over time and the first gives the widest PPA.
    """
    if not circle_features:
        return []

    MOVE_THRESHOLD = 0.15   # must move > 15 % of own radius to earn a new circle

    kept = [circle_features[0]]
    for curr in circle_features[1:]:
        last = kept[-1]
        dist_m = _haversine_meters(
            last["_center_lng"], last["_center_lat"],
            curr["_center_lng"], curr["_center_lat"],
        )
        if dist_m > MOVE_THRESHOLD * curr["radius_m"]:
            kept.append(curr)

    return kept
