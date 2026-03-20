import math
from datetime import datetime, timezone

import geopandas as gpd
import numpy as np
import pandas as pd

from .base import BaseTool
from ..constants import PROCESSED_TIME_FIELD, PROCESSED_HEIGHT_FIELD, PROCESSED_NEIGHBORS_FIELD


def _parse_timestamps(gdf: gpd.GeoDataFrame, time_field: str) -> np.ndarray:
    """Parse a column to epoch-milliseconds array."""
    series = pd.to_datetime(gdf[time_field])
    return (series.astype(np.int64) // 10**6).values


def _haversine(lon1, lat1, lon2, lat2):
    """Return distance in meters between two lon/lat pairs."""
    r = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


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

    def execute(self, gdf, options, attributes):
        time_field = attributes.get("time")
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

        # Compute optimal height from spatial extent
        bounds = gdf.total_bounds  # [minx, miny, maxx, maxy]
        spatial_extent = max(bounds[2] - bounds[0], bounds[3] - bounds[1])
        height_scale = spatial_extent if spatial_extent > 0 else 1.0

        scaled_heights = time_progress * height_scale

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

        # Build result GeoDataFrame
        result = gdf.copy()
        result[PROCESSED_TIME_FIELD] = timestamps.tolist()
        result[PROCESSED_HEIGHT_FIELD] = scaled_heights.tolist()
        result[PROCESSED_NEIGHBORS_FIELD] = neighbors
        result["_time_progress"] = time_progress.tolist()
        result["_sequence"] = list(range(n))
        result["_dataset_type"] = "time-geography"
        result["_layer_config"] = "scatterplot-3d"

        outputs = [result]

        # Stay point detection
        if options.get("visualizeStay", False):
            stay_threshold = options.get("stayDistanceThreshold", 100)  # meters
            time_window = options.get("timeWindow", 300_000)  # ms

            stay_indices = []
            coords = np.column_stack([
                gdf.geometry.x.values,
                gdf.geometry.y.values,
            ])

            for i in range(n):
                neighbor_count = 0
                for j in range(n):
                    if i == j:
                        continue
                    if abs(timestamps[j] - timestamps[i]) > time_window:
                        continue
                    dist = _haversine(coords[i, 0], coords[i, 1], coords[j, 0], coords[j, 1])
                    if dist < stay_threshold:
                        neighbor_count += 1
                if neighbor_count >= 3:
                    stay_indices.append(i)

            if stay_indices:
                stay_gdf = gdf.iloc[stay_indices].copy()
                stay_gdf = stay_gdf.reset_index(drop=True)
                stay_gdf["_dataset_type"] = "stay-point"
                stay_gdf[PROCESSED_TIME_FIELD] = [timestamps[i] for i in stay_indices]
                stay_gdf[PROCESSED_HEIGHT_FIELD] = [scaled_heights[i] for i in stay_indices]
                outputs.append(stay_gdf)

        return outputs
