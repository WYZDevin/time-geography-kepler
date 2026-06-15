# Tools Overview

Time Geography Kepler ships four analysis tools. Each takes a point trajectory
and produces an interactive 3D result.

| Tool | Question it answers | Method | Time player |
|------|--------------------|--------|:-----------:|
| [3D Trajectory](/tools/trajectory-3d) | Where and when did the subject move? | Time-geographic space-time path (Hägerstrand) | ✅ |
| [Space-Time Kernel Density](/tools/stkde) | Where/when does activity concentrate? | Space-time KDE, Epanechnikov kernels (Brunsdon et al.) | ✅ |
| [Space-Time Cube](/tools/space-time-cube) | What was the exposure along the path? | `(x, y, t)` grid aggregation + env join | — |
| [Space-Time Prism](/tools/space-time-prism) | Where could the subject have been? | Two-anchor road-network PPA (Miller) | ✅ |

## Choosing a tool

- **Just want to see the movement?** → [3D Trajectory](/tools/trajectory-3d)
- **Looking for hotspots across many points?** → [STKDE](/tools/stkde)
- **Overlaying an environmental field (noise, pollution)?** → [Space-Time Cube](/tools/space-time-cube)
- **Reasoning about reachability between two timed points?** → [Space-Time Prism](/tools/space-time-prism)

## Shared options

Several options recur across tools:

| Option | Tools | Effect |
|--------|-------|--------|
| **Datetime Column** | all | Which field holds each point's timestamp (required). |
| **Show 3D Axes** | trajectory, STKDE, cube | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels** | trajectory, STKDE, cube | Tick interval on the time axis (Auto, 1h, 4h, 12h, 24h). |
| **User / Trajectory ID Column** | trajectory, STKDE, cube | Identifies separate subjects. |
| **Align Start Times (Normalize Time)** | trajectory, STKDE, cube | Re-base each subject to elapsed time from their own start, so subjects tracked over different date ranges overlay on a shared Day 1…Day n axis. |

## Exporting results

Every result layer can be downloaded as **analysis-ready GeoJSON** — from the
[legend](/guide/map-controls#legend) (per layer) or from the result panel
after a run (one file per output). The files are meant for further analysis in
ArcGIS, QGIS, or Python (geopandas), so they are *not* a dump of the 3D scene.
Shared conventions:

- **Geometry is flat 2D WGS84 (EPSG:4326).** The map lifts vertices to a
  synthetic *time = altitude* z; exports strip it and carry time as
  attributes instead.
- **Timestamps** export as `timestamp_ms` (Unix epoch, milliseconds) plus
  `time_iso` (ISO 8601, UTC) derived from it.
- **Renderer-internal fields are removed**: extrusion heights, normalized
  time fractions (`_time_order`, `_time_progress`), synthetic z values
  (`z`, `z_axis`), per-feature colors (`color_rgba`), and layer-config tags.
  List-valued fields are removed too — they cannot live in an attribute
  table.
- **Internal names export as plain ones**:

  | On the map | In the export |
  |---|---|
  | `_timestamp` | `timestamp_ms` + `time_iso` |
  | `_user_id` | `user_id` |
  | `_sequence` | `sequence` |
  | `_elapsed_ms` | `elapsed_ms` |
  | `_confidence` | `confidence_level` |
  | `_stay_id` / `_stay_label` / `_stay_duration` / `_stay_point_count` | `stay_id` / `stay_label` / `stay_duration_sec` / `stay_point_count` |
  | `_slice` / `_segment` | `slice_index` / `segment_index` |
  | `_ppa_total_area_m2` / `_ppa_total_area_km2` | `ppa_area_m2` / `ppa_area_km2` |
  | `_speed_kmh` / `_time_span_min` / `_distance_m` | `speed_kmh` / `time_span_min` / `anchor_distance_m` |
  | `_feasible_segments` / `_infeasible_segments` | `feasible_segments` / `infeasible_segments` |

- **Everything else passes through unchanged** — densities, counts, dwell and
  travel times, and the original columns of your input data.
- Each file carries `name`, `dataset_type`, `tool`, and `exported_at` as
  top-level members for provenance (RFC 7946 foreign members — readers that
  do not know them ignore them).
- Multi-output analyses export **one file per output**, because each output
  has its own geometry type and attribute schema; mixed collections do not
  convert cleanly to feature classes or GeoDataFrames.

The exact fields per output are documented in each tool's **Exported data**
section.
