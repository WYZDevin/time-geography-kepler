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

## Walkthrough

This walkthrough uses the bundled sample `example_day_2022-09-16.geojson` (748
GPS fixes from a single subject over one day). Every step below is a real
screen from the app.

### 1. Load your data

Open the **Data** panel from the bottom bar, then **Upload → GeoJSON File** and
choose the file.

![Upload menu in the Data panel](/screenshots/shared-upload-menu.png)

The dataset appears under **Data Sources** with its feature count.

![Dataset loaded in the Data panel](/screenshots/shared-data-loaded.png)

### 2. Pick the tool

Close the panel and choose **3D Trajectory** from **Select Analysis Tool**.

![Selecting a tool](/screenshots/shared-tool-picker.png)

### 3. Configure

Pick the data source, then confirm the **Datetime Column** — the app
auto-detects `date_logged` here. Leave the display options at their defaults for
a first run.

![3D Trajectory configuration](/screenshots/trajectory-configure.png)

Further down the panel, the dependent options guard themselves: **Align User
Start Times** stays disabled until you set a **User ID Column** (it shows
*"Select a User ID Column first"*), and the **Stay points** fields stay disabled
until **Visualize Stay Points** is on. The options only apply once their
prerequisite is set.

![Dependent options disabled until their prerequisite is set](/screenshots/trajectory-options-deps.png)

### 4. Run & read the result

Click **Run Analysis**. The space-time path renders on the 3D map; **drag to
rotate** so the time (Z) axis is visible, and use the **time player** to animate
the path being drawn.

![3D Trajectory result](/screenshots/trajectory-result.png)

The line climbs with time — steep risers are stays, long flat runs are fast
movement. The legend (bottom-left) toggles the path, axes, and labels.

### Worked example — comparing several subjects

To overlay several subjects on one elapsed-time axis, load the bundled
`all_trajectories.geojson` (7,792 fixes, multiple subjects in a
`trajectory_id` column). Set **User ID Column** to `trajectory_id` — this
enables **Align User Start Times**, so turn it on.

![Multi-user configuration with alignment enabled](/screenshots/trajectory-multiuser-configure.png)

Run it: each subject is drawn as its own colored path, re-based to **Day 1…Day
n** so people tracked over different date ranges line up on a shared Z axis.

![Multiple subjects aligned on a shared time axis](/screenshots/trajectory-multiuser-result.png)

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

## Exported data

Exports follow the [shared conventions](/tools/#exporting-results): flat 2D
WGS84 geometry, analysis attributes only.

### Trajectory points (`time-geography-trajectory`)

Point features, one per GPS fix, in time order.

| Field | Type | Meaning |
|---|---|---|
| *(your input columns)* | — | All columns of the source dataset pass through unchanged. |
| `timestamp_ms` | integer | Fix time, Unix epoch milliseconds. |
| `time_iso` | string | Same instant as ISO 8601 (UTC). |
| `sequence` | integer | 0-based position after time sorting. |
| `latitude`, `longitude` | number | Fix coordinates (also in the geometry). |
| `user_id` | string | Subject ID — present when a **User ID Column** is mapped. |
| `elapsed_ms` | integer | Milliseconds since this subject's first fix — present when **Align Start Times** is on. |

The optional **2D ground path** (`time-geography-trajectory-2d`) exports the
same attributes.

### Stay points (`stay-point`)

Present when **Visualize Stay Points** is on. With a **Stay Location Field**
mapped, each feature is one stay episode (consecutive points sharing the field
value):

| Field | Type | Meaning |
|---|---|---|
| `stay_id` | integer | 0-based stay index in time order. |
| `stay_label` | string | The grouping value of the stay (e.g. the place name). |
| `stay_duration_sec` | number | Stay duration in seconds (last − first fix of the episode). |
| `stay_point_count` | integer | Number of fixes in the episode. |
| `timestamp_ms`, `time_iso` | — | Midpoint time of the stay. |
| `latitude`, `longitude` | number | Mean location of the episode. |

Without a Stay Location Field, the proximity-based fallback exports the
detected stay *fixes* instead — your input columns plus `timestamp_ms` /
`time_iso` / `latitude` / `longitude` per point.

## Tips

- Turn on **Align User Start Times** with a **User ID Column** to compare subjects
  recorded on different days — they'll line up on a common "Day 1…Day n" axis.
- Pair with [pin-point mode](/guide/map-controls#pin-point-mode) to annotate
  specific points along the path.
