"""
Space-Time Kernel Density Estimation (STKDE) tool.

Algorithm aligned with the frontend TensorFlow.js implementation in stkde.tsx:
  1. Robust bandwidth estimation (median absolute deviation)
  2. Multiple time slices (default 10) with 3D vertical stacking
  3. Epanechnikov (quartic) kernels for both spatial and temporal
  4. Quantile-based classification with mutually exclusive ranges
  5. Output: 3 FeatureCollections ordered [90%, 97.5%, 99%] with Z-stacked polygons,
     plus optional flat 2D spatial-KDE collections (groundProjection) and a
     3D trajectory overlay (showTrajectory)
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

import geopandas as gpd
import numpy as np
from shapely.geometry import Polygon

from typing import Any

from app.models import AttributeMapping, STKDEOptions
from ..constants import PROCESSED_HEIGHT_FIELD
from .base import BaseTool
from .time_geography import _parse_timestamps
from .time_slicing import parse_anchor_seconds, slice_edges

STKDE_Z_AXIS_FIELD = "z_axis"
# Auto-detected grids cap at 50x50 cells; an explicit user cell size is
# honored up to a larger safety cap. The kernel loop batches points so the
# (n_rows, n_cols, batch) arrays never exceed MAX_BROADCAST_ELEMENTS elements,
# keeping memory bounded for fine grids. Same scheme as the frontend stkde.tsx.
MAX_GRID_CELLS = 2500
MAX_USER_GRID_CELLS = 62_500  # 250x250
MAX_BROADCAST_ELEMENTS = 4_194_304
# Metres per degree of latitude — converts the user-facing cell size (metres)
# to the grid's internal lon/lat degrees (matches frontend METERS_PER_DEGREE_LAT)
METERS_PER_DEGREE_LAT = 111_320.0


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

    def execute(
        self,
        gdf: gpd.GeoDataFrame,
        options: dict[str, Any],
        attributes: dict[str, Any],
    ) -> list[gpd.GeoDataFrame]:
        """Compute STKDE density surfaces as 3D Z-stacked polygons.

        gdf columns:
            geometry     : Point            required
            <time_field> : str | numeric    required; column named by attributes["time"];
                                            parsed as Unix-ms integer
        """
        opts = STKDEOptions.model_validate(options)
        attr = AttributeMapping.model_validate(attributes)
        time_field = attr.time
        if not time_field or time_field not in gdf.columns:
            raise ValueError(f"Time attribute '{time_field}' not found in data")

        # Filter to points only
        mask = gdf.geometry.geom_type == "Point"
        pts = gdf[mask].reset_index(drop=True)
        if pts.empty:
            raise ValueError("STKDE requires Point geometries")

        # Extract coordinates and timestamps (seconds offset from min). The
        # shared parser tolerates mixed string formats within one file and
        # numeric Unix-seconds/ms columns.
        x = pts.geometry.x.values.astype(np.float64)
        y = pts.geometry.y.values.astype(np.float64)
        t_epoch_ms = _parse_timestamps(pts, time_field)
        t_min_ms = int(t_epoch_ms.min())

        # Optional per-user time alignment: measure each event as elapsed time
        # from its own user's first observation so users tracked over different
        # date ranges overlap on a shared elapsed timeline. Only active when a
        # user field is provided and more than one distinct user is present.
        # Mirrors the frontend tf_stkde.
        user_field = opts.userIdField.strip()
        align = False
        if opts.alignUserTime and user_field and user_field in pts.columns:
            user_ids = pts[user_field].fillna("unknown").astype(str).values
            user_start: dict[str, int] = {}
            for uid, t_ms in zip(user_ids, t_epoch_ms):
                cur = user_start.get(uid)
                if cur is None or int(t_ms) < cur:
                    user_start[uid] = int(t_ms)
            align = len(user_start) > 1
            if align:
                t_seconds = np.array(
                    [(int(t_ms) - user_start[uid]) / 1000.0 for t_ms, uid in zip(t_epoch_ms, user_ids)],
                    dtype=np.float64,
                )
        if not align:
            t_seconds = ((t_epoch_ms - t_min_ms) / 1000.0).astype(np.float64)

        # ----------------------------------------------------------------
        # Bandwidth estimation (frontend-matching robust estimators)
        # ----------------------------------------------------------------
        h_spatial = opts.spatialBandwidth or _robust_spatial_bandwidth(x, y)
        h_temporal = opts.temporalBandwidth or _robust_temporal_bandwidth(t_seconds)
        if h_spatial <= 0:
            h_spatial = 1e-9
        if h_temporal <= 0:
            h_temporal = 1e-9

        # ----------------------------------------------------------------
        # Spatial grid (bbox + bandwidth padding, cell_size = opts or min(dx,dy)/50)
        # ----------------------------------------------------------------
        minx, miny, maxx, maxy = pts.total_bounds
        x_min = minx - h_spatial
        y_min = miny - h_spatial
        x_max = maxx + h_spatial
        y_max = maxy + h_spatial

        dx_extent = x_max - x_min
        dy_extent = y_max - y_min
        # A positive cell size overrides auto-detection: cellSizeMeters (the
        # user-facing unit) takes precedence over the legacy degrees cellSize.
        if opts.cellSizeMeters and opts.cellSizeMeters > 0:
            requested_cell = opts.cellSizeMeters / METERS_PER_DEGREE_LAT
        elif opts.cellSize and opts.cellSize > 0:
            requested_cell = opts.cellSize
        else:
            requested_cell = None
        user_cell = requested_cell is not None
        cell_size = requested_cell or min(dx_extent, dy_extent) / 50.0
        if cell_size <= 0:
            cell_size = 1.0

        # Cells must be square on the ground (equal metres N-S and E-W), not
        # equal degrees: widen the longitude step by 1/cos(lat) to compensate,
        # matching the frontend tf_stkde grid.
        cos_lat = max(math.cos(math.radians((y_min + y_max) / 2.0)), 0.01)
        cell_size_y = cell_size
        cell_size_x = cell_size / cos_lat

        n_cols = math.ceil(dx_extent / cell_size_x)
        n_rows = math.ceil(dy_extent / cell_size_y)

        # Auto-detected grids stay at the conservative 50x50 default; an
        # explicit user cell size is honored up to a larger safety cap (the
        # kernel loop batches points, so memory stays bounded either way).
        max_cells = MAX_USER_GRID_CELLS if user_cell else MAX_GRID_CELLS
        total_cells = n_cols * n_rows
        if total_cells > max_cells:
            scale = math.sqrt(max_cells / total_cells)
            n_cols = max(1, int(n_cols * scale))
            n_rows = max(1, int(n_rows * scale))
            cell_size_x = dx_extent / n_cols
            cell_size_y = dy_extent / n_rows

        x_max = x_min + n_cols * cell_size_x
        y_max = y_min + n_rows * cell_size_y
        # Returned/base cell size tracks the latitude (N-S) extent.
        cell_size = cell_size_y

        x_centers = x_min + (np.arange(n_cols, dtype=np.float64) + 0.5) * cell_size_x
        y_centers = y_min + (np.arange(n_rows, dtype=np.float64) + 0.5) * cell_size_y

        # ----------------------------------------------------------------
        # Time slices (default 10, matching frontend n_time_slices)
        # The KDE is sampled at each slice's center time. equal_interval keeps
        # the historical linspace centers; equal_count (quantile) and
        # fixed_duration (anchored) derive centers from the shared slice edges.
        # Deviations from what the user asked for (unparseable anchor, anchor
        # ignored under time alignment, capped slice counts) are collected in
        # slice_warnings and surfaced via runMeta.warnings.
        # ----------------------------------------------------------------
        slice_warnings: list[str] = []
        slice_edges_s: np.ndarray | None = None
        n_time_slices = opts.nTimeSlices
        if opts.timeSliceMethod == "equal_interval":
            if n_time_slices <= 1:
                time_centers = np.array([float(np.mean(t_seconds))])
                n_time_slices = 1
            else:
                t_min_s = float(t_seconds.min())
                t_max_s = float(t_seconds.max())
                time_centers = np.linspace(t_min_s, t_max_s, n_time_slices)
        else:
            duration_s = (opts.sliceDurationHours * 3600.0) if opts.sliceDurationHours else None
            anchor_s = None
            has_anchor = isinstance(opts.sliceAnchor, str) and bool(opts.sliceAnchor.strip())
            if opts.timeSliceMethod == "fixed_duration" and has_anchor:
                if align:
                    slice_warnings.append(
                        "Slice anchor ignored: Align User Start Times measures "
                        "elapsed time per user, which has no wall-clock reference."
                    )
                else:
                    anchor_s = parse_anchor_seconds(opts.sliceAnchor, t_min_ms)
                    if anchor_s is None:
                        slice_warnings.append(
                            f"Could not parse slice anchor '{opts.sliceAnchor}'; "
                            "slices start at the first data point instead."
                        )
            slice_edges_s = slice_edges(
                t_seconds, opts.timeSliceMethod, n_time_slices, duration_s, anchor_s,
                slice_warnings,
            )
            time_centers = (slice_edges_s[:-1] + slice_edges_s[1:]) / 2.0
            n_time_slices = len(time_centers)

        # ----------------------------------------------------------------
        # Kernel density computation (per time slice)
        # ----------------------------------------------------------------
        const_spatial = 3.0 / (math.pi * h_spatial * h_spatial)
        const_temporal = 15.0 / (16.0 * h_temporal)

        # Meshgrid for cell centers
        Xgrid, Ygrid = np.meshgrid(x_centers, y_centers)  # (n_rows, n_cols)

        # Points are processed in fixed-size batches: the broadcasted arrays
        # below have shape (n_rows, n_cols, batch), so batching keeps peak
        # memory bounded instead of scaling with n_points * n_cells.
        n_points = len(x)
        point_batch = max(1, MAX_BROADCAST_ELEMENTS // (n_rows * n_cols))

        density_slices: list[np.ndarray] = []

        for t_center in time_centers:
            # Temporal kernel: quartic Epanechnikov on each data point
            dt = np.abs(t_seconds - t_center)
            t_u = dt / h_temporal
            t_mask = dt <= h_temporal
            k_t = np.where(t_mask, const_temporal * (1.0 - t_u**2) ** 2, 0.0)  # (n,)

            density_slice = np.zeros((n_rows, n_cols), dtype=np.float64)
            for start in range(0, n_points, point_batch):
                end = min(start + point_batch, n_points)

                # Spatial kernel: for each cell center vs each batch point
                diff_x = Xgrid[:, :, None] - x[None, None, start:end]  # (n_rows, n_cols, batch)
                diff_y = Ygrid[:, :, None] - y[None, None, start:end]
                dist2 = diff_x**2 + diff_y**2
                s_u = dist2 / (h_spatial**2)
                s_mask = dist2 <= h_spatial**2
                k_s = np.where(s_mask, const_spatial * (1.0 - s_u) ** 2, 0.0)

                # Combine: weight spatial kernel by temporal weight, sum over points
                density_slice += (k_s * k_t[None, None, start:end]).sum(axis=2)

            density_slices.append(density_slice)

        # ----------------------------------------------------------------
        # Classification: quantile thresholds on non-zero density (all slices pooled)
        # ----------------------------------------------------------------
        all_density = np.concatenate([s.ravel() for s in density_slices])
        nonzero = all_density[all_density > 0]
        if len(nonzero) == 0:
            empty = [gpd.GeoDataFrame(geometry=[], crs="EPSG:4326") for _ in range(3)]
            if slice_warnings:
                empty[0].attrs["warnings"] = slice_warnings
            return empty

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

        # When aligning, slice centers are elapsed seconds, so the resulting
        # timestamps are elapsed ms (matching frontend tf_stkde time_values).
        # Always anchor the displayed slice time at the global minimum. Under
        # per-user alignment ``time_centers`` are elapsed seconds from each
        # user's own start; anchoring at t_min_ms turns them into a synthetic
        # "Day 1…Day n" timeline (mirrors space_time_cube). Without this the
        # bare elapsed value is later formatted as an absolute epoch -> 1970.
        time_nums_ms = [t_min_ms + int(tc * 1000) for tc in time_centers]

        # Edge-based methods carry the slice's actual time span for tooltips —
        # a slab sampled at 03:00 but covering 00:00–06:00 should read as the
        # range (essential for equal_count, whose slice durations are uneven).
        slice_ranges: list[str] | None = None
        if slice_edges_s is not None:
            base_ms = t_min_ms

            def _fmt_edge(sec: float) -> str:
                ms = base_ms + int(sec * 1000)
                return datetime.fromtimestamp(ms / 1000.0, tz=UTC).strftime("%Y-%m-%d %H:%M")

            slice_ranges = [
                f"{_fmt_edge(slice_edges_s[i])} – {_fmt_edge(slice_edges_s[i + 1])}"
                for i in range(n_time_slices)
            ]

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
                    half_x = cell_size_x / 2
                    half_y = cell_size_y / 2

                    # 3D polygon with Z = zBase (matching frontend createClassificationGeoJSON)
                    cell_geom = Polygon(
                        [
                            (cx - half_x, cy - half_y, z_base),
                            (cx + half_x, cy - half_y, z_base),
                            (cx + half_x, cy + half_y, z_base),
                            (cx - half_x, cy + half_y, z_base),
                            (cx - half_x, cy - half_y, z_base),
                        ]
                    )

                    props = {
                        "classification": classification,
                        "z": z_base,
                        STKDE_Z_AXIS_FIELD: z_base,
                        "time_slice_index": t_idx,
                        "time_value": time_value_iso,
                        "_timestamp": time_value_ms,
                        PROCESSED_HEIGHT_FIELD: cell_height,
                        "side_length": side_length,
                        **({"time_range": slice_ranges[t_idx]} if slice_ranges else {}),
                        **({"_elapsed_ms": time_value_ms - t_min_ms} if align else {}),
                    }

                    features_by_class[classification - 1].append({"geometry": cell_geom, **props})

        outputs = []
        for class_features in features_by_class:
            if not class_features:
                outputs.append(gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"))
                continue
            geoms = [f.pop("geometry") for f in class_features]
            outputs.append(gpd.GeoDataFrame(class_features, geometry=geoms, crs="EPSG:4326"))
        if slice_warnings:
            outputs[0].attrs["warnings"] = slice_warnings

        # Optional 2D ground projection: a plain spatial (2D) kernel density of
        # all points with time ignored — same grid, bandwidth and Epanechnikov
        # kernel as the 3D computation. Every nonzero cell is emitted with its
        # density value as a single collection so the frontend can render a
        # continuous color gradient (ArcGIS-style KDE surface) at Z=0.
        if opts.groundProjection:
            density_2d = np.zeros((n_rows, n_cols), dtype=np.float64)
            for start in range(0, n_points, point_batch):
                end = min(start + point_batch, n_points)
                diff_x = Xgrid[:, :, None] - x[None, None, start:end]
                diff_y = Ygrid[:, :, None] - y[None, None, start:end]
                dist2 = diff_x**2 + diff_y**2
                s_u = dist2 / (h_spatial**2)
                s_mask = dist2 <= h_spatial**2
                density_2d += np.where(s_mask, const_spatial * (1.0 - s_u) ** 2, 0.0).sum(axis=2)

            rows_idx, cols_idx = np.nonzero(density_2d > 0)
            half_x = cell_size_x / 2
            half_y = cell_size_y / 2
            ground_rows = []
            for row, col in zip(rows_idx.tolist(), cols_idx.tolist()):
                cx = float(x_centers[col])
                cy = float(y_centers[row])
                ground_rows.append(
                    {
                        "geometry": Polygon(
                            [
                                (cx - half_x, cy - half_y, 0.0),
                                (cx + half_x, cy - half_y, 0.0),
                                (cx + half_x, cy + half_y, 0.0),
                                (cx - half_x, cy + half_y, 0.0),
                                (cx - half_x, cy - half_y, 0.0),
                            ]
                        ),
                        "ground_projection": True,
                        "density": float(density_2d[row, col]),
                        "z": 0.0,
                        STKDE_Z_AXIS_FIELD: 0.0,
                        PROCESSED_HEIGHT_FIELD: 0.0,
                    }
                )

            if ground_rows:
                geoms = [r.pop("geometry") for r in ground_rows]
                outputs.append(gpd.GeoDataFrame(ground_rows, geometry=geoms, crs="EPSG:4326"))
            else:
                outputs.append(gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"))

        # Optional 3D trajectory overlay: reuse the time-geography tool so the
        # path styling, per-user coloring and time→Z mapping match a standalone
        # trajectory run (frontend stkde-tool showTrajectory).
        if opts.showTrajectory:
            from .time_geography import TimeGeographyTool

            traj_outputs = TimeGeographyTool().execute(
                pts,
                {
                    "userIdField": user_field,
                    "alignUserTime": opts.alignUserTime,
                    "show2D": False,
                    "visualizeStay": False,
                },
                {"time": time_field},
            )
            if traj_outputs:
                outputs.append(traj_outputs[0])

        return outputs
