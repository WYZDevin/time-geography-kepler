# Map Controls & Pins

The map is fully interactive. Controls live in the **top-left button stack**;
the **legend** and **time player** sit along the bottom.

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

Pin-point mode lets you mark specific features on the map and anchor them to the
ground — handy for annotating a point of interest while exploring a 3D result.

### Drop a pin

1. Click the **📍 pin** button in the control stack. It highlights green to show
   the mode is active.
2. Click a feature (a trajectory point, a cube cell, a prism vertex). A pin drops
   at the feature's elevation with a **stem down to the ground** and a contact
   dot, so you can read its ground position even in a tall 3D scene.

Clicking empty basemap drops a pin at ground level.

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
- **Export** the current view as GeoJSON.
