# 3D Trajectory

> Visualize movement trajectories in 3D space-time (X = longitude, Y = latitude,
> Z = time).

**Tool ID:** `time-geography` · **Runs:** Browser (`frontend_only`)

The 3D Trajectory tool draws each subject's **space-time path** — a line that
climbs as the day advances. Steep, near-vertical segments are stays; long, flat
segments are fast movement.

## Getting the tool

- **Where:** built into the app — pick **3D Trajectory** (🕐) from the tool
  selector, choose a point dataset, and set the **Datetime Column** under
  attribute mapping.
- **Where it runs:** entirely in the browser (`frontend_only`). No backend or
  Flask server is required, and it works fully offline.
- **Limits:** tuned for up to ~100,000 points; trajectories above ~50k points
  render more slowly.
- **Input:** a `FeatureCollection` of `Point` features, each with a timestamp.
  The path is built by sorting points in time (per subject when a User ID column
  is set).

## When to use it

- Get a first look at a trajectory's shape and rhythm.
- Spot stays (home, work) as vertical risers.
- Compare several subjects on one time axis.

## Algorithm

This is the classic **time-geographic space-time path** of Hägerstrand (1970) —
the individual's continuous track through the (x, y, t) space-time aquarium.

- **Time → Z projection.** Points are time-sorted and each timestamp is mapped to
  a height: `z = timeProgress × optimalZHeight`, where `timeProgress` is the
  point's fraction of the elapsed time span and the axis height is scaled to the
  spatial extent (`max(spatialExtent × 111 000 m × 0.5, 1000 m)`) so the cube
  reads well at any zoom. Consecutive points are joined into a 3D `LineString`.
- **Stay detection** (optional). A stay is a run of consecutive points that stay
  within a distance threshold (default 100 m) for at least the **time window**,
  collapsed to one stay marker — or, if a **Stay Location Field** is given,
  points are grouped by consecutive equal values of that field instead.
- **Per-subject coloring.** When a User ID column is set, each subject gets its
  own hue from a golden-angle sequence and is drawn as a separate path.

## Options

| Option | Key | Default | Description |
|--------|-----|---------|-------------|
| **Datetime Column** | *(attribute mapping)* | — | Field holding each point's timestamp. Required; defines the Z axis. |
| **Show 3D Axis** | `showAxes` | on | Draw labeled X/Y/Z reference axes. |
| **Show 2D Ground Path** | `show2D` | off | Also draw the route flattened onto the map plane (Z = 0) — the path seen from above. |
| **Z-Axis Time Labels Interval** | `timeBreaks` | Auto | Tick spacing on the time axis (Auto / 1h / 4h / 12h / 24h). |
| **User ID Column** | `userIdField` | — | Split the trajectory by this column; each subject is drawn as its own colored path. Required to enable alignment. |
| **Align User Start Times** | `alignUserTime` | off | Re-base every subject to elapsed time from their own first point, so subjects tracked over different date ranges overlay on a shared Day 1…Day n axis. |
| **Visualize Stay Points** | `visualizeStay` | off | Detect and mark locations where the subject lingered. |
| **Stay Location Field** | `stayField` | — | Optional label column; when set, stay points are grouped by consecutive equal values of this field instead of by spatial proximity. |
| **Stay Point Time Window (hours)** | `timeWindow` | 24 | Minimum dwell duration used to cluster nearby points into a stay (range 1–168 h). |

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
