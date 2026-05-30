# Introduction

**Time Geography Kepler** is a geospatial analysis platform for exploring
movement data through the lens of [time geography](https://en.wikipedia.org/wiki/Time_geography).
It is built with [React](https://react.dev/), [deck.gl](https://deck.gl/), and
[MapLibre](https://maplibre.org/) on the front end, with an optional
[Flask](https://flask.palletsprojects.com/) + [GeoPandas](https://geopandas.org/)
backend for heavier server-side computation.

## Who is it for?

- **Researchers** studying human mobility, accessibility, and exposure.
- **Analysts** who want to visualize GPS trajectories without writing code.
- **Students** learning time-geography concepts (paths, prisms, density).

## What makes it different

- **Browser-first.** Every tool has a browser implementation, so the app works
  fully offline. The backend is *additive* — it unlocks heavier analyses but is
  never required to get started.
- **3D space-time.** Results are rendered as true 3D space-time visualizations
  (X = longitude, Y = latitude, Z = time), not flat maps.
- **Interactive.** Rotate, animate through time, drop pins, hover for values,
  and click to set prism anchors directly on the map.

## The toolset at a glance

| Tool | What it answers | Where it runs |
|------|-----------------|---------------|
| [3D Trajectory](/tools/trajectory-3d) | *Where and when did the subject move?* | Browser |
| [Space-Time Kernel Density](/tools/stkde) | *Where/when does activity concentrate?* | Browser |
| [Space-Time Cube](/tools/space-time-cube) | *What was the environmental exposure along the path?* | Backend |
| [Space-Time Prism](/tools/space-time-prism) | *Where could the subject have been between two points?* | Backend |

## How a tool runs

Each tool declares an **execution policy** that determines where it can run:

- `frontend_only` — runs exclusively in the browser.
- `backend_only` — requires the Flask backend.
- `hybrid` — can run in either place; you choose with a mode toggle.

See the [Architecture reference](/reference/architecture) for the full data flow.

::: tip Next steps
New here? Read the [Core Concepts](/guide/concepts), then follow
[Getting Started](/guide/getting-started) to launch the app.
:::
