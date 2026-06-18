"""
Space-Time Cube (STC) tool.

Aggregates trajectory point data into a 3D grid of raster cells (x, y, time).

Without environment data:
  Returns one FeatureCollection of Z-stacked polygons carrying `count` and `time_value`.

With environment data (envField present on input features):
  The frontend pre-joins the env dataset to the trajectory, attaching an `env_exposure`
  property to each point.  This tool then:
    - Output 0: STC cubes — one polygon per non-empty (cell, time-slice), colored by
      mean `env_value` (aggregated env_exposure within that cell/slice).
    - Output 1: Trajectory segments — consecutive LineStrings time-sorted, each carrying
      the mean `env_exposure` of its two endpoints, for a colored-line exposure path.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import LineString, Point, Polygon

from typing import Any

from app.models import AttributeMapping, SpaceTimeCubeOptions
from ..constants import PROCESSED_HEIGHT_FIELD
from .base import BaseTool
from .time_slicing import parse_anchor_seconds, slice_edges

Z_AXIS_FIELD = "z_axis"
# Match STKDE grid sizing: auto grids stay conservative at 50x50; explicit
# user cell sizes are honored up to 250x250.
MAX_GRID_CELLS = 2500
MAX_USER_GRID_CELLS = 62_500
METERS_PER_DEGREE_LAT = 111_320.0


def _optimal_z_height(min_lng: float, max_lng: float, min_lat: float, max_lat: float) -> float:
    """Match frontend ToolUtils.calculateOptimalZAxisHeight."""
    spatial_extent = max(max_lng - min_lng, max_lat - min_lat, 1e-15)
    return max(spatial_extent * 111_000 * 0.5, 1000.0)


def _robust_spatial_bandwidth(x: np.ndarray, y: np.ndarray) -> float:
    """Frontend/STKDE-matching robust spatial bandwidth for grid padding."""
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


def _parse_time_series(col: pd.Series) -> pd.Series:
    """Parse a time column to tz-naive datetimes, tolerant of mixed formats.

    Real-world trajectory exports mix string formats within one file (e.g.
    "11/4/2022 0:07" alongside "2022-09-16 00:09:07"); bare ``pd.to_datetime``
    infers the format from the first row and then raises on the rest. Passing
    ``format="mixed"`` infers per-element. Numeric columns are treated as Unix
    seconds (|v| < 1e12) or milliseconds; unparseable values become ``NaT``.
    """
    if pd.api.types.is_numeric_dtype(col):
        nonnull = col.dropna()
        sample = float(nonnull.iloc[0]) if len(nonnull) else 0.0
        unit = "s" if abs(sample) < 1e12 else "ms"
        times = pd.to_datetime(col, unit=unit, errors="coerce")
    else:
        times = pd.to_datetime(col, format="mixed", errors="coerce")
    if hasattr(times.dt, "tz") and times.dt.tz is not None:
        times = times.dt.tz_localize(None)
    return times


# Diverging blue→red ramp; matches the frontend EXPOSURE_COLOR_RANGE so the
# trajectory line and the cubes read on the same exposure scale.
_EXPOSURE_RAMP = [
    (33, 102, 172), (67, 147, 195), (146, 197, 222), (253, 219, 199),
    (244, 165, 130), (214, 96, 77), (178, 24, 43),
]


def _exposure_color_rgba(value: float | None, lo: float, hi: float, alpha: int = 235) -> list[int]:
    """Map an exposure value in [lo, hi] to an [r, g, b, a] colour on the ramp."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return [150, 150, 150, alpha]
    if hi <= lo:
        r, g, b = _EXPOSURE_RAMP[-1]
        return [r, g, b, alpha]
    t = max(0.0, min(1.0, (value - lo) / (hi - lo)))
    n = len(_EXPOSURE_RAMP) - 1
    pos = t * n
    i0 = int(pos)
    if i0 >= n:
        r, g, b = _EXPOSURE_RAMP[-1]
        return [r, g, b, alpha]
    frac = pos - i0
    c0, c1 = _EXPOSURE_RAMP[i0], _EXPOSURE_RAMP[i0 + 1]
    return [int(round(c0[k] + (c1[k] - c0[k]) * frac)) for k in range(3)] + [alpha]


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
        self,
        gdf: gpd.GeoDataFrame,
        options: dict[str, Any],
        attributes: dict[str, Any],
    ) -> list[gpd.GeoDataFrame]:
        opts = SpaceTimeCubeOptions.model_validate(options)
        attr = AttributeMapping.model_validate(attributes)
        time_field = attr.time
        if not time_field or time_field not in gdf.columns:
            raise ValueError(f"Time attribute '{time_field}' not found in data")

        # ── Filter to points only ─────────────────────────────────────────────
        pts = gdf[gdf.geometry.geom_type == "Point"].reset_index(drop=True)
        if pts.empty:
            raise ValueError("Space-Time Cube requires Point geometries")

        # Parse timestamps (tolerant of mixed string formats) and drop rows we
        # could not parse, so binning never sees a NaT-derived epoch.
        times = _parse_time_series(pts[time_field])
        valid = times.notna().values
        if not valid.any():
            raise ValueError(f"Could not parse any timestamps from '{time_field}'")
        if not valid.all():
            pts = pts[valid].reset_index(drop=True)
            times = times[valid].reset_index(drop=True)

        n = len(pts)
        x = pts.geometry.x.values.astype(np.float64)
        y = pts.geometry.y.values.astype(np.float64)

        t_epoch_ms = times.astype("datetime64[ms]").astype(np.int64).values
        t_min_ms = int(t_epoch_ms.min())

        # Optional per-trajectory time alignment ("normalize time"): measure each
        # point as elapsed time from its own trajectory's first observation, so
        # trajectories tracked over different date ranges overlay on a shared
        # elapsed-time Z-axis. Active only when a user/ID field is set and more
        # than one distinct value is present. ISO labels stay anchored at the
        # global minimum so the Z-axis reads as a synthetic Day 1…Day n timeline.
        user_field = opts.userIdField
        has_user = bool(user_field) and user_field in pts.columns
        users = pts[user_field].astype(str).values if has_user else None

        origin_ms = np.full(n, t_min_ms, dtype=np.int64)
        aligned = False
        if opts.alignUserTime and has_user:
            user_min: dict[str, int] = {}
            for i in range(n):
                u = users[i]
                if u not in user_min or t_epoch_ms[i] < user_min[u]:
                    user_min[u] = int(t_epoch_ms[i])
            if len(user_min) > 1:
                origin_ms = np.array([user_min[u] for u in users], dtype=np.int64)
                aligned = True

        t_seconds = ((t_epoch_ms - origin_ms) / 1000.0).astype(np.float64)

        # ── Spatial grid ──────────────────────────────────────────────────────
        minx, miny, maxx, maxy = pts.total_bounds
        pad = _robust_spatial_bandwidth(x, y)
        if pad <= 0:
            pad = 1e-9
        x_min, y_min = minx - pad, miny - pad
        x_max, y_max = maxx + pad, maxy + pad
        dx, dy = x_max - x_min, y_max - y_min

        # A positive cell size overrides auto-detection: cellSizeMeters (the
        # user-facing unit) takes precedence over the legacy degrees cellSize.
        if opts.cellSizeMeters and opts.cellSizeMeters > 0:
            requested_cell = opts.cellSizeMeters / METERS_PER_DEGREE_LAT
        elif opts.cellSize and opts.cellSize > 0:
            requested_cell = opts.cellSize
        else:
            requested_cell = None
        user_cell = requested_cell is not None

        # Cells must be square on the ground (equal metres N-S and E-W), not
        # equal degrees: one degree of longitude is cos(latitude) times shorter
        # than one degree of latitude, so equal-degree cells render as
        # rectangles away from the equator. Widen the longitude step by
        # 1/cos(lat) to compensate, using the grid's centre latitude.
        cos_lat = max(math.cos(math.radians((y_min + y_max) / 2.0)), 0.01)
        cell_size = requested_cell or min(dx, dy) / 50.0
        if cell_size <= 0:
            cell_size = 1.0
        cell_size_y = cell_size
        cell_size_x = cell_size / cos_lat

        n_cols = math.ceil(dx / cell_size_x)
        n_rows = math.ceil(dy / cell_size_y)

        # Auto-detected grids use the conservative 50x50 default; explicit user
        # cell sizes can use the same larger cap as STKDE.
        max_cells = MAX_USER_GRID_CELLS if user_cell else MAX_GRID_CELLS
        total_cells = n_cols * n_rows
        if total_cells > max_cells:
            scale = math.sqrt(max_cells / total_cells)
            n_cols = max(1, int(n_cols * scale))
            n_rows = max(1, int(n_rows * scale))
            cell_size_x = dx / n_cols
            cell_size_y = dy / n_rows

        x_max = x_min + n_cols * cell_size_x
        y_max = y_min + n_rows * cell_size_y

        x_centers = x_min + (np.arange(n_cols, dtype=np.float64) + 0.5) * cell_size_x
        y_centers = y_min + (np.arange(n_rows, dtype=np.float64) + 0.5) * cell_size_y

        # ── Time slices ────────────────────────────────────────────────────────
        # equal_interval keeps the historical linspace binning; the other
        # methods (equal_count quantiles, fixed_duration anchored bins) come
        # from the shared slice_edges helper. Anything that silently deviates
        # from what the user asked for (unparseable anchor, anchor ignored
        # under time alignment, capped slice counts) is reported via
        # slice_warnings so it surfaces in runMeta.warnings.
        slice_warnings: list[str] = []
        n_slices = max(opts.timeSlices, 1)
        duration_s = (opts.sliceDurationHours * 3600.0) if opts.sliceDurationHours else None
        anchor_s = None
        has_anchor = isinstance(opts.sliceAnchor, str) and bool(opts.sliceAnchor.strip())
        if opts.timeSliceMethod == "fixed_duration" and has_anchor:
            if aligned:
                slice_warnings.append(
                    "Slice anchor ignored: Align Start Times measures elapsed time "
                    "per trajectory, which has no wall-clock reference."
                )
            else:
                anchor_s = parse_anchor_seconds(opts.sliceAnchor, t_min_ms)
                if anchor_s is None and has_anchor:
                    slice_warnings.append(
                        f"Could not parse slice anchor '{opts.sliceAnchor}'; "
                        "slices start at the first data point instead."
                    )
        t_min_s, t_max_s = float(t_seconds.min()), float(t_seconds.max())
        if t_max_s == t_min_s:
            time_edges = np.array([t_min_s, t_max_s + 1.0])
            n_slices = 1
        elif opts.timeSliceMethod == "equal_interval":
            time_edges = np.linspace(t_min_s, t_max_s, n_slices + 1)
        else:
            time_edges = slice_edges(
                t_seconds, opts.timeSliceMethod, n_slices, duration_s, anchor_s,
                slice_warnings,
            )
            n_slices = len(time_edges) - 1

        time_centers_ms = [
            t_min_ms + int(((time_edges[i] + time_edges[i + 1]) / 2.0) * 1000)
            for i in range(n_slices)
        ]

        # Human-readable slice span for tooltips: a cube in the 00:00–06:00 bin
        # should read as that range, not just its 03:00 center (essential for
        # equal_count, whose slices have uneven durations).
        def _fmt_ms(ms: int) -> str:
            return datetime.fromtimestamp(ms / 1000.0, tz=UTC).strftime("%Y-%m-%d %H:%M")

        time_ranges = [
            f"{_fmt_ms(t_min_ms + int(time_edges[i] * 1000))} – "
            f"{_fmt_ms(t_min_ms + int(time_edges[i + 1] * 1000))}"
            for i in range(n_slices)
        ]

        # ── Bin points ────────────────────────────────────────────────────────
        col_idx = np.clip(((x - x_min) / cell_size_x).astype(int), 0, n_cols - 1)
        row_idx = np.clip(((y - y_min) / cell_size_y).astype(int), 0, n_rows - 1)
        time_idx = np.clip(
            np.searchsorted(time_edges[1:], t_seconds, side="right"),
            0, n_slices - 1,
        )

        count_grid = np.zeros((n_slices, n_rows, n_cols), dtype=np.int64)
        for i in range(n):
            count_grid[time_idx[i], row_idx[i], col_idx[i]] += 1

        # ── Environment field aggregation ─────────────────────────────────────
        env_field = opts.envField or "env_exposure"
        has_env = env_field in pts.columns

        env_sum = np.zeros((n_slices, n_rows, n_cols), dtype=np.float64)
        env_cnt = np.zeros((n_slices, n_rows, n_cols), dtype=np.int64)

        if has_env:
            env_vals = pd.to_numeric(pts[env_field], errors="coerce").values
            for i in range(n):
                v = env_vals[i]
                if not np.isnan(v):
                    env_sum[time_idx[i], row_idx[i], col_idx[i]] += v
                    env_cnt[time_idx[i], row_idx[i], col_idx[i]] += 1

        # ── Z-axis height ─────────────────────────────────────────────────────
        total_h = _optimal_z_height(
            float(x_centers.min()), float(x_centers.max()),
            float(y_centers.min()), float(y_centers.max()),
        )
        cell_h = total_h / max(n_slices, 1)

        # ── Build STC cube features (output 0) ───────────────────────────────
        half_x = cell_size_x / 2.0
        half_y = cell_size_y / 2.0
        cube_rows: list[dict] = []

        for t_i in range(n_slices):
            z_base = t_i * cell_h
            time_iso = datetime.fromtimestamp(time_centers_ms[t_i] / 1000.0, tz=UTC).isoformat()

            for row in range(n_rows):
                for col in range(n_cols):
                    cnt = int(count_grid[t_i, row, col])
                    if cnt == 0:
                        continue

                    cx = float(x_centers[col])
                    cy = float(y_centers[row])

                    ec = int(env_cnt[t_i, row, col])
                    env_val = (float(env_sum[t_i, row, col]) / ec) if ec > 0 else None

                    cube_rows.append({
                        "geometry": Polygon([
                            (cx - half_x, cy - half_y, z_base),
                            (cx + half_x, cy - half_y, z_base),
                            (cx + half_x, cy + half_y, z_base),
                            (cx - half_x, cy + half_y, z_base),
                            (cx - half_x, cy - half_y, z_base),
                        ]),
                        "count": cnt,
                        "env_value": env_val,
                        "z": z_base,
                        Z_AXIS_FIELD: z_base,
                        "time_slice_index": t_i,
                        "time_value": time_iso,
                        "time_range": time_ranges[t_i],
                        PROCESSED_HEIGHT_FIELD: cell_h,
                    })

        if not cube_rows:
            return [gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")]

        geoms = [r.pop("geometry") for r in cube_rows]
        cubes_gdf = gpd.GeoDataFrame(cube_rows, geometry=geoms, crs="EPSG:4326")
        if slice_warnings:
            cubes_gdf.attrs["warnings"] = slice_warnings

        # ── Optional 2D ground projection (flat grid aggregated over time) ───
        # Collapse the time axis: per (x,y) cell, sum the point counts and take
        # the mean exposure across every slice, then emit one flat polygon at
        # Z=0. This is the combined footprint of the cube stack, seen from above.
        ground_gdf = None
        if opts.groundProjection:
            count_2d = count_grid.sum(axis=0)
            env_sum_2d = env_sum.sum(axis=0)
            env_cnt_2d = env_cnt.sum(axis=0)
            ground_rows: list[dict] = []
            for row in range(n_rows):
                for col in range(n_cols):
                    cnt = int(count_2d[row, col])
                    if cnt == 0:
                        continue
                    cx = float(x_centers[col])
                    cy = float(y_centers[row])
                    ec = int(env_cnt_2d[row, col])
                    env_val = (float(env_sum_2d[row, col]) / ec) if ec > 0 else None
                    ground_rows.append({
                        "geometry": Polygon([
                            (cx - half_x, cy - half_y, 0.0),
                            (cx + half_x, cy - half_y, 0.0),
                            (cx + half_x, cy + half_y, 0.0),
                            (cx - half_x, cy + half_y, 0.0),
                            (cx - half_x, cy - half_y, 0.0),
                        ]),
                        "count": cnt,
                        "env_value": env_val,
                        "z": 0.0,
                        Z_AXIS_FIELD: 0.0,
                        "ground_projection": True,
                        PROCESSED_HEIGHT_FIELD: 0.0,
                    })
            if ground_rows:
                g_geoms = [r.pop("geometry") for r in ground_rows]
                ground_gdf = gpd.GeoDataFrame(ground_rows, geometry=g_geoms, crs="EPSG:4326")

        extra = [ground_gdf] if ground_gdf is not None else []

        # ── Build trajectory LineString segments (output 1) ──────────────────
        # The 3D trajectory is always emitted so it threads the cube stack.
        # Plot-time mirrors the cube Z-axis: when aligning, it is the synthetic
        # elapsed timeline (global anchor + per-trajectory elapsed); otherwise it
        # equals the raw epoch. Segments are built within each trajectory so a
        # line never bridges two trajectories; with no ID field all points form
        # one group (the prior single-trajectory behavior).
        t_plot_ms = t_min_ms + (t_epoch_ms - origin_ms)

        # Lift each point to the same Z height the cubes use so the line threads
        # through the cube stack instead of lying flat on the ground. Each slice
        # occupies one cell_h slab regardless of its duration, so with
        # equal_count/fixed_duration slices the time→Z mapping is piecewise
        # linear through the slice edges (for equal_interval this reduces to the
        # plain fractional-time mapping).
        z_pt = np.interp(t_seconds, time_edges, np.linspace(0.0, total_h, n_slices + 1))

        # When env data is present, colour each segment by mean exposure over the
        # global exposure range so the line reads on the same scale as the cubes.
        if has_env:
            ev = pd.to_numeric(pts[env_field], errors="coerce").values
            valid_ev = ev[~np.isnan(ev)]
            e_lo = float(valid_ev.min()) if valid_ev.size else 0.0
            e_hi = float(valid_ev.max()) if valid_ev.size else 1.0

        if has_user:
            groups: dict[str, list[int]] = {}
            for i in range(n):
                groups.setdefault(users[i], []).append(i)
            index_groups = list(groups.values())
        else:
            index_groups = [list(range(n))]

        traj_rows: list[dict] = []
        for idxs in index_groups:
            idxs = sorted(idxs, key=lambda k: t_plot_ms[k])
            for a, b in zip(idxs[:-1], idxs[1:]):
                row: dict = {
                    "geometry": LineString([
                        (float(x[a]), float(y[a]), float(z_pt[a])),
                        (float(x[b]), float(y[b]), float(z_pt[b])),
                    ]),
                    "time_value": datetime.fromtimestamp(int(t_plot_ms[a]) / 1000.0, tz=UTC).isoformat(),
                }
                if has_env:
                    e0 = float(ev[a]) if not np.isnan(ev[a]) else None
                    e1 = float(ev[b]) if not np.isnan(ev[b]) else None
                    seg_exposure = round((e0 + e1) / 2.0, 1) if (e0 is not None and e1 is not None) \
                                   else (e0 if e0 is not None else e1)
                    row["env_exposure"] = seg_exposure
                    row["color_rgba"] = _exposure_color_rgba(seg_exposure, e_lo, e_hi)
                traj_rows.append(row)

        if not traj_rows:
            return [cubes_gdf, *extra]

        traj_geoms = [r.pop("geometry") for r in traj_rows]
        traj_gdf = gpd.GeoDataFrame(traj_rows, geometry=traj_geoms, crs="EPSG:4326")

        return [cubes_gdf, traj_gdf, *extra]
