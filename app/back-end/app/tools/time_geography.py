import math

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

from typing import Any

from app.models import AttributeMapping, TimeGeographyOptions
from ..constants import PROCESSED_HEIGHT_FIELD, PROCESSED_NEIGHBORS_FIELD, PROCESSED_TIME_FIELD
from .base import BaseTool


def _parse_timestamps(gdf: gpd.GeoDataFrame, time_field: str) -> np.ndarray:
    """Parse a column to epoch-milliseconds array.

    gdf columns:
        <time_field> : str | numeric    numeric treated as Unix-s when abs < 1e12,
                                        else Unix-ms; strings parsed by pandas (ISO-8601, etc.)

    ``pd.to_datetime`` treats bare numbers as **nanoseconds** by default,
    which silently produces 1970 dates for real-world timestamps.  We detect
    numeric columns and choose the right unit before converting.
    """
    col = gdf[time_field]

    # If the column is numeric, decide between seconds and milliseconds.
    if pd.api.types.is_numeric_dtype(col):
        sample = float(col.dropna().iloc[0]) if len(col.dropna()) else 0
        if abs(sample) < 1e12:
            # Looks like Unix seconds
            series = pd.to_datetime(col, unit="s")
        else:
            # Looks like Unix milliseconds
            series = pd.to_datetime(col, unit="ms")
    else:
        # String / datetime column — let pandas infer
        series = pd.to_datetime(col)

    # Ensure timezone-naive (datetime64[ns]) so .astype(int64) gives nanoseconds
    if hasattr(series.dt, "tz") and series.dt.tz is not None:
        series = series.dt.tz_localize(None)

    return series.astype("datetime64[ms]").astype(np.int64).values


