# Tools Overview

Time Geography Kepler includes four main analysis tools. Each starts from a
timestamped point trajectory and produces an interactive map result.

| Tool | Question it answers | Method | Time player |
|------|--------------------|--------|:-----------:|
| [3D Trajectory](/tools/trajectory-3d) | Where and when did the subject move? | Time-geographic space-time path ([algorithm](/tools/trajectory-3d-algorithm)) | Yes |
| [Space-Time Kernel Density](/tools/stkde) | Where and when does activity concentrate? | Space-time KDE ([algorithm](/tools/stkde-algorithm)) | Yes |
| [Space-Time Cube](/tools/space-time-cube) | What was the exposure along the path? | `(x, y, t)` grid aggregation plus optional environment join ([algorithm](/tools/space-time-cube-algorithm)) | — |
| [Space-Time Prism](/tools/space-time-prism) | Where could the subject have been? | Two-anchor road-network potential path area ([algorithm](/tools/space-time-prism-algorithm)) | Yes |

Each tool's page documents its **parameters**; a companion **Algorithm** page
(linked above) explains the computation method behind it.

## Choosing a tool

- **Just want to see the movement?** → [3D Trajectory](/tools/trajectory-3d)
- **Looking for hotspots across trajectories?** → [STKDE](/tools/stkde)
- **Overlaying an environmental field (noise, pollution)?** → [Space-Time Cube](/tools/space-time-cube)
- **Reasoning about reachability between two timed points?** → [Space-Time Prism](/tools/space-time-prism)

## Shared options

Several settings appear in more than one tool:

| Option | Tools | Effect |
|--------|-------|--------|
| **Datetime Column** | all | Field that stores each point's timestamp. Required. |
| **Show 3D Axes** | trajectory, STKDE, cube | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels** | trajectory, STKDE, cube | Tick interval on the time axis (Auto, 1h, 4h, 12h, 24h). |
| **User / Trajectory ID Column** | trajectory, STKDE, cube | Keeps separate subjects or tracks from being merged into one path. |
| **Align Start Times** | trajectory, STKDE, cube | Re-base each subject to elapsed time from their own start, so subjects tracked on different dates share a Day 1 ... Day n axis. |

## Exporting results

Every result layer can be downloaded as **analysis-ready GeoJSON** from the
[legend](/guide/map-controls#legend) or from the result panel after a run. These
files are intended for ArcGIS, QGIS, or Python (GeoPandas).

Shared export conventions:

- **Geometry is flat 2D WGS84 (EPSG:4326).** The map lifts features into 3D for
  display, but exports keep normal 2D geometries and store time in attributes.
- **Timestamps** export as `timestamp_ms` (Unix epoch, milliseconds) plus
  `time_iso` (ISO 8601, UTC) derived from it.
- **Renderer-internal fields are removed**: extrusion heights, normalized
  time fractions (`_time_order`, `_time_progress`), synthetic z values
  (`z`, `z_axis`), per-feature colors (`color_rgba`), and layer-config tags.
  List-valued fields are removed too.

The exact fields per output are documented in each tool's algorithm page.
