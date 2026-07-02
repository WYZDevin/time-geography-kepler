# Running an Analysis

Most tools follow the same workflow: load data, choose a tool, configure the
required fields, and run the analysis.

## 1. Upload data

Open the **Data** panel and choose **Upload → GeoJSON File** (or CSV). Uploaded
datasets appear in the data list and can be selected by any tool. See
[Preparing Your Data](/guide/data-format) for accepted formats.

## 2. Pick a tool

From the **Select Analysis Tool** screen, choose one of:

- [3D Trajectory](/tools/trajectory-3d)
- [Space-Time Kernel Density](/tools/stkde)
- [Space-Time Cube](/tools/space-time-cube)
- [Space-Time Prism](/tools/space-time-prism)

Each tool shows a short description and an execution badge that tells you whether
it runs in the browser or requires the backend.

## 3. Configure

1. **Choose a data source** — the trajectory to analyze.
2. **Choose the Datetime Column** — the field that stores each point's
   timestamp. This step is required because it defines the vertical time axis.
3. **Set tool options** — each tool has its own settings, described on that
   tool's page.

## 4. Run & explore

Click **Run Analysis**. Results render on the 3D map, where you can:

- **Rotate / tilt** — drag to orbit, so the time (Z) axis becomes visible.
- **Animate** — when temporal data is present, a player at the bottom steps
  through time slices. Choose *progressive* (reveal 0 → T) or *window* (show only
  the current slice).
- **Hover** — read a feature's values (counts, exposure, timestamps) in a tooltip.
- **Toggle layers** — show/hide individual result layers from the legend.

::: tip Map controls & pins
The map also supports zoom, bearing and pitch reset, basemap switching, and
**pin-point mode** for marking features. See
[Map Controls & Pins](/guide/map-controls).
:::
