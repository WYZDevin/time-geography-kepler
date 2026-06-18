# Introduction

**Time Geography Kepler** is a geospatial analysis platform for exploring
movement data through the lens of [time geography](https://en.wikipedia.org/wiki/Time_geography).
It is built with [React](https://react.dev/), [deck.gl](https://deck.gl/), and
[MapLibre](https://maplibre.org/) on the front end, with 
[Flask](https://flask.palletsprojects.com/) + [GeoPandas](https://geopandas.org/)
backend for heavier server-side computation.

## Who is it for?

- **Researchers** studying human mobility, accessibility, and exposure.
- **Analysts** who want to visualize GPS trajectories without writing code.
- **Students** learning time-geography concepts (paths, prisms, density).

## What makes it different

- **Local only.** Every tool runs in your local computer. No data will leave your device.
- **3D space-time.** Results are rendered as true 3D space-time visualizations
  (X = longitude, Y = latitude, Z = time), not just flat maps.
- **Interactive.** Rotate, animate through time, drop pins, check value at specific location and time,
  and click to set prism anchors directly on the map to build space time prism.

## The toolset at a glance

| Tool | What it answers |
|------|-----------------|
| [3D Trajectory](/tools/trajectory-3d) | *3D visualization of the trajectory* |
| [Space-Time Kernel Density](/tools/stkde) | *Where/when does activity concentrate?* |
| [Space-Time Cube](/tools/space-time-cube) | *What was the environmental exposure along the path?* |
| [Space-Time Prism](/tools/space-time-prism) | *Where could the subject have been between two points?* |

::: tip Next steps
New here? Read the [Core Concepts](/guide/concepts), then follow
[Getting Started](/guide/getting-started) to launch the app.
:::
