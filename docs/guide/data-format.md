# Preparing Your Data

All tools operate on **point trajectories** — a series of timestamped GPS
locations. You can upload data as **GeoJSON** or **CSV**.

## Required fields

Every record needs, at minimum:

| Field | Meaning |
|-------|---------|
| Geometry / lon-lat | The location of the observation (a `Point`) |
| A timestamp column | When the observation was recorded |

Optional columns unlock extra features:

| Column | Used by |
|--------|---------|
| A user / trajectory ID | "Align Start Times" on 3D Trajectory, STKDE, Space-Time Cube |
| A stay/location label | Stay-point visualization on 3D Trajectory |
| An environmental indicator | Exposure coloring on the Space-Time Cube |

## GeoJSON

A `FeatureCollection` of `Point` features. Each feature carries its timestamp in
`properties`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-79.6665, 43.5495] },
      "properties": {
        "date_logged": "2022-09-16 00:09:07",
        "trajectory_id": "subject-A",
        "speed_kmh": 0
      }
    }
  ]
}
```

## CSV

Upload a CSV and the app will let you map the **longitude**, **latitude**, and
**timestamp** columns during import.

```csv
date_logged,latitude,longitude,trajectory_id
2022-09-16 00:09:07,43.5495,-79.6665,subject-A
2022-09-16 00:19:51,43.5496,-79.6663,subject-A
```

## Timestamps

The timestamp column is mapped explicitly when you configure a tool (the
**Datetime Column** picker). Supported forms:

- ISO 8601 — `2022-09-16T00:09:07Z`
- Space-separated — `2022-09-16 00:09:07`
- US-style — `11/4/2022 0:07`
- Unix epoch — seconds or milliseconds

::: tip Mixed formats are handled
Real-world exports often mix formats within a single file. The Space-Time Cube
backend parses each row individually, so a file containing both
`11/4/2022 0:07` and `2022-09-16 00:09:07` still loads cleanly.
:::

## Large files

Datasets **larger than 50 MB** are kept in an in-browser cache instead of app
state, so a 100 MB+ environmental grid won't freeze the UI. Smaller files are
held in the app's normal data store. Either way, only the data a tool actually
needs is sent to the backend.

## Sample datasets

The repository ships with ready-to-use examples at its root:

| File | Description |
|------|-------------|
| `example_day_2022-09-16.geojson` | A single subject's one-day trajectory (~750 points) |
| `all_trajectories.geojson` | Several subjects over different date ranges |
| `noise_environment_2022-09-16.geojson` | An hourly noise grid for Space-Time Cube exposure |
