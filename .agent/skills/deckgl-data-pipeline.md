---
name: deckgl-data-pipeline
description: How data flows from backend API response to deck.gl layer props in this project
trigger: keywords
keywords: [backend-normalizer, normalizer, normalizeBackendResponse, AnalysisResult, field mapping, data-processors, PROCESSED_TIME_FIELD, PROCESSED_HEIGHT_FIELD, featureCollection, outputs]
version: 1.0
---

# deck.gl Data Pipeline

## Full data flow

```
Flask POST /tools/{id}/execute
  → backendApiService.executeTool()          (src/services/backend-api-service.ts)
  → normalizeBackendResponse(raw, toolId)    (src/services/backend-normalizer.ts)
  → AnalysisResult { outputs: FeatureCollection[] }
  → analysisEngine dispatches to Redux map slice
  → DeckLayerDescriptor[] written to store
  → createDeckLayers() reads descriptors + datasets → layer instances
```

## Field name remapping

The backend uses these property names (defined in `app/back-end/app/constants.py`):

| Backend field | Frontend constant | Value |
|---|---|---|
| `_processed_time` | `PROCESSED_TIME_FIELD` | `'_time_order'` |
| `_processed_height` | `PROCESSED_HEIGHT_FIELD` | `'_height'` |
| `_processed_neighbors` | `PROCESSED_NEIGHBORS_FIELD` | `'_neighbors'` |

These constants are imported from `src/utils/constants.ts`. **Always import the constant, never hardcode the string.**

The normalizer in `backend-normalizer.ts` renames backend fields to frontend fields on every feature. Example pattern:

```ts
const props = { ...f.properties };
if (BACKEND_HEIGHT_FIELD in props) {
  props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
  delete props[BACKEND_HEIGHT_FIELD];
}
```

## Normalizer structure

`normalizeBackendResponse()` is the single entry point. It delegates per-tool:

```ts
switch (toolId) {
  case 'time-geography':      return normalizeTimeGeography(fc, outputIndex);
  case 'stkde':               return normalizeStkde(fc, outputIndex);
  case 'space-time-cube':     return normalizeSpaceTimeCube(fc, outputIndex);
  case 'space-time-prism':    return normalizeSpaceTimePrism(fc, outputIndex);
  case 'road-network-stp':    return normalizeRoadNetworkSTP(fc, outputIndex);
  default:                    return normalizeGeneric(fc, toolId);
}
```

The `outputIndex` matters — some tools return multiple `FeatureCollection`s in `outputs[]`. For example, time-geography returns index 0 = trajectory, index 1 = stay points.

## Adding a normalizer for a new tool

1. Add a new `case 'your-tool-id':` in `normalizeFeatureCollection()`.
2. Write a `normalizeYourTool(fc, outputIndex)` function.
3. Remap all backend field names to frontend constants.
4. Inject a `_dataset_type` property on features if the tool produces multiple output types (e.g. `'trajectory'` vs `'stay-point'`).
5. Add a TypeScript interface for the expected property shape in `src/interfaces/data-interfaces.ts` if the tool introduces new fields.
6. Write a Vitest unit test: mock the raw backend response → run through `normalizeBackendResponse` → assert field names and feature count.

## Schema change rule

If a backend response field is added, renamed, or removed, update **all** of:
- The normalizer function in `backend-normalizer.ts`
- The TypeScript interface in `src/interfaces/`
- The layer accessor in `layer-factory.ts` or `visualization-templates/`
- Both `CLAUDE.md` files (root and `app/front-end/`) if it affects the API contract
- The backend `app/back-end/CLAUDE.md` if the backend output shape changes

Do not silently drop a field. If a field is expected but missing, log a warning:
```ts
if (!props[PROCESSED_HEIGHT_FIELD]) {
  console.warn(`[normalizer] Missing ${PROCESSED_HEIGHT_FIELD} on feature index ${i}`);
}
```

## Large dataset considerations

For datasets over 50k rows:
- Pre-compute numeric attributes as typed arrays where possible.
- Avoid calling `JSON.parse()` or heavy `.map()` chains in the normalizer on the main thread. Move to a web worker if the transform takes > 16ms.
- The backend can return Apache Arrow (Parquet) for large outputs — check `raw.format` before assuming JSON.

## Frontend-only tools

Tools with `executionPolicy: 'frontend_only'` never go through the normalizer. Their `analyze()` method returns an `AnalysisResult` directly. The normalizer only handles backend responses.

## DO NOT

- Do not write normalizer logic inside a React component or Redux reducer.
- Do not mutate `f.properties` directly — always spread: `const props = { ...f.properties }`.
- Do not add hardcoded backend field name strings outside of `backend-normalizer.ts`. Use the `BACKEND_*` local constants defined at the top of that file.
- Do not change the `AnalysisResult` interface shape without updating the analysis engine and all callers.
