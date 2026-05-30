---
layout: home

hero:
  name: Time Geography Kepler
  text: Space-time trajectory analysis in your browser
  tagline: Upload GPS trajectories, run time-geography analyses, and explore the results as interactive 3D space-time visualizations — no install required.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Browse the Tools
      link: /tools/
    - theme: alt
      text: View on GitHub
      link: https://github.com/WYZDevin/time-geography-kepler

features:
  - icon: 🛰️
    title: 3D Trajectories
    details: Render movement paths in space-time with longitude (X), latitude (Y), and time (Z), colored and animated through the day.
    link: /tools/trajectory-3d
  - icon: 🔥
    title: Space-Time Kernel Density
    details: Estimate where and when activity concentrates with a 3D STKDE volume and 90/95/99% confidence surfaces.
    link: /tools/stkde
  - icon: 🧊
    title: Space-Time Cube
    details: Bin trajectory points into stacked 3D cells over time — and overlay an environmental field (e.g. noise) to read exposure along the path.
    link: /tools/space-time-cube
  - icon: 🔷
    title: Space-Time Prism
    details: Drop two anchors and compute the potential path area — where someone could have been between two known points, on a road network or grid.
    link: /tools/space-time-prism
  - icon: 🌐
    title: Runs Offline
    details: Every tool has a browser implementation. An optional Flask backend adds server-side power for the heavier analyses.
    link: /reference/architecture
  - icon: 🐳
    title: One-Command Setup
    details: Install Docker, run one command, and the whole platform starts on your computer — no coding required.
    link: /guide/getting-started
---

## What can I do with it?

Time Geography Kepler turns raw GPS logs into the classic visual language of
**time geography** — space-time paths, prisms, and density volumes — directly in
an interactive deck.gl map.

A typical session:

1. **Upload** a trajectory dataset (GeoJSON or CSV).
2. **Pick a tool** (3D Trajectory, STKDE, Space-Time Cube, or Space-Time Prism).
3. **Map your time column** and adjust a few options.
4. **Run** — in the browser, or on the optional backend for heavier work.
5. **Explore** the 3D result: rotate, animate through time, drop pins, and read
   values on hover.

Continue to the [Introduction](/guide/introduction) for the concepts, or jump
straight to [Getting Started](/guide/getting-started).
