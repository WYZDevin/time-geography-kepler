# Space-Time Cube

> Aggregate trajectory points into a 3D grid of cells through time — and overlay
> an environmental field to read exposure along the path.

**Tool ID:** `space-time-cube`

The Space-Time Cube discretizes the study area into a grid and stacks those cells
across time slices. Each **cube** represents one cell during one time slice.

## Getting the tool

- **Where:** built into the app — pick **Space-Time Cube** (🧊) from the tool
  selector and choose a point dataset.
- **Input:** a trajectory `FeatureCollection` of timestamped `Point` features.
  Optionally a second **environment dataset** (a gridded field such as noise or
  PM2.5).
- **Data flow:** the trajectory (and, in exposure mode, the small enriched
  trajectory after the env join) is POSTed to
  `/api/v1/tools/space-time-cube/execute`; the cube geometry comes back as GeoJSON.

## Two modes

### 1. Count mode (no environment dataset)

Each cube is colored by **how many trajectory points** fell inside that cell
during that slice — a classic space-time density block.

### 2. Exposure mode (with an environment dataset)

Attach a gridded **environmental dataset** and the tool joins it to the
trajectory in space and time. Then:

- Each **cube** is colored by the **mean environmental value** experienced there.
- The **trajectory itself** is drawn as a 3D line threading up through the cube
  stack, **colored by exposure** at each step, so you can read what the subject
  was exposed to and when.

Both share a single color scale, so the cubes and the path read together.

## Walkthrough

Using the bundled sample `example_day_2022-09-16.geojson` (748 GPS fixes).

### 1. Load data & pick the tool

Upload the file from the **Data** panel (**Upload → GeoJSON File**), as in the
[Running an Analysis](/guide/workflow) guide, then choose **Space-Time Cube**
from **Select Analysis Tool**.

### 2. Configure (count mode)

Select the data source and confirm the **Datetime Column** (`date_logged`).
Leave **Grid Cell Size** at `0` (auto — the panel shows the size it will use for
this dataset) and the default **10** equal-interval slices. With no environment
dataset attached, the tool runs in **count mode**.

![Space-Time Cube configuration](/screenshots/cube-configure.png)

Further down the panel, the dependent options guard themselves: **Align Start
Times** stays disabled until you pick a **Trajectory ID Column**, and
**Environmental Indicator** stays disabled until an **Environment Dataset** is
chosen — each enables itself once its prerequisite is set.

### 3. Run & read the result

Click **Run Analysis**. Each cube is one grid cell during one time slice,
colored by how many fixes fell inside it; the trajectory threads up through the
stack. **Rotate** to read the time (Z) axis and **hover** a cube for its count.

![Space-Time Cube result (count mode)](/screenshots/cube-result.png)

### Exposure mode (with an environment dataset)

