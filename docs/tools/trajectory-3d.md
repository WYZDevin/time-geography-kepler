# 3D Trajectory

> Visualize movement trajectories in 3D space-time (X = longitude, Y = latitude,
> Z = time).

**Tool ID:** `time-geography` · **Runs:** Browser (`frontend_only`)

The 3D Trajectory tool draws each subject's **space-time path** — a line that
climbs as the day advances. Steep, near-vertical segments are stays; long, flat
segments are fast movement.

## When to use it

- Get a first look at a trajectory's shape and rhythm.
- Spot stays (home, work) as vertical risers.
- Compare several subjects on one time axis.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| **Datetime Column** | — | Field holding each point's timestamp (required). |
| **Visualize Stay Points** | off | Detect and mark locations where the subject lingered. |
| **Show 3D Axis** | on | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels Interval** | Auto | Tick spacing on the time axis (Auto / 1h / 4h / 12h / 24h). |
| **User ID Column** | — | Column identifying each subject (enables alignment & per-subject coloring). |
| **Align User Start Times** | off | Overlay subjects on a shared elapsed-time axis (see [Concepts](/guide/concepts#normalizing-time-across-subjects)). |
| **Stay Location Field** | — | A label column used when grouping stay points. |
| **Stay Point Time Window (hours)** | 24 | Window used to cluster nearby points into a stay. |

## Reading the result

- **The path** rises with time; color encodes progression through the period.
- **Stay points** (when enabled) appear as markers/columns at activity locations.
- Use the **time player** to animate the path being drawn, and **drag to rotate**
  so the Z (time) axis is visible.

## Tips

- Turn on **Align User Start Times** with a **User ID Column** to compare subjects
  recorded on different days — they'll line up on a common "Day 1…Day n" axis.
- Pair with [pin-point mode](/guide/map-controls#pin-point-mode) to annotate
  specific points along the path.
