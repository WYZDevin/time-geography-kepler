import math
import os
import time

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon
from shapely.ops import unary_union  # noqa: F401 — available for callers

from typing import Any

from app.models import AttributeMapping, RoadNetworkSTPOptions
from ...constants import PROCESSED_HEIGHT_FIELD
from ..base import BaseTool

_SPEED_MS: dict[str, float] = {
    "walking":  5_000 / 3600,
    "cycling":  15_000 / 3600,
    "transit":  30_000 / 3600,
    "driving":  60_000 / 3600,
}


def _ppa_ellipse(
    x_a: float, y_a: float,
    x_b: float, y_b: float,
    speed_ms: float,
    budget_s: float,
    n_pts: int = 64,
) -> Polygon | None:
    """Return the PPA ellipse (metric CRS) for a segment with given speed and time budget.

    The ellipse has foci at A and B.  Any point P on the boundary satisfies
    dist(A,P) + dist(P,B) = speed * budget_s.

    Returns None when the segment distance already exceeds speed × budget_s
    (person moved faster than speedMode; caller should fall back to corridor).
    """
    a = speed_ms * budget_s / 2          # semi-major axis
    c = math.sqrt((x_b - x_a) ** 2 + (y_b - y_a) ** 2) / 2  # focal half-distance
    if a < c:
        return None
    b = math.sqrt(max(a ** 2 - c ** 2, 0.0))  # semi-minor axis
    cx, cy = (x_a + x_b) / 2, (y_a + y_b) / 2
    theta = math.atan2(y_b - y_a, x_b - x_a)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    angles = np.linspace(0, 2 * math.pi, n_pts, endpoint=False)
    xs = a * np.cos(angles)
    ys = b * np.sin(angles)
    xs_rot = cos_t * xs - sin_t * ys + cx
    ys_rot = sin_t * xs + cos_t * ys + cy
    return Polygon(zip(xs_rot, ys_rot))


def _auto_utm_crs(lon: float, lat: float) -> str:
    zone = int((lon + 180) / 6) % 60 + 1
    return f"EPSG:{32600 + zone if lat >= 0 else 32700 + zone}"


def _optimal_z_height(min_lng: float, max_lng: float, min_lat: float, max_lat: float) -> float:
    spatial_extent = max(max_lng - min_lng, max_lat - min_lat, 1e-9)
    return max(spatial_extent * 111_000 * 0.5, 1000.0)


def _parse_timestamps(gdf: gpd.GeoDataFrame, time_field: str) -> np.ndarray:
    """Parse the time field into epoch-millisecond int64 array.

    gdf columns:
        <time_field> : str | numeric    numeric treated as Unix-s when abs < 1e12,
                                        else Unix-ms; strings via pandas (ISO-8601, etc.)

    Same logic as time_geography.py.
    """
    col = gdf[time_field]
    if pd.api.types.is_numeric_dtype(col):
        sample = float(col.dropna().iloc[0]) if len(col.dropna()) else 0
        if abs(sample) < 1e12:
            series = pd.to_datetime(col, unit="s")
        else:
            series = pd.to_datetime(col, unit="ms")
    else:
        # format="mixed" infers per element — real-world exports mix string
        # formats within one file, and bare pd.to_datetime infers the format
        # from the first row only, then raises on the rest.
        series = pd.to_datetime(col, format="mixed")
    if hasattr(series.dt, "tz") and series.dt.tz is not None:
        series = series.dt.tz_localize(None)
    return (series.astype("datetime64[ms]").astype(np.int64)).values


def _lift_geom_z(geom: Polygon | MultiPolygon | LineString | MultiLineString, z: float) -> Polygon | MultiPolygon | LineString | MultiLineString:
    """Add a constant Z value to all vertices of any supported geometry type."""
    if geom.geom_type == "Polygon":
        ext = [(x, y, z) for x, y in geom.exterior.coords]
        holes = [[(x, y, z) for x, y in h.coords] for h in geom.interiors]
        return Polygon(ext, holes)
    elif geom.geom_type == "MultiPolygon":
        return MultiPolygon([_lift_geom_z(p, z) for p in geom.geoms])
    elif geom.geom_type == "LineString":
        return LineString([(x, y, z) for x, y in geom.coords])
    elif geom.geom_type == "MultiLineString":
        return MultiLineString([[(x, y, z) for x, y in line.coords] for line in geom.geoms])
    return geom


