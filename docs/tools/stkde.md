# Space-Time Kernel Density

> Generate a 3D space-time kernel density estimation with auto-determined
> parameters.

**Tool ID:** `stkde` · **Runs:** Browser (`frontend_only`)

STKDE smooths discrete events into a continuous **3D density volume**, revealing
where **and when** activity concentrates. The result is rendered as nested
confidence surfaces.

## Getting the tool

- **Where:** built into the app — pick **Space-Time Kernel Density** (🌊) from
  the tool selector, choose a point dataset, and set the **Datetime Column**.
- **Where it runs:** in the browser (`frontend_only`), using a TensorFlow.js
  kernel evaluation. No backend is required. (A backend STKDE implementation
  exists and mirrors the same math, but the UI runs the frontend version.)
- **Limits:** recommended up to ~50,000 points; the evaluation grid is capped at
  **50 × 50 cells** to avoid WebGL memory errors.
- **Input:** a `FeatureCollection` of `Point` features with timestamps.

## When to use it

- Find spatio-temporal **hotspots** across many points.
- Summarize a busy trajectory (or many subjects) into a readable density.
- Highlight recurring activity windows.

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
| **Show 3D Coordinate Axes** | `showAxes` | on | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels Interval** | `timeBreaks` | Auto | Tick spacing on the time axis (Auto / 1h / 4h / 12h / 24h). |
| **Show 2D Ground Projection** | `groundProjection` | off | Also draw the density flattened onto the map plane (Z = 0) — the combined hotspot footprint across all time slices. |
| **Overlay 3D Trajectory** | `showTrajectory` | off | Also draw the input points as a 3D path on the same time axis, so the track is visible inside the density volume. |
| **User ID Column** | `userIdField` | — | Column identifying each subject. Required to enable alignment. |
| **Align User Start Times** | `alignUserTime` | off | Re-base each subject to elapsed time from their own first observation, so subjects tracked over different date ranges overlap on a shared Day 1…Day n axis. |

::: info Bandwidth & slice tuning
Spatial bandwidth, temporal bandwidth, and the number of time slices are
**auto-determined** from the data in the UI. The backend exposes them as
overridable parameters (`spatialBandwidth`, `temporalBandwidth`, `nTimeSlices`),
but the browser tool computes them for you.
:::

## Reading the result

- Each confidence level is a separate, toggleable layer in the legend.
- **Rotate** to see how density changes with height (time).
- **Animate** to watch the density build up over the period.

## Tips

- Bandwidths are auto-determined — no manual tuning required to get a first
  result.
- For multi-subject comparisons, set a **User ID Column** and enable
  **Align Start Times** so different recording periods overlay correctly.
