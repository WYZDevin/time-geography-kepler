# Architecture

Time Geography Kepler is a **monorepo** with two independent codebases that talk
over HTTP.

```
app/
  front-end/   # React + deck.gl (TypeScript, Vite)
  back-end/    # Flask API (Python, GeoPandas)
```

The frontend works fully offline; the backend is optional and additive. The two
share no code — the **HTTP API contract is the only boundary**.

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | React 18, TypeScript, Vite, Tailwind CSS |
| Map / 3D | deck.gl 9, react-map-gl, MapLibre GL |
| State | Redux Toolkit |
| Backend | Flask, GeoPandas, Shapely, NumPy, SciPy, pyproj |
| Packaging | npm (frontend), uv (backend), Docker Compose |

## Execution policy model

Every tool declares an **execution policy** that controls where it can run:

| Policy | Meaning |
|--------|---------|
| `frontend_only` | Runs exclusively in the browser. |
| `backend_only` | Requires the Flask backend. |
| `hybrid` | Can run in either place; the user picks via a mode toggle. |

The UI resolves the *effective* modes by combining three facts: does the frontend
registry have the tool, is the backend online, and does the backend advertise the
tool. A mode toggle appears only when a real choice exists.

## End-to-end data flow

```
UI component
  → AnalysisEngine.execute({ toolId, data, options, attributes, mode })
     │
     ├─ mode = 'frontend'
     │    → tool.analyze(data, options, attributes)   // runs in-browser
     │    → builds ToolRunMeta locally
     │
     └─ mode = 'backend'
          → backendApiService.executeTool(...)        // POST to Flask
          → normalizeBackendResponse(raw, toolId)      // field remap + layer configs
     ↓
  AnalysisResult → DeckAdapter → deck.gl layers on the map
```

### Frontend services

| File | Responsibility |
|------|----------------|
| `services/analysis-engine.ts` | Entry point for every tool run; routes frontend vs backend. |
| `services/backend-api-service.ts` | HTTP client for the Flask API (never throws). |
| `services/execution-resolver.ts` | Determines which modes are available for a tool. |
| `services/backend-normalizer.ts` | Converts backend GeoJSON into frontend layer configs. |
| `services/layer-factory.ts` | Builds deck.gl layer instances from descriptors. |
| `components/deck-adapter.tsx` | Turns results into map datasets + layer descriptors. |

### Backend modules

| File | Responsibility |
|------|----------------|
| `app/__init__.py` | Flask app factory (`create_app`). |
| `app/routes.py` | API blueprint (`/api/v1`). |
| `app/tool_registry.py` | Singleton registry mapping `tool_id` → tool class. |
| `app/utils.py` | GeoJSON ↔ GeoDataFrame converters, response builder. |
| `app/tools/*.py` | One stateless tool per file (`BaseTool` subclasses). |

The backend is **stateless** — it takes a request, computes with
pandas/GeoPandas, and returns GeoJSON. There is no database.

## State management

Frontend state lives in Redux slices:

| Slice | Holds |
|-------|-------|
| `map` | View state, datasets, layer descriptors, animation, basemap. |
| `data` | Uploaded data sources (large files go to an out-of-store cache). |
| `prismExplorer` | Prism anchors, mode, and parameters. |
| `pin` | Pin-point mode flag and dropped pins. |
| `workflow` | The active tool, selected data, field mapping, options. |
| `settings` | Backend availability and the backend tool list. |

For the API contract, see the [Backend API](/reference/api) reference.
