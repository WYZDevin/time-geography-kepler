---
trigger: always_on
---

# AI Coding Instructions (Front-End): Tool-Specific Execution Modes

You are contributing to the **front-end only** (React 18 + TypeScript + Vite + Redux Toolkit + Kepler.gl + Turf.js + Tailwind). The app supports analysis tools that can execute in different environments. Your job is to implement tooling in a way that is **execution-agnostic** at the UI level but **execution-specific** at the runner level.

This tool is an extension of kepler.gl. When adding/removing/editing items on kepler.gl, please check the documentation for details: https://docs.kepler.gl/docs/api-reference 

## 1) Tool-Specific Execution Policy (Hard Rule)

Every tool must declare an explicit **execution policy**:

* `frontend_only`: tool can run only in the browser (main thread / Web Worker).
* `backend_only`: tool can run only via remote execution.
* `hybrid`: tool supports both; user can choose and UI may recommend a default.

### Canonical policy type

```ts
type ExecutionMode = "frontend" | "backend";
type ExecutionPolicy = "frontend_only" | "backend_only" | "hybrid";
```

### Tool capability declaration (required)

Each tool definition must include:

* `executionPolicy`
* (optional) `defaultMode` when `hybrid`
* (optional) `frontendLimits` / `backendNotes` for UI guidance

Example shape:

```ts
type ToolCapabilities = {
  executionPolicy: ExecutionPolicy;
  defaultMode?: ExecutionMode; // only for hybrid
  // Optional: used by UI to warn/recommend; keep lightweight.
  recommendations?: {
    frontendMaxRows?: number;
    frontendMaxFeatures?: number;
    notes?: string[];
  };
};
```

**Do not infer capabilities from tool name or dataset size.** The policy is the source of truth.

---

## 2) UI Behavior for Execution Modes

### A) Tool picker / tool page

* If `frontend_only`: do not show a backend toggle.
* If `backend_only`: do not show a frontend toggle; show a clear “Runs on backend” badge.
* If `hybrid`:

  * show a mode selector: **Run in Browser** / **Run on Backend**
  * preselect `defaultMode` (or fall back to Browser)
  * optionally show a recommendation banner (“Recommended: Backend for large datasets”)

### B) Validation and messaging

* Validation is shared (same param schema), but errors can be mode-specific:

  * If user selects a disallowed mode, block run and show:

    * “This tool is backend-only.” or “This tool is frontend-only.”
* Warnings should be aggregated (counts + examples), never per-row spam.

### C) Results view must be mode-agnostic

Rendering consumes datasets + metadata only.
Never branch visualization behavior on mode.

---

## 3) Runner Architecture (Where Switching Happens)

**Hard rule:** The execution switch belongs to the **tool runner**, not the tool UI.

Implement a single entry point:

```ts
runTool({
  toolId,
  mode,          // "frontend" | "backend"
  datasetIds,
  params,
}): Promise<ToolRunResult>
```

### Routing logic

1. Load tool definition from registry.
2. Enforce `executionPolicy`.
3. Dispatch:

   * `frontend` → run in-browser implementation (prefer Web Worker for heavy compute).
   * `backend` → call existing remote client wrapper (job-based if async).

**Do not implement backend endpoints or server logic.**
If there is no existing remote client wrapper in the repo, do not add new network plumbing unless explicitly asked.

---

## 4) Tool Implementation Layout

A tool should be structured to separate:

* **Definition**: id/name/desc/inputSpec/paramSchema/capabilities
* **Frontend implementation** (if supported): pure compute functions + optional worker adapter
* **Backend adapter** (if supported): thin call to existing remote client wrapper

### Required exports per tool module

* `toolDef` (includes capabilities + schemas)
* `runFrontend()` only if policy includes frontend
* `runBackend()` only if policy includes backend (should delegate to existing client wrapper)

Example:

```ts
export const toolDef: SimpleTool = { ...capabilities... };

export async function runFrontend(...) { ... }   // if frontend_only or hybrid
export async function runBackend(...) { ... }    // if backend_only or hybrid
```

---

## 5) Output Contract (Must Match Across Modes)

Regardless of execution mode, a tool run returns:

* `datasets`: derived datasets (GeoJSON or tables)
* `meta`: `ToolRunMeta` lineage + summary
* optional `layerHints` (minimal; do not hardcode colors)

### ToolRunMeta (required)

```ts
type ToolRunMeta = {
  toolName: string;
  toolVersion: string;
  runAt: number; // epoch ms
  sourceDatasetIds: string[];
  params: Record<string, unknown>;
  summary: {
    inputCount: number;
    outputCount: number;
    timeRange?: { min: number; max: number };
    bbox?: [number, number, number, number];
  };
  warnings?: string[];
};
```

**Backend runs must return the same schema.** If remote results differ, normalize them in the front-end adapter before storing.

---

## 6) Browser Compute Standards (Frontend Mode)

### Web Worker requirement

Any operation likely to exceed ~50–100ms on the main thread must run in a worker:

* large loops over points/cells
* STKDE grids / cube binning
* polygon unions/intersections on non-trivial feature counts

Workers:

* do pure compute only (no UI logic)
* message format must include `jobId`
* support progress updates when feasible

### Performance guardrails

* avoid O(N²) on raw points/features
* prefer binning/indexing over pairwise comparisons
* cap grid/cell counts and warn when clamped

---

## 7) Mode-Specific Tool Constraints (How to Think)

Some tools are inherently better in one mode; the **tool declares this** via `executionPolicy`.

* `frontend_only` examples:

  * lightweight transformations
  * small-to-medium buffer operations
  * quick trajectory visualization transforms

* `backend_only` examples:

  * extremely large union/intersection dissolves
  * fine-resolution STKDE across long time spans
  * any analysis requiring libraries not available in browser

* `hybrid` examples:

  * Time Geography path + staypoint extraction (browser for small; backend for big)
  * Cube binning + hotspot detection (browser for small; backend for big)

**Important:** Do not hardcode these assumptions globally. Only enforce what the tool declares.

---

## 8) State Management Requirements (Redux)

* Store tool runs and derived datasets in Redux with stable IDs.
* Persist:

  * tool id + params + selected mode
  * run metadata + warnings
  * source dataset references
* Prefer selectors for UI read access.
* Do not store huge duplicate arrays; keep references where possible.

---

## 9) What NOT To Do

* Do not implement backend services, Flask code, or new endpoints.
* Do not add network calls outside existing remote-client modules.
* Do not hide remote execution behind automatic switching:

  * only `hybrid` tools may suggest a default
  * user must be able to see and control the selected mode

---

## 10) Checklist When Adding/Updating a Tool

1. Add/verify `executionPolicy` in tool definition.
2. Ensure UI correctly shows/hides mode selector based on policy.
3. Implement `runFrontend` and/or `runBackend` according to policy.
4. Ensure output schema + `ToolRunMeta` match expected format.
5. Add tests for:

   * policy enforcement
   * deterministic output (frontend)
   * result normalization (backend adapter)
6. Ensure Kepler visualization works without mode-specific logic.
