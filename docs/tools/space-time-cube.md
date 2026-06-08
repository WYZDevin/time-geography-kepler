# Space-Time Cube

> Aggregate trajectory points into a 3D grid of cells through time — and overlay
> an environmental field to read exposure along the path.

**Tool ID:** `space-time-cube` · **Runs:** Backend (`backend_only`)

The Space-Time Cube discretizes the study area into a grid and stacks those cells
across time slices. Each **cube** represents one cell during one time slice.

## Getting the tool

- **Where:** built into the app — pick **Space-Time Cube** (🧊) from the tool
  selector and choose a point dataset.
- **Where it runs:** on the **Flask backend** (`backend_only`). Start the backend
  (`uv run flask --app app run -p 8000`) or run via Docker before executing. The
  tool is disabled in the UI when the backend is offline.
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
| **Show 3D Coordinate Axes** | `showAxes` | on | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels Interval** | `timeBreaks` | Auto | Tick spacing on the time axis. |
| **Trajectory ID Column** | `userIdField` | — | Identifies separate trajectories (see *Multiple trajectories*). Required to enable alignment. |
| **Align Start Times** | `alignUserTime` | off | Overlay trajectories tracked over different date ranges on a shared elapsed-time (Day 1…Day n) axis. |
| **Environment Dataset** | `envDataset` | — | Optional gridded field to join (e.g. noise). Selecting it switches to exposure mode. |
| **Environmental Indicator** | `envField` | auto | Column in the environment dataset to use as the exposure value (e.g. `noise_db`). If left on *None*, the first numeric column is used. |

::: info Backend tunables
The backend also accepts `cellSize` (override the automatic cell size, in the
grid's projected units) and `timeSlices` (default 10). The UI uses the automatic
defaults.
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
