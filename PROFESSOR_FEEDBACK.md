# Professor Feedback — Feature Requests

> Collected: 2026-05-25

---

## 1. Multiple User Trajectory Support

Allow loading and processing trajectories for more than one individual at a time.

- Each trajectory dataset should be tagged with a user/participant ID
- All existing tools (Space-Time Cube, Time Geography, Prism, STKDE) must handle multi-user input, grouping computation per individual
- Sample data should include at least 2–3 synthetic users (see item 5)

---

## 2. Visualization Options — Color & Line Thickness

Expose per-layer style controls in the UI so users can customize appearance without touching code.

- **Color**: color picker or palette selector for trajectory line color (and exposure color ramp for STC)
- **Line thickness**: numeric slider or input (e.g. 1–10 px)
- Controls should apply live and persist per analysis result

---

## 3. Data Export

Allow users to download analysis results.

- Export formats: GeoJSON (primary), CSV (attribute table)
- Should cover all tool outputs: STC cubes, trajectory exposure lines, prism polygons, STKDE grids, buffer/union/intersection results
- Include a "Download result" button in the result panel or map legend

---

## 4. Space-Time Prism — Timestamp & Minimum Activity Duration

Two enhancements to the prism tool:

- **Timestamps on prism output**: each prism feature should carry the start/end time of its time window as properties, so users can filter or animate by time
- **Minimum activity duration filter**: add an option to exclude activity episodes shorter than a configurable threshold (e.g. "ignore stays < 5 minutes"), reducing noise from GPS jitter

---

## 5. Multiple User Sample Data

Provide ready-to-use synthetic datasets that demonstrate multi-user scenarios.

- At least 2–3 synthetic participant GeoJSON files with realistic overlapping trajectories
- Each file should include a participant/user ID field
- Cover a shared spatial area so overlay and comparison features are meaningful (see item 4 overlay)

---

## 6. Multiple User Overlay

Visualize trajectories from several participants simultaneously on the same map.

- Each user's trajectory rendered in a distinct color
- Support toggling individual users on/off
- Applies to raw trajectory view and to analysis outputs (e.g. side-by-side STC exposure lines)

---

## 7. Polygon Input & Intersection with Data

Allow users to draw or upload a polygon area of interest (AOI) and intersect it with loaded datasets.

- Input methods: draw on map (freehand or rectangle), or upload a GeoJSON polygon
- Intersection result: only trajectory points/segments that fall within the polygon are retained for downstream analysis
- Should integrate with the existing Intersection tool, or be offered as a pre-processing filter step before running any analysis tool

---

## 8. 2D Trajectory & Kernel Density

Add a flat (2D) trajectory view alongside the existing 3D Space-Time Cube, and a kernel density estimation layer for trajectory points.

- **2D trajectory**: render the raw GPS path as a flat polyline on the basemap, useful for quick spatial context without 3D distortion
- **Kernel density (STKDE or plain KDE)**: heatmap of point density across the study area; should be available as a standalone visualization or as an overlay on the 2D trajectory
- May reuse the existing STKDE tool output but with a dedicated simplified entry point in the UI

---

## Priority / Notes

| # | Item | Effort estimate | Notes |
|---|------|----------------|-------|
| 1 | Multi-user trajectory support | High | Foundational — blocks items 4 and 6 |
| 5 | Multi-user sample data | Low | Can be done with the existing `generate_noise_env.py` approach |
| 6 | Multi-user overlay | Medium | Depends on item 1 |
| 3 | Data export | Medium | Independent, good quick win |
| 2 | Color & thickness options | Low–Medium | UI-only change per layer |
| 4 | Prism timestamp + min duration | Medium | Backend + UI option |
| 7 | Polygon AOI input & intersection | High | New interaction paradigm |
| 8 | 2D trajectory + KDE | Medium | Partially covered by STKDE; needs UI entry point |
