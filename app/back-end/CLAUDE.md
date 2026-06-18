# AI Coding Instructions (Backend): Tool Execution API

You are contributing to the **backend exclusively**. This backend is a stateless Flask API serving geospatial analysis tools (Space-Time Kernel Density, Time Geography, Space-Time Cube, Space-Time Prism, Buffer, Union, Intersection) to a React frontend. The primary processing library is `geopandas`.

Your job is to strictly adhere to the API contract dictated by the frontend `ToolRunMeta` and `ExecutionPolicy` specifications.

## 1) Dev Commands

```bash
cd app/back-end
uv sync                              # Install deps (pyproject.toml + uv.lock)
uv run flask --app app run -p 8000   # Start dev server on port 8000
uv run pytest tests/                 # Run test suite
```

Requires **Python ≥ 3.12**. Uses **uv** as the package manager.

## 2) Architecture Constraints

- **Language:** Python
- **Framework:** Flask (app factory in `app/__init__.py` → `create_app()`)
- **Data Transport:** JSON / GeoJSON (in MVP). You MUST warn the user about binary formats (Parquet/Arrow) for large datasets, but implement the GeoJSON structure first to guarantee backward compatibility with the frontend map visualization.
- **State:** Stateless. **Do not use a database.** Take the request, execute in `pandas`/`geopandas`, return the GeoJSON.

## 3) The Core Payload Contracts

All tools must respond via `POST /api/v1/tools/<tool_id>/execute`.

### Standard Response Structure
Regardless of the tool , your JSON response **MUST** follow this exact `ToolRunMeta` layout or the frontend map visualization will crash:

```json
{
  "success": true,
  "toolId": "<tool_id>",
  "outputs": [
    {
      "type": "FeatureCollection",
      "features": [...] // GeoJSON outputs
    }
  ],
  "metadata": {
    "executionTime": 1500, // milliseconds
    "featureCount": 142,
    "timestamp": "2025-01-15T12:00:00Z" // ISO Format
  },
  "runMeta": {
    "toolName": "Human Readable Tool Name",
    "toolVersion": "1.0.0",
    "runAt": 1736937000000,
    "sourceDatasetIds": ["any-passed-ids-from-request"],
    "params": { ... }, // Echo the 'options' dict from the request here
    "summary": {
      "inputCount": 100,
      "outputCount": 142,
      "bbox": [-122, 37, -121, 38] // Very important: Array of [minX, minY, maxX, maxY]
    },
    // Any backend processing logs or notes
    "warnings": []
  }
}
```

## 4) Endpoint Specifications

### A) Tool Metadata
`GET /api/v1/tools`
Return all registered tools. The `executionPolicy` is vital:
```json
{
  "tools": [
    {
      "id": "time-geography",
      "name": "Time Geography Analysis",
      "description": "Compute space-time prisms and potential path areas",
      "version": "1.0.0",
      "executionPolicy": "hybrid" // "frontend_only", "backend_only", or "hybrid"
    }
  ]
}
```

### B) Health Check
`GET /api/v1/health`
Return `{ "status": "healthy", "version": "1.0.0" }`. The frontend's `backendApiService` polls this to enable the network toggle.

## 5) Tool Request Signatures

Your `POST` payload parser for `/execute` must anticipate `request.json` looking like this:

```python
{
  "toolId": "stkde",
  "data": { "type": "FeatureCollection", "features": [...] },
  "attributes": { "time": "timestamp_field" },
  "options": {
    "visualizeStay": False, 
    "bufferDistance": 100,
    // ... Any arbitrary kwargs passed via the UI
  },
  // Optional. GeoJSON Feature or FeatureCollection of polygons. When present,
  // every output FeatureCollection is filtered to features intersecting it
  // (see `filter_to_research_area` in app/utils.py). Whole features are kept.
  "researchArea": { "type": "FeatureCollection", "features": [...] }
}
```

