# Space-Time Cube — Algorithm

> How the tool bins trajectory points into a grid of cubes through time, and
> optionally measures environmental exposure along the path.

This page describes the **computation** behind the Space-Time Cube tool. For the
options that control it, see the [Space-Time Cube parameters](/tools/space-time-cube)
page. For the underlying theory, see [Core Concepts](/guide/concepts).

::: info Where this runs
All analysis currently runs on the Flask backend
(`POST /api/v1/tools/space-time-cube/execute`). The formulas below are taken from
the backend implementation, which is authoritative.
:::

## Pipeline at a glance

```
parse points & time ──▶ build ground grid ──▶ choose time slices
      │
      ▼
bin each point into (time, row, col)
      │
      ├─ count mode:    tally points per cube
      └─ exposure mode: average an environmental value per cube
      │
      ▼
emit cubes + (exposure) coloured trajectory + (optional) 2D ground grid
```

## 1. Reading points and time

Only Point geometries are used. Coordinates are read in WGS84 (EPSG:4326).
Timestamps are parsed to epoch milliseconds using the same rules as the
[3D Trajectory tool](/tools/trajectory-3d-algorithm#_1-reading-and-parsing-input);
rows whose timestamp cannot be parsed are dropped. Times are then measured as
**elapsed seconds** from the earliest timestamp (or per subject when start-time
alignment is on).

## 2. Building the ground grid

The grid spans the data extent, padded by a robust spatial bandwidth so edge
points are not clipped. Cell size is chosen in this priority:

1. an explicit **cell size in meters** (converted with `111 320` m per degree of
   latitude),
2. a legacy cell size in degrees,
3. **auto**: `min(extent_x, extent_y) / 50`, i.e. a 50 × 50 grid.

Cells are kept square **on the ground** by widening the east-west step
(`cell_size_x = cell_size / cos(latitude)`). A safety cap limits the grid to
**2 500 cells** (50 × 50) for auto grids and **62 500 cells** (250 × 250) when a
cell size is set; larger requests are scaled down uniformly.

## 3. Choosing time slices

The trajectory's time range is divided into slices by one of three methods
(shared with [STKDE](/tools/stkde-algorithm) via the same slicing helper):

- **Equal interval** — `n` equal-width slice boundaries via `linspace`.
- **Equal count** — quantile edges so slices hold similar point counts; heavy
  ties collapse edges (fewer slices, with a warning).
- **Fixed duration** — fixed-length slices, optionally anchored to a wall-clock
  time and snapped so the first slice always covers the earliest point; capped at
  **240 slices**.

Each point is assigned to a slice with a `searchsorted` on the slice edges.

::: warning Alignment vs. anchored slices
When **Align Start Times** and **Fixed duration** are both on, the slice anchor
is ignored (a warning is emitted): elapsed-time-per-subject has no wall-clock
reference to anchor to.
:::

## 4. Binning and the cube stack

Every point is placed into a `(time slice, row, column)` cell:

```
col_idx  = clip( (x − x_min) / cell_size_x , 0, n_cols−1 )
row_idx  = clip( (y − y_min) / cell_size_y , 0, n_rows−1 )
time_idx = clip( searchsorted(slice_edges, t_seconds) , 0, n_slices−1 )
```

The cube stack is a 3D array indexed `[time, row, col]`. Slices are stacked
vertically using the same total-height rule as the other 3D tools, split evenly:

```
total_height = max(spatial_extent_deg · 111 000 · 0.5, 1000)   # meters
cell_height  = total_height / number_of_slices
z_base(slice_i) = i · cell_height
```

Each **non-empty** cube becomes a 3D square `Polygon` at its `z_base`.

## 5. Count mode

Without an environment dataset, each cube simply tallies how many trajectory
points fall inside it. The count is stored on the cube and drives its color and
extruded height.

## 6. Exposure mode

With an environment dataset, each point carries an environmental value (e.g.
noise or pollution). Two running arrays accumulate the **sum** and **count** of
valid (non-NaN) values per cube, and the cube's exposure is their ratio:

```
env_value(cube) = env_sum(cube) / env_count(cube)      # None if no valid points
```

The numeric indicator field is taken from the selected column; if left
unspecified the implementation falls back to a default exposure field. A cube
with no valid readings is left uncolored (rendered grey).

### Exposure trajectory

In exposure mode the tool also draws the movement path, split per subject and
time-ordered, as 3D `LineString` segments. Each point's height comes from
interpolating its time onto the slice stack, so the path threads through the
cubes. Each segment is colored by the mean exposure of its two endpoints on a
diverging **blue → red** ramp normalized to the dataset's exposure range.

## 7. The 2D ground projection

When **Show 2D Ground Projection** is on, the cube stack is collapsed over time
(`sum` along the time axis) into a flat grid at Z = 0:

- **count mode** — total points per ground cell across the whole period;
- **exposure mode** — mean exposure per ground cell, computed by summing the
  per-slice sums and counts before dividing.

## 8. Multiple trajectories and time alignment

A **Trajectory ID column** keeps subjects separate — important in exposure mode,
where the path is built per subject. With **Align Start Times**, each
trajectory's earliest timestamp becomes its own origin, so tracks recorded on
different dates overlay on a shared *Day 1 … Day n* axis.

## 9. Output

The tool returns two or three GeoJSON layers: the **cubes** (always), the
**trajectory segments** (in exposure mode), and the **2D ground grid** (optional).

Cube features are 3D square `Polygon`s with these key properties:

| Property | Meaning |
|----------|---------|
| `count` | Number of points in the cube. |
| `env_value` | Mean exposure in the cube (exposure mode; `null` if none). |
| `z` / `z_axis` | Base height of the slice, in meters. |
| `_processed_height` | Height of one slice (used for extrusion). |
| `time_slice_index` | Ordinal of the slice. |
| `time_value` | ISO 8601 slice-centre time. |
| `time_range` | Human-readable span of the slice. |

Trajectory segments are 3D `LineString`s carrying `time_value`, `env_exposure`
(mean of the segment endpoints), and `color_rgba`. Ground-projection cells carry
`count` / `env_value` with `z = z_axis = 0` and `ground_projection = true`. Time
slicing warnings, if any, are attached so the UI can surface them.

::: tip Exported vs. displayed
The map extrudes cubes for display, but [exported GeoJSON](/tools/#exporting-results)
keeps flat 2D geometry and stores time in `timestamp_ms` / `time_iso`. Renderer-only
fields are stripped on export.
:::
