# Map Controls & Pins

The map is interactive in both 2D and 3D. Navigation controls sit in the
top-left button stack. The legend and time player sit along the bottom.

## Navigation

| Control | Action |
|---------|--------|
| Drag | Pan |
| Scroll | Zoom |
| Right-drag (or Ctrl/Cmd-drag) | Rotate & tilt — reveals the time (Z) axis |
| **+ / −** buttons | Zoom in / out |
| **Compass** button | Reset bearing & pitch to north / top-down |
| **Globe / Sun / Moon** button | Cycle the basemap (Positron, Dark Matter, Satellite) |

## Pin-point mode

Pin-point mode lets you mark a feature and connect it to the ground. This is
useful when a result is tall in 3D and you want to see the feature's ground
position.

### Drop a pin

1. Click the **pin** button in the control stack. It highlights green to show
   the mode is active.
2. Click a feature (a trajectory point, a cube cell, a prism vertex). A pin drops
   at the feature's elevation with a **stem down to the ground** and a contact
   dot, so you can read its ground position even in a tall 3D scene.

Clicking the empty basemap drops a pin at ground level.

### Remove pins

- **Remove one** — click an existing pin to delete just that pin.
- **Remove all** — click the **✕** button that appears next to the pin button
  while any pins exist.

::: warning Prism is disabled in pin mode
While pin-point mode is active, the [Space-Time Prism](/tools/space-time-prism)
explorer is disabled (entering pin mode closes it, and the *Start Prism Explorer*
button is hidden). Turn pin mode off to use the prism again.
:::

## Time player

When a result contains temporal data (3D Trajectory, STKDE, prisms), a player
appears at the bottom of the map:

- **Play / Pause** — animate through time.
- **Progress slider** — scrub to a specific time.
- **Speed** — 0.25× … 8×.
- **Mode** — *progressive* (accumulate 0 → T) or *window* (only the current slice).
- **Loop** — repeat the animation.

The Space-Time Cube is a static 3D view, so it has no time player.

## Legend

The legend (bottom-left) lists every active result layer. Use it to:

- Toggle a layer's **visibility** (eye icon).
- Adjust **color / thickness** where supported.
- **Export** the layer as analysis-ready GeoJSON.

### What an export contains

Exports are meant for further analysis in ArcGIS, QGIS, or Python
(GeoPandas) — not for re-creating the 3D scene — so the file differs from
what is drawn on the map:

- **Geometry is flat 2D WGS84.** The map lifts vertices to a synthetic
  *time = altitude* z; the export strips it. Time is exported as attributes
  instead: `timestamp_ms` (epoch milliseconds) and `time_iso` (ISO 8601).
- **Only analysis attributes are kept** — densities, counts, dwell/activity
  times, travel times, durations, and your original input columns. Renderer
  fields (extrusion heights, normalized time fractions, per-feature colors)
  are removed, as are list-valued fields that cannot live in an attribute
  table.
- Internal names are exported as plain ones, e.g. `_user_id` → `user_id`,
  `_confidence` → `confidence_level`, `_ppa_total_area_km2` → `ppa_area_km2`.
- The collection carries `name`, `dataset_type`, `tool`, and `exported_at`
  as top-level members for provenance (readers that don't know them ignore
  them).

Multi-output analyses (e.g. the prism's roads / dwell surface / anchors)
export **one file per output**, since each output has its own geometry type
and attribute schema — mixed collections do not convert cleanly to feature
classes or GeoDataFrames.

The full rename table lives in the
[Tools overview](/tools/#exporting-results), and each tool's algorithm page
documents its exact per-output fields.