## 6) Error Response Contract

On failure, the API returns HTTP 400/404 with this shape:

```json
{
  "success": false,
  "toolId": "<tool_id>",
  "error": "Human-readable error message",
  "outputs": [],
  "metadata": {
    "executionTime": 50,
    "featureCount": 0,
    "timestamp": "2025-01-15T12:00:00Z"
  }
}
```

- Unknown tool → 404 with `{"success": false, "error": "Unknown tool: <id>"}`
- Execution error → 400 with the exception message in `error`
- The `outputs` array is always empty on failure
- Always include `metadata.executionTime` even on failure (measure from request start)

## 7) Key Files & Tool Architecture

### Core modules

| File | Purpose |
|------|---------|
| `app/__init__.py` | Flask app factory (`create_app()`) — registers CORS and the API blueprint |
| `app/routes.py` | All API routes on a single Flask Blueprint (`/api/v1`) |
| `app/tool_registry.py` | Singleton `ToolRegistry` — `register()`, `get()`, `all_tools()`. Auto-registers all tools on import. |
| `app/utils.py` | GeoJSON↔GeoDataFrame converters (`geojson_to_gdf`, `gdf_to_geojson`), `build_response()` helper, `compute_bbox()` |
| `app/constants.py` | Shared constants |

### Tool base class (`app/tools/base.py`)

All tools inherit from `BaseTool`:

```python
class BaseTool(ABC):
    @property
    def id(self) -> str: ...           # abstract — unique tool ID (e.g. "stkde")
    @property
    def name(self) -> str: ...         # abstract — human-readable name
    @property
    def description(self) -> str: ...  # abstract — short description
    @property
    def version(self) -> str: ...      # default "1.0.0"
    @property
    def execution_policy(self) -> str: ...  # default "hybrid"

    def execute(self, gdf: GeoDataFrame, options: dict, attributes: dict) -> list[GeoDataFrame]:
        ...  # abstract — return list of result GeoDataFrames

    def metadata(self) -> dict:  # returns the tool info dict for GET /tools
```

### Registered tools

| File | Tool ID | Policy |
|------|---------|--------|
| `app/tools/stkde.py` | `stkde` | hybrid |
| `app/tools/time_geography.py` | `time-geography` | hybrid |
| `app/tools/space_time_cube.py` | `space-time-cube` | hybrid |
| `app/tools/buffer.py` | `buffer` | hybrid |
| `app/tools/union.py` | `union` | hybrid |
| `app/tools/intersection.py` | `intersection` | hybrid |
| `app/tools/space_time_prism.py` | `space-time-prism` | hybrid |

### Adding a new tool

1. Create `app/tools/<name>.py` — subclass `BaseTool`, implement `id`, `name`, `description`, and `execute()`
2. Register it in `app/tool_registry.py` → `_register_all()`
3. `execute()` receives a `GeoDataFrame` and must return `list[GeoDataFrame]`
4. The route handler in `routes.py` handles GeoJSON conversion and response building automatically via `utils.py`

## 8) Implementation Roadmap & Rules

1. **Routing:** Centralize all routes in a `views.py` or `routes.py` connected to a Flask Blueprint.
2. **Registry Pattern:** Implement a tool registry mapping `tool_id` to a stateless Python execution class/function. Do not put execution code inside the Flask route.
3. **CORS:** You **MUST** enable `flask-cors`. The frontend runs on a different port (likely `localhost:5173`) and will issue preflight `OPTIONS` requests.
4. **Data Handling:** Create a utility to immediately convert the `data` GeoJSON dict into a `gp.GeoDataFrame`. All tool math happens in pandas/shapely, and then the utility converts the result back to GeoJSON dicts before returning to Flask.
5. **Testing:** Write explicit `pytest` asserts verifying that `response.json()["runMeta"]["summary"]["bbox"]` exists. This is the #1 point of failure with the frontend.