def _haversine(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Return distance in meters between two lon/lat pairs."""
    r = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _optimal_z_height(min_lng: float, max_lng: float, min_lat: float, max_lat: float) -> float:
    """Match frontend ToolUtils.calculateOptimalZAxisHeight: 50% of max horizontal spread in meters."""
    spatial_extent = max(max_lng - min_lng, max_lat - min_lat, 1e-9)
    return max(spatial_extent * 111_000 * 0.5, 1000.0)


class TimeGeographyTool(BaseTool):
    @property
    def id(self) -> str:
        return "time-geography"

    @property
    def name(self) -> str:
        return "Time Geography Analysis"

    @property
    def description(self) -> str:
        return "Compute space-time prisms and potential path areas"

    def execute(
        self,
        gdf: gpd.GeoDataFrame,
        options: dict[str, Any],
        attributes: dict[str, Any],
    ) -> list[gpd.GeoDataFrame]:
        """Compute 3D time-geography trajectories and optional stay points.

        gdf columns:
            geometry     : Point            required
            <time_field> : str | numeric    required; column named by attributes["time"];
                                            numeric as Unix-s (<1e12) or Unix-ms
            <stay_field> : any              optional; column named by opts.stayField when
                                            opts.visualizeStay=True; consecutive equal
                                            values form a single stay group
        """
        opts = TimeGeographyOptions.model_validate(options)
        attr = AttributeMapping.model_validate(attributes)
        time_field = attr.time
        if not time_field or time_field not in gdf.columns:
            raise ValueError(f"Time attribute '{time_field}' not found in data")

        timestamps = _parse_timestamps(gdf, time_field)

        # Sort by time
        order = np.argsort(timestamps)
        gdf = gdf.iloc[order].reset_index(drop=True)
        timestamps = timestamps[order]

        # Normalize time 0-1
        t_min, t_max = timestamps.min(), timestamps.max()
        t_range = t_max - t_min if t_max != t_min else 1
        time_progress = (timestamps - t_min) / t_range

        # Compute optimal height in meters (matching frontend formula)
        bounds = gdf.total_bounds  # [minx, miny, maxx, maxy]
        total_height = _optimal_z_height(bounds[0], bounds[2], bounds[1], bounds[3])
        scaled_heights = time_progress * total_height

        # Neighbor indices
        n = len(gdf)
        neighbors = []
        for i in range(n):
            nb = []
            if i > 0:
                nb.append(i - 1)
            if i < n - 1:
                nb.append(i + 1)
            neighbors.append(nb)

        # Build result GeoDataFrame with 3D geometry
        coords_x = gdf.geometry.x.values
        coords_y = gdf.geometry.y.values
        geom_3d = [Point(x, y, z) for x, y, z in zip(coords_x, coords_y, scaled_heights)]

        result = gdf.copy()
        result = result.set_geometry(geom_3d)
        result[PROCESSED_TIME_FIELD] = time_progress.tolist()
        result[PROCESSED_HEIGHT_FIELD] = scaled_heights.tolist()
        result[PROCESSED_NEIGHBORS_FIELD] = neighbors
        result["_time_progress"] = time_progress.tolist()
        result["_timestamp"] = timestamps.tolist()
        result["_sequence"] = list(range(n))
        result["latitude"] = coords_y.tolist()
        result["longitude"] = coords_x.tolist()
        result["_dataset_type"] = "time-geography-trajectory"
        result["_layer_config"] = "trajectory-3d"

        outputs = [result]

        # Stay point detection
        if opts.visualizeStay:
            stay_field = opts.stayField.strip()

            if stay_field and stay_field in gdf.columns:
                # Attribute-based: consecutive rows with same field value = one stay
                stay_rows = []
                group_start = 0
                values = gdf[stay_field].astype(str).values

                for i in range(1, n + 1):
                    if i == n or values[i] != values[i - 1]:
                        grp = gdf.iloc[group_start:i]
                        grp_x = coords_x[group_start:i]
                        grp_y = coords_y[group_start:i]
                        grp_h = scaled_heights[group_start:i]
                        grp_tp = time_progress[group_start:i]
                        grp_ts = timestamps[group_start:i]

                        cx, cy = float(grp_x.mean()), float(grp_y.mean())
                        ch = float(grp_h.mean())
                        mid_tp = float((grp_tp[0] + grp_tp[-1]) / 2)
                        mid_ts = float((grp_ts[0] + grp_ts[-1]) / 2)
                        duration = float((grp_ts[-1] - grp_ts[0]) / 1000)

                        stay_rows.append({
                            "geometry": Point(cx, cy, ch),
                            PROCESSED_TIME_FIELD: mid_tp,
                            PROCESSED_HEIGHT_FIELD: ch,
                            "_timestamp": mid_ts,
                            "_dataset_type": "stay-point",
                            "_is_stay_point": True,
                            "_stay_id": len(stay_rows),
                            "_stay_label": values[group_start],
                            "_stay_duration": duration,
                            "_stay_point_count": len(grp),
                            "latitude": cy,
                            "longitude": cx,
                        })
                        group_start = i

                if stay_rows:
                    stay_gdf = gpd.GeoDataFrame(stay_rows, crs=gdf.crs)
                    outputs.append(stay_gdf)
            else:
                # Fallback: spatial proximity-based detection
                stay_threshold = opts.stayDistanceThreshold  # meters
                time_window = opts.timeWindow  # ms

                stay_indices = []
                for i in range(n):
                    neighbor_count = 0
                    # Scan backward
                    for j in range(i - 1, -1, -1):
                        if timestamps[i] - timestamps[j] > time_window:
                            break
                        dist = _haversine(coords_x[i], coords_y[i], coords_x[j], coords_y[j])
                        if dist < stay_threshold:
                            neighbor_count += 1
                    # Scan forward
                    for j in range(i + 1, n):
                        if timestamps[j] - timestamps[i] > time_window:
                            break
                        dist = _haversine(coords_x[i], coords_y[i], coords_x[j], coords_y[j])
                        if dist < stay_threshold:
                            neighbor_count += 1
                    if neighbor_count >= 1:
                        stay_indices.append(i)

                if stay_indices:
                    stay_gdf = gdf.iloc[stay_indices].copy()
                    stay_gdf = stay_gdf.reset_index(drop=True)
                    stay_gdf["_dataset_type"] = "stay-point"
                    stay_gdf[PROCESSED_TIME_FIELD] = [time_progress[i] for i in stay_indices]
                    stay_gdf[PROCESSED_HEIGHT_FIELD] = [scaled_heights[i] for i in stay_indices]
                    stay_gdf["_timestamp"] = [timestamps[i] for i in stay_indices]
                    stay_gdf["latitude"] = [coords_y[i] for i in stay_indices]
                    stay_gdf["longitude"] = [coords_x[i] for i in stay_indices]
                    outputs.append(stay_gdf)

        return outputs
