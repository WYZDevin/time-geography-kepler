# Backend API

The optional Flask backend exposes a small REST API. All endpoints are prefixed
with `/api/v1` and default to `http://localhost:8000`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check. The frontend polls this to enable backend mode. |
| `GET` | `/api/v1/tools` | List registered tools with their execution policy. |
| `POST` | `/api/v1/tools/{toolId}/execute` | Run a tool and return GeoJSON outputs. |

### `GET /api/v1/health`

```json
{ "status": "healthy", "version": "1.0.0" }
```

### `GET /api/v1/tools`

```json
{
  "tools": [
    {
      "id": "space-time-cube",
      "name": "Space-Time Cube",
      "description": "Visualize spatio-temporal data as 3D cubes…",
      "version": "1.0.0",
      "executionPolicy": "backend_only"
    }
  ]
}
```

### `POST /api/v1/tools/{toolId}/execute`

**Request body:**

```json
{
  "toolId": "space-time-cube",
  "data": { "type": "FeatureCollection", "features": [ /* … */ ] },
  "attributes": { "time": "date_logged" },
  "options": { "timeSlices": 10, "envField": "env_exposure" },
  "sourceDatasetIds": ["dataset-1"]
}
```

**Success response:**

```json
{
  "success": true,
  "toolId": "space-time-cube",
  "outputs": [
    { "type": "FeatureCollection", "features": [ /* … */ ] }
  ],
  "metadata": {
    "executionTime": 1500,
    "featureCount": 142,
    "timestamp": "2026-01-15T12:00:00Z"
  },
  "runMeta": {
    "toolName": "Space-Time Cube",
    "toolVersion": "1.0.0",
    "runAt": 1736937000000,
    "sourceDatasetIds": ["dataset-1"],
    "params": { "timeSlices": 10 },
    "summary": {
      "inputCount": 100,
      "outputCount": 142,
      "bbox": [-79.7, 43.5, -79.6, 43.6]
    },
    "warnings": []
  }
}
```

`outputs` is an **array** of `FeatureCollection`s — many tools return more than
one layer (e.g. the Space-Time Cube returns cubes *and* an exposure trajectory).

## Error responses

Failures return HTTP `400`/`404` with a consistent shape:

```json
{
  "success": false,
  "toolId": "space-time-cube",
  "error": "Human-readable error message",
  "outputs": [],
  "metadata": { "executionTime": 50, "featureCount": 0, "timestamp": "…" }
}
```

- Unknown tool → `404`, `"Unknown tool: <id>"`.
- Execution error → `400` with the exception message in `error`.
- `outputs` is always `[]` on failure, and `metadata.executionTime` is always
  present.

## CORS

The API enables CORS so the frontend (a different origin/port) can call it,
including preflight `OPTIONS` requests.

## Adding a tool (backend)

1. Create `app/tools/<name>.py` subclassing `BaseTool`; implement `id`, `name`,
   `description`, and `execute()`.
2. Register it in `app/tool_registry.py`.
3. `execute(gdf, options, attributes)` receives a `GeoDataFrame` and returns a
   `list[GeoDataFrame]`. The route handles GeoJSON conversion automatically.