def _json_safe(val: Any) -> str | int | float | bool | None:
    """Convert a value to a JSON-serialisable scalar (or None)."""
    if val is None:
        return None
    if hasattr(val, "item"):
        val = val.item()
    if isinstance(val, float) and not math.isfinite(val):
        return None
    return val if isinstance(val, (str, int, float, bool)) else str(val)


_OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

# Overpass etiquette: a descriptive User-Agent with contact info gets far fewer
# 403/429 rejections than a generic one.
_OVERPASS_HEADERS = {
    "User-Agent": "time-geography-kepler/1.0 (academic research; contact: hanlin.zhou@uconn.edu)",
    "Accept": "application/json",
}
# Per-mirror retries for transient failures (429 rate-limit, 5xx, timeouts).
_OVERPASS_RETRIES = 2
# Status codes worth retrying the *same* mirror after a backoff.
_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

# Auto-download road-class filter per mode. ``None`` (default) downloads every
# highway. For vehicle modes we fetch only the through-road network (no
# residential/service) so a large-extent trip stays a tractable download — this
# matches the default minor-road removal applied to the rendered result, and is
# what a driving trip of any distance actually uses.
_DOWNLOAD_HIGHWAYS: dict[str, tuple[str, ...]] = {
    "driving": (
        "motorway", "motorway_link", "trunk", "trunk_link", "primary",
        "primary_link", "secondary", "secondary_link", "tertiary",
        "tertiary_link", "unclassified",
    ),
    "transit": (
        "motorway", "trunk", "primary", "secondary", "tertiary",
        "primary_link", "secondary_link", "tertiary_link", "unclassified",
        "residential",
    ),
}


def _fetch_osm_roads(
    bbox_wgs84: tuple[float, float, float, float],
    buffer_deg: float = 0.005,
    mode: str | None = None,
) -> gpd.GeoDataFrame | None:
    """Download road network from OSM Overpass API for the given WGS-84 bbox.

    bbox_wgs84 : (minx, miny, maxx, maxy)
    buffer_deg : padding added to each side before querying (≈ 500 m at mid-latitudes)
    mode       : travel mode; restricts which highway classes are fetched
                 (see ``_DOWNLOAD_HIGHWAYS``). ``None`` fetches all highways.

    Tries multiple Overpass mirrors, each with a short retry/backoff for transient
    errors (429/5xx/timeouts); raises RuntimeError only if every mirror fails.
    Returns a GeoDataFrame of LineString roads in EPSG:4326, or None on failure.
    """
    minx, miny, maxx, maxy = bbox_wgs84
    south = miny - buffer_deg
    west  = minx - buffer_deg
    north = maxy + buffer_deg
    east  = maxx + buffer_deg

    classes = _DOWNLOAD_HIGHWAYS.get(mode or "")
    hw_selector = f'["highway"~"^({"|".join(classes)})$"]' if classes else '["highway"]'
    query = (
        f'[out:json][timeout:90];'
        f'(way{hw_selector}({south},{west},{north},{east}););'
        f'out body;>;out skel qt;'
    )

    last_exc: Exception | None = None
    data = None
    for url in _OVERPASS_URLS:
        for attempt in range(_OVERPASS_RETRIES):
            try:
                resp = requests.post(
                    url,
                    data={"data": query},
                    headers=_OVERPASS_HEADERS,
                    timeout=120,
                )
                resp.raise_for_status()
                data = resp.json()
                break  # success on this mirror
            except requests.exceptions.HTTPError as exc:
                last_exc = exc
                status = exc.response.status_code if exc.response is not None else None
                # Retry the same mirror only for transient server-side codes;
                # for 403/404 etc. move on to the next mirror immediately.
                if status in _RETRYABLE_STATUS and attempt + 1 < _OVERPASS_RETRIES:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                break
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
                last_exc = exc
                if attempt + 1 < _OVERPASS_RETRIES:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                break
            except Exception as exc:
                raise RuntimeError(f"OSM auto-fetch failed: {exc}") from exc
        if data is not None:
            break
    if data is None:
        raise RuntimeError(
            f"All Overpass API mirrors failed. Last error: {last_exc}. "
            "Try again later or load a road network dataset manually."
        )

    # Index nodes by id
    nodes: dict[int, tuple[float, float]] = {
        e["id"]: (e["lon"], e["lat"])
        for e in data.get("elements", [])
        if e["type"] == "node"
    }

    rows: list[dict] = []
    for e in data.get("elements", []):
        if e["type"] != "way":
            continue
        coords = [nodes[nid] for nid in e.get("nodes", []) if nid in nodes]
        if len(coords) < 2:
            continue
        tags = e.get("tags", {})
        rows.append({
            "geometry": LineString(coords),
            "highway": tags.get("highway", ""),
            "maxspeed": tags.get("maxspeed", ""),
            "name": tags.get("name", ""),
            "osm_id": e["id"],
        })

    if not rows:
        return None

    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def _load_road_network(
    opts: RoadNetworkSTPOptions,
    metric_crs: str,
    bbox_wgs84: tuple[float, float, float, float] | None = None,
) -> tuple[gpd.GeoDataFrame | None, bool]:
    """Load road network from user data, file, or auto-fetch from OSM.

    Priority: roadNetworkData (user dataset) > roadNetworkPath (server file) > OSM auto-fetch.

    Returns (GeoDataFrame | None, osm_fetched: bool).
    """
    road_network: gpd.GeoDataFrame | None = None
    osm_fetched = False

    if opts.roadNetworkData and isinstance(opts.roadNetworkData, dict):
        road_network = gpd.GeoDataFrame.from_features(
            opts.roadNetworkData.get("features", []), crs="EPSG:4326"
        )
    elif opts.roadNetworkPath:
        path = str(opts.roadNetworkPath)
        if os.path.exists(path):
            road_network = gpd.read_file(path)
    elif bbox_wgs84 is not None:
        road_network = _fetch_osm_roads(bbox_wgs84)
        osm_fetched = road_network is not None

    if road_network is None or road_network.empty:
        return None, osm_fetched

    if road_network.crs is None:
        road_network = road_network.set_crs("EPSG:4326")
    road_network = road_network.to_crs(metric_crs)
    road_network = road_network[road_network.geometry.notna() & ~road_network.geometry.is_empty]
    road_network = road_network[
        road_network.geometry.geom_type.isin(["LineString", "MultiLineString"])
    ].copy()

    if road_network.empty:
        return None, osm_fetched
    return road_network, osm_fetched


