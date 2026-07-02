# Preparing Your Data

All tools work with **point trajectories**: GPS locations recorded at known
times. You can upload data as **GeoJSON** or **CSV**.

## Required fields

Every record needs, at minimum:

| Field | Meaning |
|-------|---------|
| Location | A GeoJSON `Point`, or longitude and latitude columns in a CSV. |
| Timestamp | The time when the point was recorded. |

Optional columns unlock extra features:

| Column | Used for |
|--------|---------|
| User or trajectory ID | Keeps multiple people or tracks separate instead of merging them into one path. |
| Stay or place label | Groups points by known activity locations, such as home, work, or a visit label. |
| Environmental indicator | Stores exposure values such as noise, temperature, or pollution. |

## GeoJSON

Use a `FeatureCollection` of `Point` features. Each feature should store its
timestamp, and any other attributes, in `properties`.

The bundled `demo-datasets/individual/example_3.geojson` uses the raw device
schema below. Its timestamp is a Unix epoch value in `dataTime`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-79.645763, 43.585087] },
      "properties": {
        "dataTime": 1775911317,
        "locType": 1,
        "longitude": -79.645763,
        "latitude": 43.585087,
        "heading": 0.0,
        "accuracy": 9.39,
        "speed": -1.0,
        "distance": 0.0,
        "isBackForeground": 1,
        "stepType": 0,
        "altitude": 183.03
      }
    }
  ]
}
```

The app auto-detects the `longitude`, `latitude`, `altitude`, and `dataTime`
fields on upload, so this sample usually needs no manual column mapping.

## CSV

For CSV files, the app asks you to map the **longitude**, **latitude**, and
**timestamp** columns during import.

```csv
date_logged,latitude,longitude,trajectory_id
2022-09-16 00:09:07,43.5495,-79.6665,subject-A
2022-09-16 00:19:51,43.5496,-79.6663,subject-A
```

## Timestamps

When you configure a tool, choose the timestamp field in the **Datetime Column**
picker. Supported formats include:

- ISO 8601 — `2022-09-16T00:09:07Z`
- Space-separated — `2022-09-16 00:09:07`
- US-style — `11/4/2022 0:07`
- Unix epoch — seconds or milliseconds

::: tip Use one time zone
Use one consistent time zone in a dataset. UTC timestamps are safest for sharing
and comparing results.
:::

## Sample datasets

The repository includes ready-to-use examples under `demo-datasets/`. They are
derived from one person's 2026 GPS trace in the Toronto / GTA area. See
`demo-datasets/README.md` for the full schema and generation notes.

| File | Description |
|------|-------------|
| `individual/example_1.csv` | One clean home → activity → home day (~800 pts) — the [Getting Started](/guide/getting-started) sample |
| `individual/example_2.csv` | A second representative day (~1080 pts) |
| `individual/example_3.csv` · `individual/example_3.geojson` | A third day (~1020 pts), provided as **both** CSV and GeoJSON |
| `multi-user_30users.csv` | 30 synthetic users stacked on one shared day (`user_id` column) |

`example_3` is provided in both formats so you can compare the CSV
column-mapping flow with the ready-to-use GeoJSON upload.
