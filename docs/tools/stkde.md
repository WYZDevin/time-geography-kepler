# Space-Time Kernel Density

> Generate a 3D space-time kernel density estimation with auto-determined
> parameters.

**Tool ID:** `stkde`

STKDE smooths discrete events into a continuous **3D density volume**, revealing
where **and when** activity concentrates. The result is rendered as nested
confidence surfaces.

## Getting the tool

- **Where:** built into the app — pick **Space-Time Kernel Density** (🌊) from
  the tool selector, choose a point dataset, and set the **Datetime Column**.
- **Limits:** recommended up to ~50,000 points; the evaluation grid is capped at
  **50 × 50 cells** to avoid WebGL memory errors.
- **Input:** a `FeatureCollection` of `Point` features with timestamps.

## When to use it

- Find spatio-temporal **hotspots** across many points.
- Summarize a busy trajectory (or many subjects) into a readable density.
- Highlight recurring activity windows.

## Walkthrough

Using the bundled sample `example_day_2022-09-16.geojson` (748 GPS fixes).

### 1. Load data & pick the tool

Upload the file from the **Data** panel (**Upload → GeoJSON File**), as in the
[Running an Analysis](/guide/workflow) guide, then choose **Space-Time Kernel
Density** from **Select Analysis Tool**.

### 2. Configure

Select the data source and confirm the **Datetime Column** (`date_logged` is
auto-detected). The bandwidths are determined automatically, so no tuning is
needed for a first run — leave **Grid Cell Size** at `0` (auto) and the default
**10** equal-interval time slices.

![STKDE configuration](/screenshots/stkde-configure.png)

### 3. Run & read the result

Click **Run Analysis**. The density is rendered as three nested confidence
shells (90 % / 95 % / 99 %) stacked along the time (Z) axis. **Rotate** to see
how the hotspots shift with height (time); toggle each level in the legend.

![STKDE 3D density result](/screenshots/stkde-result.png)

The innermost (99 %) shell marks the densest space-time concentration; the
outer shells show the broader extent of activity. Use the **time player** to
watch the density build up across the period.

::: tip Compare subjects
With a multi-subject dataset (e.g. the bundled `all_trajectories.geojson`), set
a **User ID Column** and turn on **Align User Start Times** so different
recording periods overlay on a shared Day 1…Day n axis before smoothing.
:::

## Algorithm

A **Space-Time Kernel Density Estimate** (Brunsdon, Corcoran & Higgs, 2007) —
a 3D extension of 2D KDE that smooths over the two spatial dimensions and the
time dimension jointly.

1. **Robust, automatic bandwidths** (no manual tuning):
   - Spatial: `h_s = 0.9 × min(SD, robustσ) × n^(−1/6)`, where `robustσ` comes
     from the median absolute distance (`median / 0.6745`).
   - Temporal: `h_t = 0.9 × min(σ_t, robust_t) × n^(−1/5)`, where `robust_t`
     comes from the IQR (`IQR / 1.34`).

   These are Silverman-style rule-of-thumb bandwidths made robust to outliers.
2. **Kernel.** An **Epanechnikov (quartic)** kernel is used for both the spatial
   and temporal weights.
3. **Grid.** Density is evaluated over a regular grid (cell size `min(dx, dy)/50`,
   capped at 50 × 50) across **10 time slices** by default, stacked vertically on
   the Z (time) axis.
4. **Classification.** The density field is cut into three nested, quantile-based
   confidence shells:

| Surface | Rule | Meaning |
|---------|------|---------|
| **90%** | `density > q90` | Broadest extent of activity |
| **95%** | `density > q97.5` | Tighter core |
| **99%** | `density ≥ q99` | Densest concentration |

The surfaces nest inside one another, so the innermost shell marks the most
intense space-time activity. Output is three `FeatureCollection`s (one per level)
of Z-stacked polygons.

## Options

