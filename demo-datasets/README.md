# Time-Geography Demo Datasets

## About the source

The raw file is **one real person's** GPS trace, **Jan 1 – Jun 15 2026** (157 days,
despite the `12.31` filename). It spans several cities; the dominant home base is the
**Toronto / GTA metro** (~141 days). Travel days (Tokyo, SF Bay, Shenzhen, …) are
ignored. Detected real home ≈ `-79.646, 43.585` (Mississauga). Columns are the device
schema: `dataTime` (Unix seconds), `locType, longitude, latitude, heading, accuracy,
speed, distance, isBackForeground, stepType, altitude`. The app auto-detects
`longitude`/`latitude`/`altitude` and `dataTime` (time) on upload — no remapping needed.

## 1. Individual datasets (`individual/`)

Three **representative full days**, used as-is — real coordinates, real timestamps,
original schema. Each is a single clean home → activity → home trajectory, chosen for
good coverage and variety:

| File | Date | Points | Span | Max trip from home |
|------|------|-------:|-----:|-------------------:|
| `example_1.csv` | 2026-06-13 |  817 | 20.2 h | 29.4 km (clean round trip) |
| `example_2.csv` | 2026-02-21 | 1076 | 22.6 h | 25.5 km |
| `example_3.csv` | 2026-04-11 | 1022 | 15.6 h | 39.2 km (wide excursion) |

Upload one and run the **3D Trajectory** tool to see a single person's space-time path.

**Formats.** Each day is a CSV in the device schema above. `example_3` is also provided
as **GeoJSON** (`example_3.geojson`): the same 1022 points as a `Point` `FeatureCollection`,
geometry `[longitude, latitude]`, with every CSV column preserved as a feature property
(including `altitude`).

## 2. Multi-user dataset (`multi-user_30users.csv`)

**30 synthetic users**, 13,121 rows. Each user is one clean home-anchored day from the
real trace, transformed into a distinct person:

- **Faked home (privacy + distinct users):** each day's whole trajectory is translated
  so its real home maps onto a **fake home scattered realistically across the real
  Toronto metro**. Movement shape, distances, and
  time-of-day are preserved; only the absolute location changes.
- **Shared timeline:** all users are re-based to one reference day (**2026-06-15**),
  keeping each point's real time-of-day, so every path stacks over a single 24 h Z-axis.
- **`user_id` column** added (`user_01` … `user_30`).

### How to view in the app

1. Upload `multi-user_30users.csv`.
2. Open the **3D Trajectory** tool.
3. Set **User ID Column** → `user_id` (each user gets a distinct color).
