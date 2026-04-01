"""
Space-Time Cube (STC) tool.

Aggregates point data into a 3D grid of raster cells (x, y, time).
Each cell is a polygon at a Z altitude with an extrusion height representing
the aggregated value (count by default).

Output: a single FeatureCollection of Z-stacked polygons, where each feature
carries `_processed_height` (extrusion) and `time_value` (ISO timestamp).
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Polygon

from ..constants import PROCESSED_HEIGHT_FIELD
from .base import BaseTool

STKDE_Z_AXIS_FIELD = "z_axis"
MAX_GRID_CELLS = 2500  # 50x50 cap


def _calculate_optimal_z_height(
    min_lng: float, max_lng: float, min_lat: float, max_lat: float
) -> float:
    """Match frontend ToolUtils.calculateOptimalZAxisHeight."""
    spatial_extent = max(max_lng - min_lng, max_lat - min_lat, 1e-15)
    return max(spatial_extent * 111_000 * 0.5, 1000.0)


class SpaceTimeCubeTool(BaseTool):
    @property
    def id(self) -> str:
        return "space-time-cube"

    @property
    def name(self) -> str:
        return "Space-Time Cube"

    @property
    def description(self) -> str:
        return "Visualize spatio-temporal data as 3D cubes representing raster cells through time"

    @property
    def execution_policy(self) -> str:
        return "backend_only"

    def execute(
        self, gdf: gpd.GeoDataFrame, options: dict, attributes: dict
    ) -> list[gpd.GeoDataFrame]:
        time_field = attributes.get("time")
        if not time_field or time_field not in gdf.columns:
            raise ValueError(f"Time attribute '{time_field}' not found in data")

        # Filter to points only
        mask = gdf.geometry.geom_type == "Point"
        pts = gdf[mask].reset_index(drop=True)
        if pts.empty:
            raise ValueError("Space-Time Cube requires Point geometries")

        n = len(pts)

        # Extract coordinates and timestamps
        x = pts.geometry.x.values.astype(np.float64)
        y = pts.geometry.y.values.astype(np.float64)
        times = pd.to_datetime(pts[time_field])
        t_epoch_ms = (times.astype(np.int64) // 10**6).values  # milliseconds
        t_min_ms = int(t_epoch_ms.min())
        t_seconds = ((t_epoch_ms - t_min_ms) / 1000.0).astype(np.float64)

        # ----------------------------------------------------------------
        # Spatial grid
        # ----------------------------------------------------------------
        minx, miny, maxx, maxy = pts.total_bounds
        padding = max(maxx - minx, maxy - miny) * 0.02  # small padding
        x_min = minx - padding
        y_min = miny - padding
        x_max = maxx + padding
        y_max = maxy + padding

        dx_extent = x_max - x_min
        dy_extent = y_max - y_min

        cell_size = options.get("cellSize")
        if not cell_size:
            cell_size = min(dx_extent, dy_extent) / 30.0
        if cell_size <= 0:
            cell_size = 1.0

        n_cols = math.ceil(dx_extent / cell_size)
        n_rows = math.ceil(dy_extent / cell_size)

        # Cap grid
        total_cells = n_cols * n_rows
        if total_cells > MAX_GRID_CELLS:
            scale = math.sqrt(MAX_GRID_CELLS / total_cells)
            n_cols = max(1, int(n_cols * scale))
            n_rows = max(1, int(n_rows * scale))
            cell_size = max(dx_extent / n_cols, dy_extent / n_rows)

        x_max = x_min + n_cols * cell_size
        y_max = y_min + n_rows * cell_size

        x_centers = x_min + (np.arange(n_cols, dtype=np.float64) + 0.5) * cell_size
        y_centers = y_min + (np.arange(n_rows, dtype=np.float64) + 0.5) * cell_size

        # ----------------------------------------------------------------
        # Time slices
        # ----------------------------------------------------------------
        n_time_slices = int(options.get("timeSlices", 10))
        if n_time_slices < 1:
            n_time_slices = 1

        t_min_s = float(t_seconds.min())
        t_max_s = float(t_seconds.max())
        if t_max_s == t_min_s:
            time_edges = np.array([t_min_s, t_max_s + 1.0])
            n_time_slices = 1
        else:
            time_edges = np.linspace(t_min_s, t_max_s, n_time_slices + 1)

        time_centers_s = (time_edges[:-1] + time_edges[1:]) / 2.0
        time_nums_ms = [t_min_ms + int(tc * 1000) for tc in time_centers_s]

        # ----------------------------------------------------------------
        # Bin points into (col, row, time_slice) and count
        # ----------------------------------------------------------------
        col_idx = np.clip(((x - x_min) / cell_size).astype(int), 0, n_cols - 1)
        row_idx = np.clip(((y - y_min) / cell_size).astype(int), 0, n_rows - 1)
        time_idx = np.clip(
            np.searchsorted(time_edges[1:], t_seconds, side="right"),
            0,
            n_time_slices - 1,
        )

        # 3D count grid: (n_time_slices, n_rows, n_cols)
        count_grid = np.zeros((n_time_slices, n_rows, n_cols), dtype=np.int64)
        for i in range(n):
            count_grid[time_idx[i], row_idx[i], col_idx[i]] += 1

        # ----------------------------------------------------------------
        # Z-axis height (matching frontend pattern)
        # ----------------------------------------------------------------
        total_height = _calculate_optimal_z_height(
            float(x_centers.min()),
            float(x_centers.max()),
            float(y_centers.min()),
            float(y_centers.max()),
        )
        cell_height = total_height / max(n_time_slices, 1)

        # ----------------------------------------------------------------
        # Generate mock PM2.5 environment data per cell
        # Pattern: spatial (distance from data centroid) + temporal (rush-hour peaks)
        # ----------------------------------------------------------------
        rng = np.random.default_rng(seed=42)
        x_center_all = float(x_centers.mean())
        y_center_all = float(y_centers.mean())
        spatial_extent = max(dx_extent, dy_extent, 1e-15)

        def _mock_pm25(cx: float, cy: float, time_ms: int) -> float:
            # Spatial: higher near centroid (simulates urban core / road proximity)
            dist = math.sqrt((cx - x_center_all) ** 2 + (cy - y_center_all) ** 2)
            spatial_factor = max(0.0, 1.0 - dist / (spatial_extent * 0.6))

            # Temporal: two rush-hour peaks at 8am and 6pm
            hour_utc = (time_ms / 3_600_000) % 24
            temporal_factor = (
                0.4 * math.exp(-0.5 * ((hour_utc - 8) / 2) ** 2)
                + 0.4 * math.exp(-0.5 * ((hour_utc - 18) / 2) ** 2)
                + 0.2  # baseline
            )

            # Base PM2.5: 10–80 from spatial, scaled by temporal, plus noise
            base = 10.0 + 70.0 * spatial_factor * temporal_factor
            noise = rng.normal(0, 5)
            return round(max(5.0, min(150.0, base + noise)), 1)

        # ----------------------------------------------------------------
        # Build GeoJSON features — one polygon per non-empty cell
        # ----------------------------------------------------------------
        all_features: list[dict] = []
        half = cell_size / 2.0

        for t_idx in range(n_time_slices):
            z_base = t_idx * cell_height
            time_value_ms = time_nums_ms[t_idx]
            time_value_iso = datetime.fromtimestamp(time_value_ms / 1000.0, tz=UTC).isoformat()

            for row in range(n_rows):
                for col in range(n_cols):
                    count = int(count_grid[t_idx, row, col])
                    if count == 0:
                        continue

                    cx = float(x_centers[col])
                    cy = float(y_centers[row])

                    cell_geom = Polygon(
                        [
                            (cx - half, cy - half, z_base),
                            (cx + half, cy - half, z_base),
                            (cx + half, cy + half, z_base),
                            (cx - half, cy + half, z_base),
                            (cx - half, cy - half, z_base),
                        ]
                    )

                    all_features.append(
                        {
                            "geometry": cell_geom,
                            "count": count,
                            "pm25": _mock_pm25(cx, cy, time_value_ms),
                            "z": z_base,
                            STKDE_Z_AXIS_FIELD: z_base,
                            "time_slice_index": t_idx,
                            "time_value": time_value_iso,
                            PROCESSED_HEIGHT_FIELD: cell_height,
                        }
                    )

        if not all_features:
            return [gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")]

        geoms = [f.pop("geometry") for f in all_features]
        result = gpd.GeoDataFrame(all_features, geometry=geoms, crs="EPSG:4326")
        return [result]
