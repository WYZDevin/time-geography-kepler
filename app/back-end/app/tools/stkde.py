"""
Space-Time Kernel Density Estimation (STKDE) tool.

Algorithm aligned with the frontend TensorFlow.js implementation in stkde.tsx:
  1. Robust bandwidth estimation (median absolute deviation)
  2. Multiple time slices (default 10) with 3D vertical stacking
  3. Epanechnikov (quartic) kernels for both spatial and temporal
  4. Quantile-based classification with mutually exclusive ranges
  5. Output: 3 FeatureCollections ordered [90%, 97.5%, 99%] with Z-stacked polygons
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
MAX_GRID_CELLS = 2500  # 50x50 cap, same as frontend


def _robust_spatial_bandwidth(x: np.ndarray, y: np.ndarray) -> float:
    """Frontend-matching robust bandwidth: 0.9 * min(SD, robustSigma) * n^(-1/6)."""
    n = len(x)
    dx = x - x.mean()
    dy = y - y.mean()
    distances = np.sqrt(dx**2 + dy**2)
    sd = math.sqrt(float(np.mean(dx**2 + dy**2)))
    dm = float(np.median(distances))
    robust_sigma = dm / 0.6745 if dm > 0 else sd
    if sd == 0 and dm == 0:
        return 0.0
    return 0.9 * min(sd, robust_sigma) * n ** (-1.0 / 6.0)


def _robust_temporal_bandwidth(t: np.ndarray) -> float:
    """Frontend-matching robust bandwidth: 0.9 * min(sigma, robust) * n^(-1/5)."""
    n = len(t)
    sigma_t = float(np.std(t, ddof=0))
    q25, q75 = np.percentile(t, [25, 75])
    iqr_t = q75 - q25
    robust_t = iqr_t / 1.34 if iqr_t > 0 else sigma_t
    if sigma_t == 0 and iqr_t == 0:
        return 0.0
    return 0.9 * min(sigma_t, robust_t) * n ** (-1.0 / 5.0)


def _calculate_optimal_z_height(
    min_lng: float, max_lng: float, min_lat: float, max_lat: float
) -> float:
    """Match frontend ToolUtils.calculateOptimalZAxisHeight."""
    spatial_extent = max(max_lng - min_lng, max_lat - min_lat, 1e-15)
    return max(spatial_extent * 111_000 * 0.5, 1000.0)


class STKDETool(BaseTool):
    @property
    def id(self) -> str:
        return "stkde"

    @property
    def name(self) -> str:
        return "Space-Time Kernel Density Estimation"

    @property
    def description(self) -> str:
        return "Compute space-time kernel density surfaces using Epanechnikov kernels"

    @property
    def execution_policy(self) -> str:
        return "backend_only"

    def execute(self, gdf, options, attributes):
        time_field = attributes.get("time")
        if not time_field or time_field not in gdf.columns:
            raise ValueError(f"Time attribute '{time_field}' not found in data")

        # Filter to points only
        mask = gdf.geometry.geom_type == "Point"
        pts = gdf[mask].reset_index(drop=True)
        if pts.empty:
            raise ValueError("STKDE requires Point geometries")

        # Extract coordinates and timestamps (seconds offset from min)
        x = pts.geometry.x.values.astype(np.float64)
        y = pts.geometry.y.values.astype(np.float64)
        times = pd.to_datetime(pts[time_field])
        t_epoch_ms = (times.astype(np.int64) // 10**6).values  # milliseconds
        t_min_ms = int(t_epoch_ms.min())
        t_seconds = ((t_epoch_ms - t_min_ms) / 1000.0).astype(np.float64)

        # ----------------------------------------------------------------
        # Bandwidth estimation (frontend-matching robust estimators)
        # ----------------------------------------------------------------
        h_spatial = options.get("spatialBandwidth") or _robust_spatial_bandwidth(x, y)
        h_temporal = options.get("temporalBandwidth") or _robust_temporal_bandwidth(t_seconds)
        if h_spatial <= 0:
            h_spatial = 1e-9
        if h_temporal <= 0:
            h_temporal = 1e-9

        # ----------------------------------------------------------------
        # Spatial grid (bbox + bandwidth padding, cell_size = min(dx,dy)/50)
        # ----------------------------------------------------------------
        minx, miny, maxx, maxy = pts.total_bounds
        x_min = minx - h_spatial
        y_min = miny - h_spatial
        x_max = maxx + h_spatial
        y_max = maxy + h_spatial

        dx_extent = x_max - x_min
        dy_extent = y_max - y_min
        cell_size = min(dx_extent, dy_extent) / 50.0
        if cell_size <= 0:
            cell_size = 1.0

        n_cols = math.ceil(dx_extent / cell_size)
        n_rows = math.ceil(dy_extent / cell_size)

        # Cap grid at MAX_GRID_CELLS
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
        # Time slices (default 10, matching frontend n_time_slices)
        # ----------------------------------------------------------------
        n_time_slices = int(options.get("nTimeSlices", 10))
        if n_time_slices <= 1:
            time_centers = np.array([float(np.mean(t_seconds))])
            n_time_slices = 1
        else:
            t_min_s = float(t_seconds.min())
            t_max_s = float(t_seconds.max())
            time_centers = np.linspace(t_min_s, t_max_s, n_time_slices)

        # ----------------------------------------------------------------
        # Kernel density computation (per time slice)
        # ----------------------------------------------------------------
        const_spatial = 3.0 / (math.pi * h_spatial * h_spatial)
        const_temporal = 15.0 / (16.0 * h_temporal)

        # Meshgrid for cell centers
        Xgrid, Ygrid = np.meshgrid(x_centers, y_centers)  # (n_rows, n_cols)

        density_slices: list[np.ndarray] = []

        for t_center in time_centers:
            # Temporal kernel: quartic Epanechnikov on each data point
            dt = np.abs(t_seconds - t_center)
            t_u = dt / h_temporal
            t_mask = dt <= h_temporal
            k_t = np.where(t_mask, const_temporal * (1.0 - t_u**2) ** 2, 0.0)  # (n,)

            # Spatial kernel: for each cell center vs each data point
            # Xgrid is (n_rows, n_cols), x is (n,)
            diff_x = Xgrid[:, :, None] - x[None, None, :]  # (n_rows, n_cols, n)
            diff_y = Ygrid[:, :, None] - y[None, None, :]  # (n_rows, n_cols, n)
            dist2 = diff_x**2 + diff_y**2
            s_u = dist2 / (h_spatial**2)
            s_mask = dist2 <= h_spatial**2
            k_s = np.where(s_mask, const_spatial * (1.0 - s_u) ** 2, 0.0)  # (n_rows, n_cols, n)

            # Combine: weight spatial kernel by temporal kernel and sum over points
            contribution = k_s * k_t[None, None, :]  # (n_rows, n_cols, n)
            density_slice = contribution.sum(axis=2)  # (n_rows, n_cols)
            density_slices.append(density_slice)

        # ----------------------------------------------------------------
        # Classification: quantile thresholds on non-zero density (all slices pooled)
        # ----------------------------------------------------------------
        all_density = np.concatenate([s.ravel() for s in density_slices])
        nonzero = all_density[all_density > 0]
        if len(nonzero) == 0:
            return [
                gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"),
                gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"),
                gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"),
            ]

        q90 = float(np.percentile(nonzero, 90))
        q975 = float(np.percentile(nonzero, 97.5))
        q99 = float(np.percentile(nonzero, 99))

        # Build integer classification per slice (mutually exclusive ranges like frontend)
        # 0 = below q90, 1 = [q90,q975), 2 = [q975,q99), 3 = >= q99
        classification_slices: list[np.ndarray] = []
        for density_slice in density_slices:
            cls = np.zeros_like(density_slice, dtype=np.int32)
            m1 = (density_slice > q90) & (density_slice < q975)
            m2 = (density_slice >= q975) & (density_slice < q99)
            m3 = density_slice >= q99
            cls[m1] = 1
            cls[m2] = 2
            cls[m3] = 3
            classification_slices.append(cls)

        # ----------------------------------------------------------------
        # Z-axis height computation (matching frontend computeSideLengthAndHeight)
        # ----------------------------------------------------------------
        flat_x = x_centers
        flat_y = y_centers
        total_height = _calculate_optimal_z_height(
            float(flat_x.min()),
            float(flat_x.max()),
            float(flat_y.min()),
            float(flat_y.max()),
        )
        cell_height = total_height / max(n_time_slices, 1)
        side_length = max(
            float(flat_x.max() - flat_x.min()),
            float(flat_y.max() - flat_y.min()),
            1e-15,
        )

        # ----------------------------------------------------------------
        # Build GeoJSON features grouped by classification level
        # Output order: [classification 1 (90%), classification 2 (97.5%), classification 3 (99%)]
        # This matches frontend's createClassificationGeoJSON
        # ----------------------------------------------------------------
        features_by_class: list[list[dict]] = [[], [], []]  # indices 0,1,2 → classes 1,2,3

        time_nums_ms = [t_min_ms + int(tc * 1000) for tc in time_centers]

        for t_idx in range(n_time_slices):
            z_base = t_idx * cell_height
            time_value_ms = time_nums_ms[t_idx] if t_idx < len(time_nums_ms) else time_nums_ms[-1]
            time_value_iso = datetime.fromtimestamp(time_value_ms / 1000.0, tz=UTC).isoformat()

            cls_slice = classification_slices[t_idx]

            for row in range(n_rows):
                for col in range(n_cols):
                    classification = int(cls_slice[row, col])
                    if classification <= 0 or classification > 3:
                        continue

                    cx = float(x_centers[col])
                    cy = float(y_centers[row])
                    half = cell_size / 2

                    # 3D polygon with Z = zBase (matching frontend createClassificationGeoJSON)
                    cell_geom = Polygon(
                        [
                            (cx - half, cy - half, z_base),
                            (cx + half, cy - half, z_base),
                            (cx + half, cy + half, z_base),
                            (cx - half, cy + half, z_base),
                            (cx - half, cy - half, z_base),
                        ]
                    )

                    props = {
                        "classification": classification,
                        "z": z_base,
                        STKDE_Z_AXIS_FIELD: z_base,
                        "time_slice_index": t_idx,
                        "time_value": time_value_iso,
                        PROCESSED_HEIGHT_FIELD: cell_height,
                        "side_length": side_length,
                    }

                    features_by_class[classification - 1].append({"geometry": cell_geom, **props})

        outputs = []
        for class_features in features_by_class:
            if not class_features:
                outputs.append(gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"))
                continue
            geoms = [f.pop("geometry") for f in class_features]
            outputs.append(gpd.GeoDataFrame(class_features, geometry=geoms, crs="EPSG:4326"))

        return outputs
