# Space-Time Kernel Density — Algorithm

> How the tool smooths scattered points into a 3D density volume, classifies
> hotspots by confidence, and exports the result.

This page describes the **computation** behind the STKDE tool. For the options
that control it, see the [STKDE parameters](/tools/stkde) page. For the
underlying theory, see [Core Concepts](/guide/concepts).

::: info Where this runs
All analysis currently runs on the Flask backend
(`POST /api/v1/tools/stkde/execute`). The formulas below are taken from the
backend implementation, which is authoritative. A matching browser
implementation (TensorFlow.js) exists but is disabled.
:::

## Pipeline at a glance

```
parse points & time ──▶ estimate bandwidths (space h_s, time h_t)
      │
      ▼
build ground grid ──▶ choose time-slice centres
      │                        │
      ▼                        ▼
evaluate product kernel at every (cell, slice)  ──▶ 3D density volume
      │
      ▼
classify by percentile (90 / 97.5 / 99)  ──▶ emit nested hotspot shells
      │
      ├─ (optional) independent 2D ground KDE
      └─ (optional) overlay the 3D trajectory
```

## 1. Reading points and time

Only Point geometries are used. Longitude/latitude are read in WGS84 (EPSG:4326)
and kept in degrees; the spatial kernel works directly in that space with a
latitude correction applied to the grid (below). Timestamps are parsed to epoch
milliseconds using the same rules as the [3D Trajectory tool](/tools/trajectory-3d-algorithm#_1-reading-and-parsing-input),
then converted to **elapsed seconds** from the earliest timestamp (or, when
start-time alignment is on, from each subject's own start).

## 2. Bandwidth estimation

STKDE needs a spatial bandwidth `h_s` and a temporal bandwidth `h_t` — the radii
over which each point spreads its influence. Both use a robust rule-of-thumb
(a Silverman-style estimate guarded by a robust spread measure):

```
h_s = 0.9 · min(σ_d, d_med / 0.6745) · n^(−1/6)
h_t = 0.9 · min(σ_t, IQR_t / 1.34)  · n^(−1/5)
```

- `σ_d` / `d_med` — standard deviation and median of point distances from the
  spatial centroid; dividing the median by `0.6745` converts it to a robust
  standard-deviation estimate.
- `σ_t` / `IQR_t` — standard deviation and interquartile range of the time
  values; `1.34` converts the IQR to a robust standard deviation.
- `n` — number of points. The exponents `−1/6` (2D space) and `−1/5` (1D time)
  are the standard optimal-bandwidth rates.

Either value can be overridden by the user; a zero bandwidth is floored to a tiny
positive number to avoid division by zero.

## 3. Building the ground grid

The grid spans the data extent, padded outward by one spatial bandwidth on every
side. Cell size is chosen in this priority:

1. an explicit **cell size in meters** (converted to degrees with `111 320` m per
   degree of latitude),
2. a legacy cell size already in degrees,
3. **auto**: `min(extent_x, extent_y) / 50`, i.e. a 50 × 50 grid over the data.

Cells are made square **on the ground**, not in degrees. Because a degree of
longitude shrinks toward the poles, the east-west cell size is widened:

```
cos_lat      = max(cos(mean latitude), 0.01)
cell_size_y  = cell_size          # north-south
cell_size_x  = cell_size / cos_lat # east-west
```

A safety cap keeps the grid tractable: **2 500 cells** (50 × 50) for auto grids,
**62 500 cells** (250 × 250) when the user sets a cell size. If the requested
resolution would exceed the cap, both dimensions are scaled down uniformly.

## 4. Choosing time-slice centres

The Z axis is divided into slices by one of three methods (shared with the
[Space-Time Cube](/tools/space-time-cube-algorithm)):

- **Equal interval** — `n` evenly spaced slice centres across the time range.
- **Equal count** — quantile edges so each slice holds a similar number of
  points; duplicate edges collapse when many points share a timestamp (fewer
  slices result, with a warning).
- **Fixed duration** — slices of a fixed real-world length, optionally anchored
  to a wall-clock time; capped at **240 slices** (the duration is widened if the
  range would need more).

## 5. The density estimate

Each slice's density is evaluated at every grid cell using a **product kernel**:
an Epanechnikov (quartic) kernel in space multiplied by an Epanechnikov kernel in
time. A point contributes to a cell only if it is within `h_s` in space **and**
`h_t` in time.

```
spatial:   k_s(d²) = (3 / (π·h_s²)) · (1 − d²/h_s²)²      for d ≤ h_s, else 0
temporal:  k_t(Δt) = (15 / (16·h_t)) · (1 − (Δt/h_t)²)²    for Δt ≤ h_t, else 0

density(cell, slice) = Σ_points  k_s(dist²)  ·  k_t(|t_point − t_slice|)
```

To keep memory bounded the points are processed in batches, so the working array
is never larger than roughly 16 MB regardless of point count.

## 6. Classifying hotspots

Rather than shipping raw density numbers, the tool turns the volume into **nested
confidence shells**. All non-zero density values across every slice are pooled,
and three percentile thresholds are taken — the **90th, 97.5th, and 99th**. Each
cell is then labeled into one mutually exclusive band:

| Class | Density range | Meaning |
|:-----:|---------------|---------|
| — | ≤ 90th percentile | not emitted |
| 1 | 90th – 97.5th | 90% shell (broadest) |
| 2 | 97.5th – 99th | 97.5% shell |
| 3 | ≥ 99th | 99% shell (densest core) |

Cells below the 90th percentile are dropped, which is why the result looks like
hollow nested surfaces rather than a solid block.

## 7. Stacking slices in 3D

Slices are stacked vertically. The total drawing height follows the same rule as
the other 3D tools, and each slice occupies an equal share of it:

```
total_height = max(spatial_extent_deg · 111 000 · 0.5, 1000)   # meters
cell_height  = total_height / number_of_time_slices
z_base(slice_i) = i · cell_height
```

Every emitted cell is a square polygon at its slice's `z_base`.

## 8. Independent 2D ground projection

When **Show 2D Ground Projection** is on, the tool computes a **separate 2D KDE**
— the same spatial Epanechnikov kernel summed over all points with time dropped:

```
density_2D(cell) = Σ_points k_s(dist²)
```

This is not a vertical sum of the 3D volume; it is its own estimate. It is
emitted as flat (Z = 0) cells carrying a raw `density` value (not a percentile
class).

## 9. Optional trajectory overlay

When **Overlay 3D Trajectory** is on, the [3D Trajectory tool](/tools/trajectory-3d-algorithm)
is run on the same points (with stays and the 2D path disabled) and its
space-time path is added as an extra layer. Both tools use the same total-height
formula, so the path lines up with the density stack.

## 10. Output

The tool returns up to five GeoJSON layers: the three confidence shells (always),
the 2D ground projection (optional), and the trajectory overlay (optional).
Hotspot geometry is a 3D square `Polygon` at the slice height. Key properties:

| Property | Meaning |
|----------|---------|
| `classification` | Confidence band: `1` = 90%, `2` = 97.5%, `3` = 99%. |
| `z` / `z_axis` | Base height of the slice, in meters. |
| `_processed_height` | Height of one slice (used for extrusion). |
| `time_slice_index` | Ordinal of the slice. |
| `time_value` | ISO 8601 slice-centre time. |
| `_timestamp` | Slice-centre time in epoch milliseconds. |
| `time_range` | Human-readable span (equal-count / fixed-duration only). |
| `_elapsed_ms` | Present when start-time alignment is on. |

Ground-projection features instead carry a raw `density` value with
`z = z_axis = 0` and `ground_projection = true`.

::: tip Exported vs. displayed
The map extrudes cells for display, but [exported GeoJSON](/tools/#exporting-results)
keeps flat 2D geometry and stores time in `timestamp_ms` / `time_iso`. Renderer-only
fields are stripped on export.
:::
