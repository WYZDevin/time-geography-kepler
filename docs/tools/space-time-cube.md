# Space-Time Cube

> Aggregate trajectory points into a 3D grid of cells through time — and overlay
> an environmental field to read exposure along the path.

**Tool ID:** `space-time-cube` · **Runs:** Backend (`backend_only`)

The Space-Time Cube discretizes the study area into a grid and stacks those cells
across time slices. Each **cube** represents one cell during one time slice.

## Two modes

### 1. Count mode (no environment dataset)

Each cube is colored by **how many trajectory points** fell inside that
cell during that slice — a classic space-time density block.

### 2. Exposure mode (with an environment dataset)

Attach a gridded **environmental dataset** (e.g. an hourly noise or pollution
field) and the tool joins it to the trajectory in space and time. Then:

- Each **cube** is colored by the **mean environmental value** experienced there.
- The **trajectory itself** is drawn as a 3D line threading up through the cube
  stack, **colored by exposure** at each step, so you can read what the subject
  was exposed to and when.

Both share a single color scale, so the cubes and the path read together.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| **Datetime Column** | — | Field holding each trajectory point's timestamp (required). |
| **Show 3D Coordinate Axes** | on | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels Interval** | Auto | Tick spacing on the time axis. |
| **Trajectory ID Column** | — | Identifies separate trajectories (see below). |
| **Align Start Times (Normalize Time)** | off | Overlay trajectories tracked over different date ranges on a shared elapsed-time axis. |
| **Environment Dataset** | — | Optional gridded field to join (e.g. noise). Selecting it switches to exposure mode. |
| **Environmental Indicator** | auto | The column in the environment dataset to use as the exposure value (e.g. `noise_db`). If left on *None*, the first numeric column is chosen automatically. |

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
efficiently — only the small, enriched trajectory travels to the backend.
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