class RoadNetworkSpaceTimePrismTool(BaseTool):
    """Buffer individual GPS points and clip a road network per point, stacked 3D by time.

    For each GPS point the tool:
    1. Computes a buffer radius: speed × Δt to next point when speedMode is set,
       otherwise the static bufferMeters value (default 100 m).
    2. Buffers the point as a circle in metric (UTM) CRS.
    3. Clips the road network against that circle (if a network is provided).
    4. Reprojects buffers and clipped segments to WGS-84, lifts them to
       Z = time_progress × total_height for 3D display.

    Returns two GeoDataFrames:
        [0] 3D buffer circles (one per GPS point)
        [1] 3D clipped road LineStrings (if road network provided)
    """

    @property
    def id(self) -> str:
        return "road-network-stp"

    @property
    def name(self) -> str:
        return "Road Network Space-Time Prism"

    @property
    def description(self) -> str:
        return "Buffer GPS points by speed or distance and clip a road network, stacked 3D by time"

    @property
    def execution_policy(self) -> str:
        return "backend_only"

    def execute(
        self,
        gdf: gpd.GeoDataFrame,
        options: dict[str, Any],
        attributes: dict[str, Any],
    ) -> list[gpd.GeoDataFrame]:
        """Buffer individual GPS points and intersect with road network.

        gdf columns:
            geometry     : Point            required (GPS trajectory)
            <time_field> : str | numeric    required; column named by attributes["time"];
                                            numeric as Unix-s (<1e12) or Unix-ms
        """
        # --- Validate inputs ---
        opts = RoadNetworkSTPOptions.model_validate(options)
        attr = AttributeMapping.model_validate(attributes)
        time_field = attr.time
        if not time_field or time_field not in gdf.columns:
            raise ValueError(f"Time attribute '{time_field}' not found in data")

        if not all(gdf.geometry.geom_type == "Point"):
            raise ValueError("Road Network Space-Time Prism requires Point geometries (GPS trajectory)")
        if len(gdf) < 2:
            raise ValueError("At least two GPS points are required to build a trajectory corridor.")

        # --- Sort by timestamp ---
        timestamps = _parse_timestamps(gdf, time_field)
        order = np.argsort(timestamps)
        gdf = gdf.iloc[order].reset_index(drop=True)
        timestamps = timestamps[order]
        n = len(gdf)

        # --- Auto-detect metric CRS from centroid ---
        centroid_lon = float(gdf.geometry.x.mean())
        centroid_lat = float(gdf.geometry.y.mean())
        metric_crs = opts.metricCrs or _auto_utm_crs(centroid_lon, centroid_lat)

        # --- Speed ---
        speed_mode = opts.speedMode
        if speed_mode == "custom":
            speed_ms = opts.customSpeed / 3.6
        else:
            speed_ms = _SPEED_MS.get(speed_mode, _SPEED_MS["walking"])

        # --- Project GPS points to metric CRS ---
        gdf_metric = gdf.to_crs(metric_crs)
        xs = gdf_metric.geometry.x.values
        ys = gdf_metric.geometry.y.values

        # --- Compute PPA ellipse for each consecutive segment ---
        # Each PPA is the set of locations reachable from A, with enough time left to
        # reach B, given the inter-point time gap and the travel speed.  When the
        # person moved faster than speedMode allows (degenerate case), fall back to
        # a thin corridor buffer so the tool still produces output.
        n_fallback = 0
        ppa_polygons_metric: list[Polygon] = []
        for i in range(n - 1):
            budget_s = (float(timestamps[i + 1]) - float(timestamps[i])) / 1000.0
            ellipse = _ppa_ellipse(xs[i], ys[i], xs[i + 1], ys[i + 1], speed_ms, budget_s)
            if ellipse is None:
                ellipse = LineString(
                    [(xs[i], ys[i]), (xs[i + 1], ys[i + 1])]
                ).buffer(opts.bufferMeters)
                n_fallback += 1
            ppa_polygons_metric.append(ellipse)

        # --- Derive OSM fetch bbox from PPA union (larger than raw trajectory bounds) ---
        ppas_gdf_metric = gpd.GeoDataFrame(
            [{"geometry": p} for p in ppa_polygons_metric], crs=metric_crs
        )
        ppas_wgs84 = ppas_gdf_metric.to_crs("EPSG:4326")
        ppa_bounds = ppas_wgs84.total_bounds  # [minx, miny, maxx, maxy]
        bbox = (float(ppa_bounds[0]), float(ppa_bounds[1]),
                float(ppa_bounds[2]), float(ppa_bounds[3]))

        # --- Load road network (user data, file, or OSM auto-fetch) ---
        road_network, osm_fetched = _load_road_network(opts, metric_crs, bbox_wgs84=bbox)
        if road_network is None:
            raise ValueError(
                "OSM returned no roads for this area. "
                "Try selecting a road network dataset in the tool options."
            )

        # --- Time range and Z-axis ---
        bounds = gdf.total_bounds  # still used for Z-height scaling
        t_min = int(timestamps.min())
        t_max = int(timestamps.max())
        t_range = t_max - t_min if t_max != t_min else 1

        total_height = _optimal_z_height(bounds[0], bounds[2], bounds[1], bounds[3])

        # --- Read input heights for Z alignment ---
        input_heights: np.ndarray | None = None
        if "_height" in gdf.columns:
            h = gdf["_height"].values.astype(float)
            if not np.all(np.isnan(h)):
                input_heights = h

        def _z_at(i: int) -> float:
            if input_heights is not None and not np.isnan(input_heights[i]):
                return float(input_heights[i])
            return (timestamps[i] - t_min) / t_range * total_height

        # --- Build buffer features from PPA polygons ---
        buffer_features: list[dict] = []
        for i in range(n - 1):
            z_start = _z_at(i)
            z_end = _z_at(i + 1)
            extrusion = max(z_end - z_start, 1.0)
            budget_s = (float(timestamps[i + 1]) - float(timestamps[i])) / 1000.0

            time_progress = (timestamps[i] - t_min) / t_range
            color_t = time_progress
            color_rgba = [
                round(11 + (201 - 11) * color_t),
                round(114 + (42 - 114) * color_t),
                round(133 + (42 - 133) * color_t),
                175,
            ]

            ppa_wgs84 = ppas_wgs84.geometry.iloc[i]
            ppa_3d = _lift_geom_z(ppa_wgs84, z_start)

            buffer_features.append({
                "geometry": ppa_3d,
                "segment_index": i,
                "budget_seconds": round(budget_s, 1),
                "_time_order": time_progress,
                "_z_base": z_start,
                PROCESSED_HEIGHT_FIELD: extrusion,
                "_timestamp": float(timestamps[i]),
                "_dataset_type": "road-network-stp-buffer",
                "color_rgba": color_rgba,
            })

        # --- Road-network clipping (single union clip against all PPAs) ---
        clipped_road_features: list[dict] = []
        full_corridor = unary_union(ppa_polygons_metric)
        gps_coords = np.column_stack([xs, ys])  # (n, 2) metric coords

        candidate_idx = road_network.sindex.query(full_corridor, predicate="intersects")
        if len(candidate_idx) > 0:
            candidates = road_network.iloc[candidate_idx].copy()
            candidates.geometry = candidates.geometry.intersection(full_corridor)
            candidates = candidates[candidates.geometry.notna() & ~candidates.geometry.is_empty]
            candidates = candidates.explode(index_parts=False, ignore_index=True)
            candidates = candidates[
                candidates.geometry.geom_type.isin(["LineString", "MultiLineString"])
            ]
            if not candidates.empty:
                # Compute nearest GPS point while still in metric CRS (avoids per-row reproject)
                centroids_xy = np.column_stack([
                    candidates.geometry.centroid.x.values,
                    candidates.geometry.centroid.y.values,
                ])  # (m, 2)
                # Broadcast: (m, 1, 2) - (1, n, 2) → (m, n, 2) → (m, n) distances
                dists_all = np.linalg.norm(
                    centroids_xy[:, np.newaxis, :] - gps_coords[np.newaxis, :, :], axis=2
                )  # (m, n)
                nearest_indices = dists_all.argmin(axis=1)  # (m,)

                clipped_wgs84 = candidates.to_crs("EPSG:4326")
                for j, (_, row) in enumerate(clipped_wgs84.iterrows()):
                    nearest_i = int(nearest_indices[j])
                    z_nearest = _z_at(nearest_i)
                    time_progress = (timestamps[nearest_i] - t_min) / t_range
                    color_t = time_progress
                    color_rgba = [
                        round(11 + (201 - 11) * color_t),
                        round(114 + (42 - 114) * color_t),
                        round(133 + (42 - 133) * color_t),
                        255,
                    ]
                    geom_3d = _lift_geom_z(row.geometry, z_nearest)
                    road_row: dict = {
                        "geometry": geom_3d,
                        "segment_index": nearest_i,
                        "_time_order": time_progress,
                        "_z_base": z_nearest,
                        PROCESSED_HEIGHT_FIELD: z_nearest,
                        "_timestamp": float(timestamps[nearest_i]),
                        "_dataset_type": "road-network-minute-segment",
                        "color_rgba": color_rgba,
                    }
                    for col_name in clipped_wgs84.columns:
                        if col_name != "geometry" and col_name not in road_row:
                            road_row[col_name] = _json_safe(row.get(col_name))
                    clipped_road_features.append(road_row)

        # --- Assemble outputs ---
        warnings: list[str] = []
        if osm_fetched:
            warnings.append("Road network auto-fetched from OpenStreetMap (Overpass API).")
        warnings.append(
            f"PPA computed with speedMode='{speed_mode}' ({speed_ms * 3.6:.1f} km/h). "
            + (f"{n_fallback} segment(s) fell back to {opts.bufferMeters} m corridor "
               "(actual speed exceeded speedMode)."
               if n_fallback else "All segments used PPA ellipses.")
        )

        buf_gdf = (
            gpd.GeoDataFrame(buffer_features, crs="EPSG:4326")
            if buffer_features
            else gpd.GeoDataFrame({"geometry": []}, crs="EPSG:4326")
        )
        road_gdf = (
            gpd.GeoDataFrame(clipped_road_features, crs="EPSG:4326")
            if clipped_road_features
            else gpd.GeoDataFrame({"geometry": []}, crs="EPSG:4326")
        )

        if warnings:
            buf_gdf.attrs["warnings"] = warnings

        return [buf_gdf, road_gdf]
