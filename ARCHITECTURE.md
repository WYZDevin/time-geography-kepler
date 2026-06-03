# Architecture

This document describes the system architecture, data flow, and key design decisions for the Time Geography platform.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React)                      │
│                                                         │
│  ┌──────────┐   ┌────────────────┐   ┌──────────────┐  │
│  │ Tool     │──>│ Analysis       │──>│ deck.gl +    │  │
│  │ Picker   │   │ Engine         │   │ maplibre Map │  │
│  └──────────┘   └───────┬────────┘   └──────────────┘  │
│                   ┌─────┴──────┐                        │
│                   │            │                        │
│              frontend      backend                     │
│              path          path                        │
│                   │            │                        │
│          ┌────────┴──┐   ┌────┴───────────┐            │
│          │ tool      │   │ Backend API    │            │
│          │ .analyze()│   │ Service        │            │
│          └───────────┘   └────┬───────────┘            │
│                               │                        │
└───────────────────────────────┼────────────────────────┘
                                │ HTTP POST
                    ┌───────────┴───────────┐
                    │  Flask API (/api/v1)  │
                    │  GeoJSON → GeoDataFrame│
                    │  tool.execute()       │
                    │  GeoDataFrame → GeoJSON│
                    └───────────────────────┘
```

The platform is a **monorepo with two independent codebases** that share no code:

| Component | Path | Stack | Role |
|-----------|------|-------|------|
| Frontend | `app/front-end/` | React 18, TypeScript, Vite, Redux, deck.gl 9, react-map-gl 7, maplibre-gl 4, Turf.js | UI, browser-side computation, visualization |
| Backend | `app/back-end/` | Flask 3, Python 3.12, geopandas, scipy | Server-side computation for heavy tools |

The **API contract** is the only boundary between them. Both sides can compute tool results; the execution policy determines which side runs.

---

## Execution Policy Model

Every tool declares an **execution policy** — the single source of truth for where it can run:

| Policy | Frontend runs? | Backend runs? | UI behavior |
|--------|---------------|---------------|-------------|
| `frontend_only` | Yes | No | No backend toggle |
| `backend_only` | No | Yes | "Runs on backend" badge; disabled if backend offline |
| `hybrid` | Yes | Yes | Mode selector; preselects `defaultMode` |

### How mode resolution works

The `execution-resolver` merges three inputs at runtime:

```
Frontend tool registry    →  canRunFrontend?
Backend health check      →  backendAvailable?
Backend tool list (GET /tools) →  canRunBackend?
                                    ↓
                          ResolvedCapabilities {
                            canRunFrontend, canRunBackend,
                            effectivePolicy, defaultMode,
                            isDisabled
                          }
```

Key rule: if both sides have an implementation, the effective policy becomes `hybrid` regardless of what either side declares individually.

### Current tool policies

| Tool | ID | Policy | Notes |
|------|----|--------|-------|
| Buffer | `buffer-analysis` | `frontend_only` | Turf.js in browser |
| Union | `union-analysis` | `frontend_only` | Turf.js in browser |
| Intersection | `intersection-analysis` | `frontend_only` | Turf.js, O(N²), capped at 100 polygons |
| 3D Trajectory | `time-geography` | `frontend_only` | Up to 100k points |
| STKDE | `stkde` | `frontend_only` | Grid capped at 50×50 |
| Space-Time Cube | `space-time-cube` | `backend_only` | Heavy computation, Python-only |
| Space-Time Prism | `space-time-prism` | `hybrid` | Compute space-time prisms for movement constraints |

---

## End-to-End Data Flow

### 1. Data ingestion

```
User uploads CSV
  → PapaParse parses to rows
  → csv-service converts to GeoJSON FeatureCollection
  → stored in Redux (data-slice)
```

### 2. Tool execution

```
User selects tool + options
  → UI calls AnalysisEngine.execute({ toolId, data, options, attributes, mode })
```

**Frontend path** (`mode === 'frontend'`):
```
AnalysisEngine
  → toolRegistry.getTool(toolId)
  → tool.analyze(data, options, attributes)
  → builds ToolRunMeta (timing, bbox, counts)
  → returns AnalysisResult { outputs, metadata, runMeta }
```

**Backend path** (`mode === 'backend'`):
```
AnalysisEngine
  → backendApiService.executeTool(toolId, data, options, attributes)
      → POST /api/v1/tools/{toolId}/execute
         Body: { data, options, attributes, sourceDatasetIds }
      ← { success, outputs, metadata, runMeta }
  → normalizeBackendResponse(raw, toolId)
      → field remapping (_processed_height → _height, etc.)
      → deck.gl layer config injection
  → returns AnalysisResult
```

### 3. Backend processing (Flask side)

```
POST /api/v1/tools/{toolId}/execute
  → geojson_to_gdf(data)         # GeoJSON dict → GeoDataFrame (EPSG:4326)
  → tool.execute(gdf, options, attributes)  # returns list[GeoDataFrame]
  → gdf_to_geojson(result_gdf)   # GeoDataFrame → GeoJSON dict (re-projects to 4326)
  → build_response(...)          # wraps in { success, outputs, metadata, runMeta }
```

### 4. Visualization

```
AnalysisResult.outputs (FeatureCollection[])
  → each feature has _dataset_type and _layer_config properties
  → deck.gl receives datasets + layer configs
  → renders 2D/3D map layers
