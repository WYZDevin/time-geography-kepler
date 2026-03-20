# AI Coding Instructions (Backend): Tool Execution API

You are contributing to the **backend exclusively**. This backend is a stateless Flask API serving geospatial analysis tools (Space-Time Kernel Density, Time Geography, Buffer, Union, Intersection) to a React frontend. The primary processing library is `geopandas`.

Your job is to strictly adhere to the API contract dictated by the frontend `ToolRunMeta` and `ExecutionPolicy` specifications.

## 1) Architecture Constraints

- **Language:** Python
- **Framework:** Flask
- **Data Transport:** JSON / GeoJSON (in MVP). You MUST warn the user about binary formats (Parquet/Arrow) for large datasets, but implement the GeoJSON structure first to guarantee backward compatibility with `kepler.gl` in the frontend.
- **State:** Stateless. **Do not use a database.** Take the request, execute in `pandas`/`geopandas`, return the GeoJSON.

## 2) The Core Payload Contracts

All tools must respond via `POST /api/v1/tools/<tool_id>/execute`.

### Standard Response Structure
Regardless of whether you are running `buffer` or `time-geography`, your JSON response **MUST** follow this exact `ToolRunMeta` layout or the frontend Kepler instance will crash:

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

## 3) Endpoint Specifications

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

## 4) Tool Request Signatures

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
  }
}
```

## 5) Implementation Roadmap & Rules

1. **Routing:** Centralize all routes in a `views.py` or `routes.py` connected to a Flask Blueprint.
2. **Registry Pattern:** Implement a tool registry mapping `tool_id` to a stateless Python execution class/function. Do not put execution code inside the Flask route.
3. **CORS:** You **MUST** enable `flask-cors`. The frontend runs on a different port (likely `localhost:5173`) and will issue preflight `OPTIONS` requests.
4. **Data Handling:** Create a utility to immediately convert the `data` GeoJSON dict into a `gp.GeoDataFrame`. All tool math happens in pandas/shapely, and then the utility converts the result back to GeoJSON dicts before returning to Flask.
5. **Testing:** Write explicit `pytest` asserts verifying that `response.json()["runMeta"]["summary"]["bbox"]` exists. This is the #1 point of failure with the frontend.
