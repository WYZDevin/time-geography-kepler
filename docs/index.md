---
layout: home

hero:
  name: Time Geography Kepler
  text: Space-time trajectory analysis in your browser
  tagline: Upload GPS trajectories, run time-geography analyses, and explore the results as interactive 3D space-time visualizations.
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
  - title: 3D Trajectories
    details: Render movement paths with longitude on X, latitude on Y, and time on Z.
    link: /tools/trajectory-3d
  - title: Space-Time Kernel Density
    details: Estimate where and when activity concentrates with a 3D density volume.
    link: /tools/stkde
  - title: Space-Time Cube
    details: Bin trajectory points into stacked 3D cells and overlay environmental fields such as noise.
    link: /tools/space-time-cube
  - title: Space-Time Prism
    details: Drop two anchors and compute where someone could have been between known points.
    link: /tools/space-time-prism
  - title: Runs Locally
    details: Your data stays on your computer. Browser tools run in the frontend; a Flask backend handles heavier analyses.
    link: /reference/architecture
  - title: Docker Setup
    details: One command starts the whole platform — no Python, Node.js, or GIS install required.
    link: /guide/getting-started
---

## A typical session

1. **Upload** a trajectory dataset (GeoJSON or CSV).
2. **Pick a tool** and choose the timestamp column.
3. **Run**, then rotate, animate, and inspect the 3D result.
4. **Export** result layers as GeoJSON for GIS or Python.

New to the theory? Start with [Core Concepts](/guide/concepts). Otherwise, jump
to [Getting Started](/guide/getting-started).
