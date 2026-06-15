# Running an Analysis

Every tool follows the same four-step workflow.

## 1. Upload data

Open the **Data** panel and choose **Upload → GeoJSON File** (or CSV). Uploaded
datasets appear in the data list and become selectable in any tool. See
[Preparing Your Data](/guide/data-format) for accepted formats.

## 2. Pick a tool

From the **Select Analysis Tool** screen, choose one of:

- [3D Trajectory](/tools/trajectory-3d)
- [Space-Time Kernel Density](/tools/stkde)
- [Space-Time Cube](/tools/space-time-cube)
- [Space-Time Prism](/tools/space-time-prism)

Each tool shows a short description and its **execution badge** (browser or
backend).

## 3. Configure

1. **Choose a data source** — the trajectory to analyze.
2. **Map the Datetime Column** — the field holding each point's timestamp. This
   step is required; results depend on it.
3. **Set tool options** — every tool exposes its own options (covered on each
   tool's page).

## 4. Run & explore

Click **Run Analysis**. Results render on the 3D map, where you can:

- **Rotate / tilt** — drag to orbit, so the time (Z) axis becomes visible.
- **Animate** — when temporal data is present, a player at the bottom steps
  through time slices. Choose *progressive* (reveal 0 → T) or *window* (show only
  the current slice).
- **Hover** — read a feature's values (counts, exposure, timestamps) in a tooltip.
- **Toggle layers** — show/hide individual result layers from the legend.

::: tip Map controls & pins
Beyond analysis, the map itself supports zoom, bearing/pitch reset, basemap
switching, and a **pin-point mode** for marking features. See
[Map Controls & Pins](/guide/map-controls).
:::
