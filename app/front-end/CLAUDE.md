# AI Coding Instructions: Front-End (React + deck.gl)

**Stack:** React 18, TypeScript, Vite, Redux Toolkit, deck.gl 9, react-map-gl 7, maplibre-gl 4, Turf.js, Tailwind CSS

This app is a geospatial analysis platform built on top of deck.gl + react-map-gl + maplibre-gl. It provides analysis **tools** (STKDE, Time Geography, Space-Time Cube, Space-Time Prism, Buffer, Union, Intersection) that can run either **in the browser** or on a **Flask backend**, depending on each tool's execution policy.

When adding/removing/editing deck.gl layers, datasets, or map state, check: https://deck.gl/docs/api-reference

---

## 0) Dev Commands

```bash
cd app/front-end
npm install        # Install dependencies
npm run dev        # Vite dev server → localhost:5173
npm run build      # tsc -b && vite build → dist/
npm run lint       # ESLint
npm run preview    # Preview production build
```

Environment: `.env` must contain `VITE_BACKEND_URL` (default `http://localhost:8000`). See `.env.example` at repo root for all vars.

---

## 1) Key Files & Architecture

### Interfaces

| File | Purpose |
|------|---------|
| `src/interfaces/simple-tool.ts` | Core types: `SimpleTool`, `ToolCapabilities`, `ToolRunMeta`, `ExecutionMode`, `ExecutionPolicy` |
| `src/interfaces/data-interfaces.ts` | `FeatureCollection`, `GeoJSONFeature` |
| `src/interfaces/attribute-mapping.ts` | `AttributeMapping` for field bindings |

### Services (execution layer)

| File | Purpose |
|------|---------|
| `src/services/analysis-engine.ts` | **Entry point for all tool runs.** Routes to frontend (`tool.analyze()`) or backend (`backendApiService.executeTool()`) based on `request.mode`. Returns `AnalysisResult`. |
| `src/services/backend-api-service.ts` | HTTP client for the Flask backend. Three endpoints: `GET /health`, `GET /tools`, `POST /tools/{id}/execute`. Never throws — returns `null`/error objects. |
| `src/services/execution-resolver.ts` | Determines what modes are available for a tool by combining the frontend registry + backend tool list + backend health. Exports `resolveToolCapabilities()` (pure) and `useResolvedCapabilities()` (React hook). |
| `src/services/backend-normalizer.ts` | Converts backend responses to frontend format: remaps field names (`_processed_height` -> `_height`), injects deck.gl layer configs. Tool-specific normalizers for time-geography, STKDE, space-time-cube, space-time-prism, and a generic path for buffer/union/intersection. |

### Tools

| File | Purpose |
|------|---------|
| `src/tools/index.ts` | Registers all tools into the registry on import |
| `src/tools/<tool-name>.ts` | Individual tool classes implementing `SimpleTool` |
| `src/utils/tool-registry.ts` | Singleton `ToolRegistry` — `register()`, `getTool()`, `getAllTools()`, `getToolsByCategory()` |

### State

| File | Purpose |
|------|---------|
| `src/stores/store.ts` | Redux store root |
| `src/stores/settings-slice.ts` | Backend availability, backend tool list |

### Other directories

| Directory | Purpose |
|-----------|---------|
| `src/contexts/` | React contexts — `app-context.tsx` (app state), `color-context.tsx` (color schemes) |
| `src/hooks/` | Custom hooks — `use-backend-init.ts` (backend health polling), `use-keyboard-shortcuts.ts` |
| `src/data-processors/` | Data transformation logic (e.g. `stkde.tsx` for STKDE output processing) |
| `src/lib/` | Shared utilities (`utils.ts` — cn() helper, etc.) |
| `src/components/deck-map-view.tsx` | Main map component wrapping deck.gl + react-map-gl |
| `src/components/map-legend.tsx` | Map legend overlay component |
| `src/components/map-controls.tsx` | Map control widgets (zoom, pitch, bearing) |
| `src/services/layer-factory.ts` | Creates deck.gl layer instances from analysis results |
| `src/stores/map-slice.ts` | Redux slice for map view state (viewport, layers, base map) |
| `src/interfaces/map-types.ts` | TypeScript types for map state, layer configs, view state |
| `src/visualization-templates/` | deck.gl layer config templates per tool (time-geography, buffer-zones, etc.) |

---

## 2) Execution Policy (Hard Rule)

Every tool **must** declare an `executionPolicy` in its `capabilities`:

```ts
type ExecutionMode = 'frontend' | 'backend';
type ExecutionPolicy = 'frontend_only' | 'backend_only' | 'hybrid';

interface ToolCapabilities {
  executionPolicy: ExecutionPolicy;
  defaultMode?: ExecutionMode;       // only meaningful for 'hybrid'
  recommendations?: {
    frontendMaxRows?: number;
    frontendMaxFeatures?: number;
    notes?: string[];
  };
}
```

**The policy is the source of truth.** Do not infer capabilities from tool name or dataset size.

---

## 3) How Tool Execution Works

### Data flow

```
UI component
  -> AnalysisEngine.execute({ toolId, data, options, attributes, mode })
     |
     |-- mode === 'frontend'
     |     -> toolRegistry.getTool(toolId).analyze(data, options, attributes)
     |     -> builds ToolRunMeta locally
     |     -> returns AnalysisResult
     |
     |-- mode === 'backend'
           -> backendApiService.executeTool(toolId, data, options, attributes)
           -> normalizeBackendResponse(raw, toolId)   // field remap + layer config injection
           -> returns AnalysisResult
```