```

Visualization is **mode-agnostic** — identical rendering regardless of frontend or backend execution.

---

## Backend Normalization Pipeline

The backend returns raw GeoJSON with its own property names. The frontend normalizer (`backend-normalizer.ts`) bridges the gap:

### Field remapping

| Backend field | Frontend field | Used by |
|---------------|---------------|---------|
| `_processed_height` | `_height` | Z-axis extrusion in deck.gl 3D layers |
| `_processed_time` | `_time_order` | Time ordering for trajectory rendering |
| `_processed_neighbors` | `_neighbors` | Line layer neighbor connections |

### Layer config injection

The backend doesn't embed deck.gl layer configurations. The normalizer creates them per tool:

| Tool | Layer type | Config factory |
|------|-----------|----------------|
| `time-geography` (trajectory) | `PathLayer` (3D) | `createTrajectoryLayerConfig()` |
| `time-geography` (stay points) | `ScatterplotLayer` (sized by duration) | `createStayPointsLayerConfig()` |
| `stkde` | `GeoJsonLayer` (3D extruded polygons) | `createStkdeLayerConfig()` — per confidence level |
| `space-time-cube` | `GeoJsonLayer` (3D extruded polygons) | `createSpaceTimeCubeLayerConfig()` |
| `space-time-prism` | `GeoJsonLayer` (3D extruded) | `createSpaceTimePrismLayerConfig()` |
| buffer/union/intersection | `GeoJsonLayer` (2D polygons) | `createGenericPolygonLayerConfig()` |

---

## Tool Lifecycle

### Adding a new tool

**Frontend:**
1. Create `src/tools/<tool-name>.ts` implementing `SimpleTool`
2. Set `executionPolicy` in `capabilities`
3. Register in `src/tools/index.ts`
4. Implement `analyze()` for browser execution (if not `backend_only`)
5. Add normalizer case in `backend-normalizer.ts` if it needs field remapping

**Backend:**
1. Create `app/tools/<tool_name>.py` inheriting `BaseTool`
2. Implement `id`, `name`, `description`, `execute(gdf, options, attributes)`
3. Import and register in `app/tool_registry.py`

### Tool interface (frontend)

```typescript
interface SimpleTool {
  id: string;                    // must match backend tool ID
  name: string;
  capabilities: {
    executionPolicy: ExecutionPolicy;
    defaultMode?: ExecutionMode;
  };
  analyze(data, options, attributes?): Promise<FeatureCollection[]>;
  getOptionSchema(): ToolOptionSchema[];
}
```

### Tool base class (backend)

```python
class BaseTool(ABC):
    id: str                      # must match frontend tool ID
    name: str
    execution_policy: str        # default "hybrid"
    def execute(self, gdf, options, attributes) -> list[GeoDataFrame]: ...
    def metadata(self) -> dict: ...
```

---

## State Management

Redux store with these slices:

| Slice | Key state | Purpose |
|-------|-----------|---------|
| `data` | datasets, tool results | Uploaded data and analysis outputs |
| `settings` | `backendAvailable`, `backendTools`, map style | Backend connectivity and UI preferences |
| `workflow` | current step, selected tool, options | Multi-step tool workflow state |
| `progress` | progress percentage, message | Long-running operation feedback |
| `metadata` | run metadata per dataset | ToolRunMeta storage |

Backend state specifically:
- `backendAvailable: boolean` — updated by periodic health check (`use-backend-init` hook)
- `backendTools: BackendToolInfo[]` — fetched from `GET /api/v1/tools` on startup

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/health` | Health check (5s timeout from frontend) |
| `GET` | `/api/v1/tools` | List all backend tools with metadata |
| `POST` | `/api/v1/tools/{toolId}/execute` | Execute a tool |

### Standard response structure

```json
{
  "success": true,
  "toolId": "space-time-cube",
  "outputs": [ { "type": "FeatureCollection", "features": [...] } ],
  "metadata": {
    "executionTime": 1234,
    "featureCount": 500,
    "timestamp": "2026-04-01T12:00:00Z"
  },
  "runMeta": {
    "toolName": "Space-Time Cube",
    "toolVersion": "1.0.0",
    "runAt": 1743508800000,
    "sourceDatasetIds": ["dataset-1"],
    "params": { "timeSlices": 10 },
    "summary": {
      "inputCount": 1000,
      "outputCount": 500,
      "bbox": [-122.5, 37.7, -122.3, 37.9]
    },
    "warnings": []
  }
}
```

---

## Directory Structure

```
time-geography-kepler/
├── app/
│   ├── front-end/
│   │   ├── src/
│   │   │   ├── components/        # React UI components
│   │   │   ├── contexts/          # React contexts (app, color)
│   │   │   ├── data-processors/   # Heavy computation (STKDE)
│   │   │   ├── hooks/             # Custom hooks (backend init, shortcuts)
│   │   │   ├── interfaces/        # TypeScript types (SimpleTool, FeatureCollection)
│   │   │   ├── services/          # Core services (analysis-engine, backend-api, normalizer, resolver)
│   │   │   ├── stores/            # Redux slices (data, settings, workflow, progress)
│   │   │   ├── tools/             # Tool implementations (7 tools)
│   │   │   ├── utils/             # Constants, tool registry, data utilities
│   │   │   └── visualization-templates/  # deck.gl layer config templates
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── back-end/
│       ├── app/
│       │   ├── __init__.py        # Flask app factory
│       │   ├── routes.py          # API blueprint (/api/v1)
│       │   ├── tool_registry.py   # Singleton registry
│       │   ├── utils.py           # GeoJSON/GeoDataFrame converters
│       │   └── tools/             # Tool implementations (7 tools)
│       ├── tests/                 # pytest test suite
│       └── pyproject.toml
├── .github/workflows/ci.yml      # CI: lint + typecheck + test for both
├── docker-compose.yml             # Multi-container deployment
├── CLAUDE.md                      # AI coding instructions (root)
└── ARCHITECTURE.md                # This file
```
