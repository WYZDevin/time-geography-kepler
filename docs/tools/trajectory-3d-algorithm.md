# 3D Trajectory — Algorithm

> How the tool turns a table of timestamped points into a 3D space-time path,
> detects stays, and exports the result.

This page describes the **computation** behind the 3D Trajectory tool. For the
options that control it, see the [3D Trajectory parameters](/tools/trajectory-3d)
page. For the underlying theory, see [Core Concepts](/guide/concepts).

::: info Where this runs
All analysis currently runs on the Flask backend
(`POST /api/v1/tools/time-geography/execute`). The formulas below are taken from
the backend implementation, which is authoritative. A matching browser
implementation exists but is disabled.
:::

## Pipeline at a glance

```
parse timestamps ──▶ group by subject & sort by time
      │
      ▼
map time → vertical height (Z)  ──▶  build 3D points + connect neighbours
      │                                        │
      ▼                                        ▼
(optional) detect stay points        (optional) flat 2D ground path
      │
      ▼
emit GeoJSON layers (path, stays, ground path)
```

## 1. Reading and parsing input

Each row is a point with a longitude, a latitude, and a timestamp. Coordinates
are read directly from the point geometry as WGS84 (EPSG:4326) longitude/latitude
— **no reprojection** is applied; distances that need meters are computed with a
haversine formula (see [Stay-point detection](#_6-stay-point-detection)).

The **datetime column** is parsed into epoch **milliseconds** with these rules:

- **Numeric** values with magnitude `< 1e12` are read as Unix **seconds**;
  otherwise as Unix **milliseconds**.
- **String** values are parsed with a mixed-format parser, so ISO 8601
  (`2022-09-15 00:02:35`) and human formats (`11/4/2022 0:07`) can coexist in one
  column.
- Timezone-aware values are converted to naive UTC before conversion.

The result is a single `int64` array of timestamps in milliseconds that drives
ordering, the Z axis, animation, and the exported time attributes.

## 2. Grouping and ordering

If a **User ID column** is provided, points are grouped by that field (blank
values become `"unknown"`) and sorted **by user, then by time**
(`lexsort((timestamps, user_ids))`). Without it, all points are sorted purely
chronologically. Each distinct subject also receives a stable integer index used
for coloring.

## 3. Mapping time to the vertical axis

The vertical (Z) axis is time. To keep the 3D scene readable, the full time span
is rescaled to a fixed drawing height derived from the horizontal footprint of
the data:

```
spatial_extent = max(lng_span, lat_span, 1e-9)          # in degrees
total_height   = max(spatial_extent · 111 000 · 0.5, 1000)   # in meters
```

`111 000` is meters per degree of latitude, and the `0.5` factor makes the cube
roughly half as tall as it is wide. A 1000 m floor keeps very small extents
visible.

Each point's height is its position within the time range, scaled to that box:

```
time_progress   = (timestamp − t_min) / (t_max − t_min)   # 0 … 1
scaled_height   = time_progress · total_height
```

The point geometry becomes a 3D `Point(longitude, latitude, scaled_height)`.
`time_progress` is also kept as a `0…1` value and used to color the path along
its length.

## 4. Aligning start times across subjects

When **Align User Start Times** is on and there is more than one subject, the Z
axis switches from calendar time to **elapsed time from each subject's own
start**. Each subject's first *day* becomes their zero point:

```
day(t)          = floor(t / 86 400 000) · 86 400 000      # midnight of that day
user_start[u]   = min day over subject u's points
elapsed[i]      = timestamp[i] − user_start[user(i)]
time_progress   = elapsed / max(elapsed)
```

Because each subject is shifted by a whole number of days, time-of-day is
preserved while different calendar dates line up on a shared *Day 1 … Day n*
axis. The exported timestamp is re-anchored to the dataset's first day plus the
elapsed offset, and an `_elapsed_ms` attribute is added.

## 5. Building the path

Points are connected only to their immediate time-neighbours **within the same
subject**. Each point stores the indices of the previous and next point in its
own track, so the renderer never draws a line jumping between two different
subjects.

## 6. Stay-point detection

Stay points are computed only when **Visualize Stay Points** is enabled. Two
methods are available.

### Label-based (when a Stay Location Field is set)

Consecutive points sharing the same label value are grouped into one stay
episode. For each group the tool emits a single marker at the group centroid
`(mean x, mean y, mean height)`, with:

- **duration** = `(last timestamp − first timestamp) / 1000` seconds,
- the number of points in the group,
- the label value.

### Proximity-based (fallback)

When no label field is available, a point is flagged as part of a stay if it has
at least one **temporal neighbour within a distance threshold**. The scan walks
outward in time from each point and stops as soon as the time window is exceeded:

```
for each point i:
    count neighbours j (both earlier and later) where
        |timestamp[i] − timestamp[j]| ≤ time_window   AND
        haversine(point i, point j) < stay_threshold
    mark i as a stay if count ≥ 1
```

Defaults are a **100 m** distance threshold and a **5-minute** time window (the
UI exposes the window as *Stay Point Time Window*). Distance uses the haversine
great-circle formula with Earth radius `6 371 000 m`:

```
a = sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2)
d = 2 · 6 371 000 · atan2(√a, √(1−a))
```

## 7. Optional 2D ground path

When **Show 2D Ground Path** is on, the tool copies the trajectory to the map
plane by setting every height to `0`. This reference layer reuses the same
colors, times, and neighbour links as the 3D path — it adds a flattened route,
it does not change the 3D result.

## 8. Per-subject color

Each subject index is turned into a distinct hue on a golden-angle sequence, so
adjacent subjects are easy to tell apart:

```
hue = (subject_index · 137.508) mod 360
rgb = HSL(hue, saturation = 0.65, lightness = 0.5)
rgba = [r, g, b, 220]
```

## 9. Output

The tool returns one or more GeoJSON layers. Geometry is 3D
`Point(lon, lat, height)` for the path (height `0` for the ground path and stay
markers keep the centroid height). Key properties on each trajectory feature:

| Property | Meaning |
|----------|---------|
| `_timestamp` | Point time in epoch milliseconds (aligned value when start-time alignment is on). |
| `_time_progress` | Position in the time range, `0…1`, used for coloring. |
| `_processed_height` | The point's scaled Z height in meters. |
| `_processed_neighbors` | Indices of the connected previous/next points in the same track. |
| `_sequence` | Position of the point in sorted order. |
| `latitude`, `longitude` | Extracted coordinates. |
| `_dataset_type` | Layer role, e.g. `time-geography-trajectory`, `time-geography-trajectory-2d`, `stay-point`. |
| `_user_id`, `color_rgba` | Present when the data is split by subject. |
| `_elapsed_ms` | Present when start-time alignment is on. |

Stay-point features additionally carry `_stay_id`, `_stay_label`,
`_stay_duration` (seconds), and `_stay_point_count`.

::: tip Exported vs. displayed
The map lifts points into 3D for display, but the [exported GeoJSON](/tools/#exporting-results)
keeps flat 2D geometry and stores time in `timestamp_ms` / `time_iso`
attributes. Renderer-only fields (heights, normalized time, colors) are stripped
on export.
:::

## Reference axes and time labels

The X/Y/Z axes and the vertical time ticks are generated on the frontend from
the result bounds, not by the computation above. In calendar-time mode the
**Z-Axis Time Labels Interval** chooses the tick spacing (Auto, 1h, 4h, 12h,
24h); if a fixed interval would produce more than ~10 labels it is widened
automatically. In aligned (elapsed-time) mode, ticks are labeled `Day N`, `+Xh`,
or `+Xm` relative to each subject's start.