| Option | Key | Default | Description |
|--------|-----|---------|-------------|
| **Datetime Column** | *(attribute mapping)* | — | Field holding each point's timestamp. Required. |
| **Time Slice Method** | `timeSliceMethod` | Equal interval | How the time range is divided: **Equal interval** (every slice covers the same amount of time), **Equal count** (each slice holds ~the same number of points; durations vary, so the Z axis is no longer uniform in time), or **Fixed duration** (slices of an exact length aligned to an anchor time). |
| **Number of Time Slices** | `nTimeSlices` | 10 | How many slices to divide the time range into. Shown for Equal interval / Equal count. |
| **Slice Duration (hours)** | `sliceDurationHours` | 24 | Fixed duration only: length of each slice (24 = daily). The slice count follows from the data's time span (capped at 240). |
| **Align Slices To** | `sliceAnchor` | — | Fixed duration only: a date/time the slice boundaries align to (e.g. midnight → calendar days). Empty = start at the first data point. Ignored when *Align User Start Times* is on. |
| **Show 3D Coordinate Axes** | `showAxes` | on | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels Interval** | `timeBreaks` | Auto | Tick spacing on the time axis (Auto / 1h / 4h / 12h / 24h). |
| **Show 2D Ground Projection** | `groundProjection` | off | Also draw the density flattened onto the map plane (Z = 0) — the combined hotspot footprint across all time slices. |
| **Overlay 3D Trajectory** | `showTrajectory` | off | Also draw the input points as a 3D path on the same time axis, so the track is visible inside the density volume. |
| **User ID Column** | `userIdField` | — | Column identifying each subject. Required to enable alignment. |
| **Align User Start Times** | `alignUserTime` | off | Re-base each subject to elapsed time from their own first observation, so subjects tracked over different date ranges overlap on a shared Day 1…Day n axis. |

::: info Bandwidth tuning
Spatial and temporal bandwidths are **auto-determined** from the data in the
UI. The backend exposes them as overridable parameters (`spatialBandwidth`,
`temporalBandwidth`), but the browser tool computes them for you.
:::

## Reading the result

- Each confidence level is a separate, toggleable layer in the legend.
- **Rotate** to see how density changes with height (time).
- **Animate** to watch the density build up over the period.

## Exported data

Exports follow the [shared conventions](/tools/#exporting-results): flat 2D
WGS84 geometry, analysis attributes only. The grid-cell polygons keep their
footprint; the time stacking is carried by the slice attributes.

### Density surfaces (`stkde-density-1` / `-2` / `-3`)

Three collections — one per confidence level — of square grid-cell polygons,
one feature per cell *per time slice* that clears the level's quantile
threshold.

| Field | Type | Meaning |
|---|---|---|
| `classification` | integer | Quantile class of the cell's density: 1 (≥ 90th percentile), 2 (≥ 97.5th), 3 (≥ 99th). Classes are mutually exclusive. |
| `confidence_level` | integer | The surface's legend level: 90, 95, or 99. |
| `time_slice_index` | integer | 0-based slice index along the time axis. |
| `time_value` | string | Slice center time (ISO 8601). |
| `time_range` | string | The slice's actual time span ("start – end") — present for edge-based slicing methods such as equal-count, where slice durations are uneven. |
| `timestamp_ms`, `time_iso` | — | Slice center time as epoch ms / ISO 8601. |

To rebuild the space-time structure in Python or ArcGIS, group on
`time_slice_index` (or `timestamp_ms`) — all cells of a slice share the value.

### Ground density (`stkde-ground`)

Present when **Show 2D Ground Projection** is on — a plain 2D KDE of all
points with time ignored, same grid and bandwidths.

| Field | Type | Meaning |
|---|---|---|
| `density` | number | Kernel density estimate at the cell (relative intensity — comparable within one run, not across runs). |
| `ground_projection` | boolean | Always `true`; marks the flat surface. |

### Trajectory overlay

When **Overlay 3D Trajectory** is on, the overlay exports with the same
schema as the [3D Trajectory tool](/tools/trajectory-3d#exported-data).

## Tips

- Bandwidths are auto-determined — no manual tuning required to get a first
  result.
- For multi-subject comparisons, set a **User ID Column** and enable
  **Align Start Times** so different recording periods overlay correctly.
