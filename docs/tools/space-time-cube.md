# Space-Time Cube

> Aggregate trajectory points into 3D cells through time and optionally measure
> environmental exposure along the path.

**Tool ID:** `space-time-cube`

The Space-Time Cube divides the study area into grid cells and stacks those
cells through time. Each **cube** is one location during one time slice.
Without an environment dataset, cubes show point counts; with one, cubes and
the trajectory show exposure values such as noise or pollution. For the
computation — how points are binned into cubes and how exposure is averaged
along the path — see the
[Space-Time Cube algorithm](/tools/space-time-cube-algorithm).

## Parameters

| Option | Default | Description |
|--------|---------|-------------|
| **Datetime Column** | — | Required. Field that stores each point's timestamp. Defines the time axis and which slice each point is assigned to. |
| **Grid Cell Size (meters)** | 0 | Side length of each ground grid cell. `0` auto-detects from the data extent (a 50 × 50 grid); the UI shows the estimated auto size. Explicit small values can be memory-heavy and slow. |
| **Time Slice Method** | Equal interval | How the time range is divided: **Equal interval** (uniform time steps), **Equal count** (similar point count per slice), or **Fixed duration** (real-world periods such as 1 hour or 24 hours). |
| **Number of Time Slices** | 10 | *(Equal interval / Equal count only.)* More slices reveal finer temporal variation but create sparser cubes. |
| **Slice Duration (hours)** | 24 | *(Fixed duration only.)* Length of each slice. Very short durations can produce many empty cells. |
| **Align Slices To** | — | *(Fixed duration only.)* Optional anchor for slice boundaries, e.g. midnight for calendar days. Empty starts at the first trajectory timestamp. |
| **Show 3D Coordinate Axes** | on | Draw labeled X/Y/Z reference axes. Display only. |
| **Z-Axis Time Labels Interval** | Auto | Tick spacing on the vertical time axis. |
| **Show 2D Ground Projection** | off | Add a flat grid on the map plane aggregating the cube stack over time: total point count per cell, or mean exposure in exposure mode. |
| **Trajectory ID Column** | — | Field that identifies separate subjects or trips. Keeps tracks separate — important in exposure mode, where the trajectory line is built per subject. |
| **Align Start Times** | off | Re-base each trajectory to elapsed time from its own first point. Requires a **Trajectory ID Column**. |
| **Environment Dataset** | — | Optional gridded environmental data: a point grid with an `hour` or timestamp field and at least one numeric indicator. Switches the cube from count mode to exposure mode. |
| **Environmental Indicator** | None | The numeric field in the environment dataset used as the exposure value (e.g. `noise_db`, PM2.5). **None** auto-picks the first numeric non-time field. |

## Notes

- Without an environment dataset the cube answers "how many points fall in each
  cell and slice"; with one it answers "what mean exposure was experienced
  there".
- Start with the auto **Grid Cell Size** (`0`). Explicit fine grids give more
  local detail but make the stack sparse, slow, and memory-heavy.
- Match the **Slice Duration** to the question: hourly slices for within-day
  exposure, daily slices for longer routines.
- When multiple indicators exist in the environment dataset, set the
  **Environmental Indicator** explicitly — auto-pick may choose the wrong
  field, and the map will still render with colors representing the wrong
  measurement.