### Mode resolution (what the UI should show)

`execution-resolver.ts` merges three inputs:
1. Does the frontend registry have this tool? (`canRunFrontend`)
2. Is the backend online? (`backendAvailable` from Redux)
3. Does the backend advertise this tool? (`backendTools` from Redux)

Result: `ResolvedCapabilities { canRunFrontend, canRunBackend, effectivePolicy, defaultMode, isDisabled }`

**UI rules:**
- `frontend_only` -> no backend toggle
- `backend_only` -> no frontend toggle; show "Runs on backend" badge; disable if backend offline
- `hybrid` -> show mode selector; preselect `defaultMode` (fallback: `'frontend'`)

---

## 4) Backend Communication

The backend client already exists in `backend-api-service.ts`. It targets the Flask API at `VITE_BACKEND_URL` (default `http://localhost:8000`).

### Endpoints used by the frontend

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/health` | Check if backend is reachable (5s timeout) |
| `GET` | `/api/v1/tools` | Fetch list of backend-available tools with their `executionPolicy` |
| `POST` | `/api/v1/tools/{toolId}/execute` | Run a tool. Body: `{ data, options, attributes, sourceDatasetIds, researchArea? }`. `researchArea` is an optional GeoJSON polygon (the global research area, when clipping is enabled); the backend filters output to features intersecting it. |

### Backend response normalization

The backend returns raw GeoJSON with its own field names. The normalizer (`backend-normalizer.ts`) handles:

- **Field remapping:** `_processed_height` -> `_height`, `_processed_time` -> `_time_order`, `_processed_neighbors` -> `_neighbors`
- **Layer config injection:** Backend doesn't embed deck.gl configs; the normalizer creates them per tool via `layer-factory.ts`
- **Tool-specific logic:** Separate normalizers for `time-geography`, `stkde`, `space-time-cube`, `space-time-prism`; generic handler for `buffer`/`union`/`intersection`

**When adding a new tool that supports backend:** add a case in `normalizeFeatureCollection()` if it needs field remapping or special layer configs. Generic tools can fall through to `normalizeGeneric()`.

---

## 5) Adding or Updating a Tool

### Checklist

1. **Create tool class** in `src/tools/<tool-name>.ts` implementing `SimpleTool`
2. **Set `executionPolicy`** in `capabilities` — this is required
3. **Register** in `src/tools/index.ts`
4. **Implement `analyze()`** for the frontend path (if `frontend_only` or `hybrid`)
5. **Add normalizer case** in `backend-normalizer.ts` (if `backend_only` or `hybrid` and needs field remapping)
6. **UI:** ensure the tool picker respects `ResolvedCapabilities` for toggle visibility
7. **Output contract:** `AnalysisResult` with `outputs: FeatureCollection[]`, `metadata`, and `runMeta: ToolRunMeta`

### SimpleTool interface (what to implement)

```ts
interface SimpleTool {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'visualization' | 'analysis' | 'processing';
  version: string;
  capabilities: ToolCapabilities;
  attributeMapping?: AttributeMapping;
  getOptionSchema(): ToolOptionSchema[];
  analyze(data: FeatureCollection, options: Record<string, unknown>, attributes?: AttributeMapping): Promise<FeatureCollection[]>;
}
```

### ToolRunMeta (built by AnalysisEngine for frontend runs, returned by backend for backend runs)

```ts
interface ToolRunMeta {
  toolName: string;
  toolVersion: string;
  runAt: number;                    // epoch ms
  sourceDatasetIds: string[];
  params: Record<string, unknown>;
  summary: {
    inputCount: number;
    outputCount: number;
    timeRange?: { min: number; max: number };
    bbox?: [number, number, number, number];  // [minX, minY, maxX, maxY]
  };
  warnings?: string[];
}
```

---

## 6) Browser Compute Rules (Frontend Mode)

### Web Workers

Move computation to a Web Worker if it will exceed ~50-100ms on the main thread:
- Large loops over points/cells
- STKDE grids, cube binning
- Polygon unions/intersections on many features

Worker rules:
- Pure compute only (no DOM, no UI logic)
- Message format must include `jobId`
- Support progress updates when feasible

### Performance

- Avoid O(N^2) on raw points/features
- Prefer binning/indexing over pairwise comparisons
- Cap grid/cell counts and warn when clamped

---

## 7) State Management (Redux)

- Store tool runs and derived datasets with stable IDs
- Persist: tool id, params, selected mode, run metadata, warnings, source dataset refs
- Use selectors for UI read access
- Do not store duplicate large arrays; keep references

Backend state lives in `settings-slice.ts`:
- `backendAvailable: boolean` — updated by health check
- `backendTools: BackendToolInfo[]` — updated by `GET /tools`

---

## 8) Visualization Rules

- Results rendering is **mode-agnostic**: same visualization logic for frontend and backend results
- Never branch visualization behavior on execution mode
- Layer configs come from either the tool itself (frontend) or the normalizer (backend) — deck.gl receives the same format either way
- Do not hardcode colors in tool logic; use constants from `src/utils/constants.ts`

---

## 9) What NOT To Do

- **Do not write Flask/Python code** — backend lives in `app/back-end/`, a separate codebase
- **Do not add new HTTP endpoints** or network calls outside `backend-api-service.ts`
- **Do not bypass the execution resolver** — always use `resolveToolCapabilities()` or `useResolvedCapabilities()` to determine available modes
- **Do not auto-switch modes** without user awareness — only `hybrid` tools may suggest a default; user must see and control the mode
- **Do not branch visualization on mode** — results rendering must be identical regardless of where computation happened
