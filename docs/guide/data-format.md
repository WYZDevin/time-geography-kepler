# Preparing Your Data

All tools operate on **point trajectories** — a series of timestamped GPS
locations. You can upload data as **GeoJSON** or **CSV**.

## Required fields

Every record needs, at minimum:

| Field | Meaning |
|-------|---------|
| Geometry / lon-lat | The location of the observation (a `Point`) |
| A timestamp column | When the observation was recorded in UTC format |

Optional columns unlock extra features:

| Column | Used for |
|--------|---------|
| A user / trajectory ID |If the data contains multiple user's data, you'll need a column to help the tool identify each user's trajectory rather than mixing them into single trajectory |
| A stay/location label | Each GPS point  may have a label identifying which stay this gps belongs to. This can be used to cluster the trajectory points into stays |
| An environmental indicator | Exploring the exposure of the trajectory to the enviroment. |

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

## Sample datasets

The repository ships with ready-to-use examples at its root:

| File | Description |
|------|-------------|
| `example_day_2022-09-16.geojson` | A single subject's one-day trajectory (~750 points) |
| `all_trajectories.geojson` | Several subjects over different date ranges |
| `noise_environment_2022-09-16.geojson` | An hourly noise grid for Space-Time Cube exposure |