To read environmental exposure along the path, also upload a gridded
**environment dataset** — the bundled `noise_environment_2022-09-16.geojson` is
ready to use (hourly noise in `noise_db`). In the tool options, set
**Environment Dataset** to it and pick `noise_db` as the **Environmental
Indicator**. Now each cube is colored by the **mean value** experienced there
and the trajectory line is colored by exposure at each step, on one shared
scale. See [Preparing an environment dataset](#preparing-an-environment-dataset)
below for the expected format.

## Algorithm

A **space-time cube** in the sense of Hägerstrand's time geography: the study
area is binned into a regular `(x, y, t)` lattice and points are aggregated per
cell.

- **Equal-area ground grid.** Cells are square in *meters* — the longitude step is
  widened by `1/cos(latitude)` so cells don't stretch toward the poles. Cell size
  defaults to `min(dx, dy) / 30` (overridable via `cellSize`).
- **Grid cap.** The grid is uniformly downscaled to at most **2500 cells (50 × 50)**
  to keep rendering tractable.
- **Time slicing.** The time span is split into **10 uniform slices** by default;
  with a Trajectory ID column and *Align Start Times*, each trajectory's time is
  measured from its own first point.
- **Binning.** Each point is assigned to a `(col, row, slice)` bin via
  `searchsorted` on the cell/slice edges; one polygon is emitted per non-empty
  bin, lifted to `Z = slice time`.
- **Exposure join** (exposure mode). For each trajectory point, the frontend finds
  the **nearest environment grid point in the same hour of day** and attaches its
  indicator value; the backend then averages those values per cube and per
  trajectory segment.

## Options

| Option | Key | Default | Description |
|--------|-----|---------|-------------|
| **Datetime Column** | *(attribute mapping)* | — | Field holding each trajectory point's timestamp. Required. |
| **Time Slice Method** | `timeSliceMethod` | Equal interval | How the time range is divided: **Equal interval** (every slice covers the same amount of time), **Equal count** (each slice holds ~the same number of points; durations vary, so the Z axis is no longer uniform in time), or **Fixed duration** (slices of an exact length aligned to an anchor time). |
| **Number of Time Slices** | `timeSlices` | 10 | How many slices to stack the cubes into along the time (Z) axis. Shown for Equal interval / Equal count. |
| **Slice Duration (hours)** | `sliceDurationHours` | 24 | Fixed duration only: length of each slice (24 = daily). The slice count follows from the data's time span (capped at 240). |
| **Align Slices To** | `sliceAnchor` | — | Fixed duration only: a date/time the slice boundaries align to (e.g. midnight → calendar days). Empty = start at the first data point. Ignored when *Align Start Times* is on. |
| **Show 3D Coordinate Axes** | `showAxes` | on | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels Interval** | `timeBreaks` | Auto | Tick spacing on the time axis. |
| **Trajectory ID Column** | `userIdField` | — | Identifies separate trajectories (see *Multiple trajectories*). Required to enable alignment. |
| **Align Start Times** | `alignUserTime` | off | Overlay trajectories tracked over different date ranges on a shared elapsed-time (Day 1…Day n) axis. |
| **Environment Dataset** | `envDataset` | — | Optional gridded field to join (e.g. noise). Selecting it switches to exposure mode. |
| **Environmental Indicator** | `envField` | auto | Column in the environment dataset to use as the exposure value (e.g. `noise_db`). If left on *None*, the first numeric column is used. |

::: info Backend tunables
The backend also accepts `cellSize` (override the automatic cell size, in the
grid's projected units). The UI uses the automatic default.
:::

## Preparing an environment dataset

The environment dataset is a `FeatureCollection` of points on a regular grid,
each tagged with an **hour** (or timestamp) and an indicator value:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [-79.66989, 43.546365] },
  "properties": { "timestamp": "2022-09-16T00:00:00Z", "hour": 0, "noise_db": 47.7 }
}
```

For each trajectory point, the tool finds the nearest environment grid point in
the **same hour of day** and assigns its value as the exposure. The bundled
`noise_environment_2022-09-16.geojson` is a ready example (hourly, ~45k points
per hour).

::: tip Large environment grids
Environment grids can be very large (the noise sample is ~1 million points).
They're held in the browser's large-file cache and the spatial join is performed
in the browser — only the small, enriched trajectory travels to the backend.
:::

## Reading the result

- **Cube color** — mean exposure (or point count) for that cell-slice.
- **Trajectory line** — the path through the stack, colored by exposure; it's
  drawn on top so it stays visible through the cubes.
- **Hover** a cube or the path to read the underlying value.

## Exported data

Exports follow the [shared conventions](/tools/#exporting-results): flat 2D
WGS84 geometry, analysis attributes only. Cube cells export as their ground
footprint; the slice attributes carry the time dimension.

### Cube cells (`space-time-cube`)

Square grid-cell polygons, one feature per cell *per time slice* containing at
least one trajectory point.

| Field | Type | Meaning |
|---|---|---|
| `count` | integer | Number of trajectory points in the cell during the slice. |
| `env_value` | number \| null | Mean environment value of the cell-slice (exposure mode); `null` when no environment points fall in it. |
| `time_slice_index` | integer | 0-based slice index along the time axis. |
| `time_value` | string | Slice center time (ISO 8601). |
| `time_range` | string | The slice's actual time span ("start – end"). |
| `timestamp_ms`, `time_iso` | — | Slice center time as epoch ms / ISO 8601. |

To rebuild the space-time structure, group on `time_slice_index` — all cells
of a slice share the value.

### Exposure path (`stc-trajectory`)

LineString segments between consecutive fixes (built per subject — segments
never bridge two trajectories).

| Field | Type | Meaning |
|---|---|---|
| `time_value` | string | Segment start time (ISO 8601). |
| `env_exposure` | number | Mean environment value over the segment (exposure mode only). |

### Ground projection (`stc-ground`)

Present when the ground projection option is on — the cube stack collapsed
onto the map plane.

| Field | Type | Meaning |
|---|---|---|
| `count` | integer | Points in the cell across the whole period. |
| `env_value` | number \| null | Mean environment value across the whole period. |
| `ground_projection` | boolean | Always `true`; marks the flat surface. |

## Multiple trajectories

Set a **Trajectory ID Column** to keep separate subjects apart — the exposure
path is built per trajectory (lines never bridge two subjects). Combine with
**Align Start Times** to overlay subjects recorded on different days.

::: warning Use a real ID column
If the Trajectory ID column has a **unique value per row** (like a raw timestamp
or row index), every "trajectory" becomes a single point and no path is drawn.
Leave it on *None* for one subject, or point it at an actual ID field such as
`trajectory_id`.
:::
