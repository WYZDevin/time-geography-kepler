# AI-Agent Workflow for deck.gl Application Development

*Scope: building applications that use deck.gl as the primary map/visualization engine — not modifying deck.gl itself.*

*Sources: deck.gl docs, Playwright docs, Claude Code / OpenHands skill formats, GitHub Copilot instructions format, this repo's existing structure.*

---

## Table of Contents

1. [Recommended Workflow](#1-recommended-workflow)
2. [Recommended Tools](#2-recommended-tools)
3. [Repo Structure](#3-repo-structure)
4. [Agent Skills](#4-agent-skills)
5. [Skill Files](#5-skill-files)
6. [Agent Prompts](#6-agent-prompts)
7. [CI / Commands](#7-ci--commands)
8. [Guardrails](#8-guardrails)
9. [Final Recommendation](#9-final-recommendation)

---

## 1. Recommended Workflow

**End-to-end: Feature spec → PR review**

```
1. Spec  →  2. Agent planning  →  3. Layer logic  →  4. Unit tests
     →  5. Visual baseline  →  6. Performance check  →  7. E2E test  →  8. PR
```

### Step 1 — Spec

Write a feature spec as a short markdown file in `.agent/specs/<feature>.md`. Include:

- What layer(s) are involved
- What data shape the layer expects
- What picking/hover/click behavior is needed
- What the visual outcome should look like

### Step 2 — Agent reads context

The agent reads in order: root `CLAUDE.md` → `app/front-end/CLAUDE.md` → the spec → the relevant skill file from `.agent/skills/`.

It identifies which files to touch:
- A tool in `src/tools/`
- A normalizer in `src/services/backend-normalizer.ts`
- A template in `src/visualization-templates/`
- The layer factory in `src/services/layer-factory.ts`

### Step 3 — Layer changes are isolated

The agent modifies the layer config/template and factory — not the map component directly. `deck-map-view.tsx` stays untouched unless the view state itself changes. All data transformation happens outside React render, in `src/data-processors/` or `src/services/`.

### Step 4 — Unit tests first

Vitest tests cover:
- Layer config output (does the factory return the correct layer type and props?)
- Data normalizer output (does the backend response map to the correct field names?)
- Any pure utility functions

Tests run in under 5 seconds with no browser.

### Step 5 — Visual baseline captured

After unit tests pass, the developer runs `npm run e2e:update` once locally, inspects the generated PNG, and commits it. All future CI runs compare against this committed baseline.

### Step 6 — Performance review

The agent runs the performance checklist (see [skill file](#deckgl-performance-review)) against the new layer:
- Checks accessor functions on hot paths
- Verifies `updateTriggers` are set for all function accessors
- Checks data object identity is stable
- Notes the feature count

### Step 7 — E2E test

A Playwright test injects fixture data via the Redux store (the pattern already established in `e2e/animation.spec.ts`), runs the tool, waits for the deck.gl canvas to stabilize, and asserts that picking works and tooltip text is correct.

### Step 8 — PR

Human reviewer checks:
- Visual diff images in the PR (Playwright test artifacts)
- TypeScript errors are zero (`npm run typecheck`)
- Unit test coverage is not decreasing
- No new network calls without a documented reason

---

## 2. Recommended Tools

| Category | Tool | Role |
|---|---|---|
| Coding agent | Claude Code (claude-sonnet-4-6 or claude-opus-4-7) | Primary agent; reads CLAUDE.md skill chain |
| Secondary agent | Codex CLI (`codex:rescue`) | Rescue / second-opinion pass |
| Unit tests | Vitest + @testing-library/react | Fast, no browser required |
| E2E + visual regression | Playwright | Browser-based, WebGL canvas |
| Type checking | TypeScript `tsc --noEmit` | Separate from build — catches type errors without emitting |
| Linting | ESLint | Already configured |
| Performance profiling (dev) | deck.gl StatsWidget + Chrome DevTools Performance tab | Interactive, not automated |
| Performance in CI | Custom Vitest benchmark or `performance.measure()` in Playwright | Automated frame-count or timing assertion |
| Backend tests | pytest | Already configured |
| API contract check | Custom script comparing frontend ↔ backend tool registries | Catches schema drift between codebases |

### Why this combination

- **Vitest** runs pure logic tests (data transforms, layer config) in milliseconds without spinning up a browser.
- **Playwright** handles everything that needs an actual rendered canvas: picking, tooltips, visual baselines.
- **Separate `typecheck` script** catches type errors independently of the build step, making CI failure messages clearer.
- **StatsWidget** ([deck.gl docs](https://deck.gl/docs/api-reference/widgets/stats-widget)) exposes live FPS and GPU time without external tooling.

---

## 3. Repo Structure

Your existing layout is good. The additions needed are marked with `← ADD`.

```
time-geography-kepler/
├── CLAUDE.md                        # Root: repo overview, cross-codebase rules
├── AI_AGENT_WORKFLOW.md             # ← This document
├── .agent/
│   ├── rules/
│   │   └── claude.md                # ✅ Already exists (always_on: monorepo nav)
│   ├── skills/                      # ← ADD: one file per capability area
│   │   ├── deckgl-layer-config.md
│   │   ├── deckgl-data-pipeline.md
│   │   ├── deckgl-picking.md
│   │   ├── deckgl-performance.md
│   │   └── visual-regression.md
│   └── specs/                       # ← ADD: per-feature specs (ephemeral, not committed)
│       └── <feature-name>.md
├── .github/
│   ├── copilot-instructions.md      # ← ADD: GitHub Copilot repo-wide rules
│   └── workflows/
│       └── ci.yml                   # ✅ Already exists
├── app/
│   ├── front-end/
│   │   ├── CLAUDE.md                # ✅ Detailed frontend rules
│   │   ├── src/
│   │   │   ├── tools/               # ✅ Tool definitions
│   │   │   ├── services/
│   │   │   │   ├── layer-factory.ts # Creates layer instances from analysis results
│   │   │   │   ├── backend-normalizer.ts
│   │   │   │   └── execution-resolver.ts
│   │   │   ├── visualization-templates/   # ✅ Layer config JSON per tool
│   │   │   ├── data-processors/     # ✅ Transform logic (no React dependencies)
│   │   │   ├── hooks/
│   │   │   ├── stores/
│   │   │   └── components/
│   │   ├── e2e/
│   │   │   ├── fixtures/            # ✅ Sample GeoJSON for tests
│   │   │   ├── snapshots/           # ← ADD: Playwright baseline PNGs (committed to git)
│   │   │   └── *.spec.ts
│   │   └── src/utils/
│   │       └── layer-perf-check.ts  # ← ADD: perf audit utility (dev only, not shipped)
│   └── back-end/
│       ├── CLAUDE.md                # ✅ Backend rules
│       └── tests/                   # ✅ pytest suite
```

### Key structural principle

`src/visualization-templates/` and `src/services/layer-factory.ts` are the **agent's primary edit zone** for layer work. `deck-map-view.tsx` is touched rarely and requires human review when it is.

---

## 4. Agent Skills

Place these in `.agent/skills/`. In Claude Code's skill format, each file uses YAML frontmatter to declare when it is loaded; the body contains the instruction.

| Skill file | Trigger keywords | Purpose |
|---|---|---|
| `deckgl-layer-config.md` | `layer`, `ScatterplotLayer`, `GeoJsonLayer`, `layer-factory`, `visualization-templates` | How to add/configure layers safely as a consumer of the deck.gl API |
| `deckgl-data-pipeline.md` | `backend-normalizer`, `normalizer`, `data-processor`, `AnalysisResult`, `field mapping` | How data flows from Flask response to layer props |
| `deckgl-picking.md` | `picking`, `tooltip`, `getTooltip`, `onHover`, `onClick`, `PickingInfo`, `pickable` | Picking, tooltips, hover/click behavior, and how to test them |
| `deckgl-performance.md` | `performance`, `slow`, `FPS`, `large dataset`, `binary`, `updateTriggers`, `StatsWidget` | Performance checklist and anti-patterns from official docs |
| `visual-regression.md` | `screenshot`, `snapshot`, `visual regression`, `baseline`, `toHaveScreenshot`, `canvas` | Playwright visual baseline management for WebGL canvas |

Each skill is loaded **on demand** when the keywords appear in the agent's task — preventing token bloat for unrelated tasks.

---

## 5. Skill Files

### `deckgl-layer-config.md` — App-level layer configuration

```markdown
---
name: deckgl-layer-config
description: How to safely add and configure deck.gl layers at the application level
trigger: keywords
keywords: [layer, ScatterplotLayer, PathLayer, PolygonLayer, GeoJsonLayer, ColumnLayer,
           HeatmapLayer, SolidPolygonLayer, visualization-templates, layer-factory]
version: 1.0
---

# deck.gl Layer Configuration (Application Level)

You are configuring deck.gl layers as a CONSUMER of the deck.gl API.
Do NOT modify anything inside node_modules/@deck.gl/ or node_modules/luma.gl/.

## Where to make changes
- src/visualization-templates/<tool>.json  — static layer config templates
- src/services/layer-factory.ts           — creates layer instances from analysis results
- src/tools/<tool>.ts                     — tool definition including frontend analyze() return value

## Layer construction rules

1. Always return layers as an array from the factory function.
2. Use `id` on every layer — must be stable and unique. Format: `<tool>-<type>-layer`.
3. Set `pickable: true` only on layers where hover/click is needed. Picking doubles draw cost.
4. Set `updateTriggers` whenever accessor functions depend on external state:
   updateTriggers: { getFillColor: [colorScheme, threshold] }
5. Use constant values instead of functions when the value is uniform:
   GOOD: getFillColor: [255, 0, 0, 180]
   BAD:  getFillColor: () => [255, 0, 0, 180]   // forces CPU evaluation per feature
6. Pass data as a stable reference. Do not create new arrays inside JSX render.
7. Use `visible` prop to show/hide — do not add/remove layers from the array at render time.

## Accessor optimization (source: https://deck.gl/docs/developer-guide/performance)
- Prefer typed arrays / binary attributes for datasets > 100k rows.
- Use *Scale props (radiusScale, lineWidthScale) as uniform multipliers instead of
  per-feature scaling functions.
- Reuse the same data object reference across renders; deck.gl shallow-compares to avoid
  buffer regeneration.

## DO NOT
- Do not put layer construction inside a React render function body.
- Do not call `new ScatterplotLayer()` more than once per render cycle for the same layer.
- Do not modify deck.gl internal source code.
- Do not add a new @deck.gl sub-package without updating package.json and documenting
  the reason in the PR.
```

---

### `deckgl-data-pipeline.md` — Data pipeline validation

```markdown
---
name: deckgl-data-pipeline
description: How data flows from the backend response to deck.gl layer props
trigger: keywords
keywords: [backend-normalizer, normalizer, data-processor, analyze, AnalysisResult,
           layer props, field mapping]
version: 1.0
---

# deck.gl Data Pipeline Validation

## Data flow in this app
  Flask API response (JSON)
    → backend-normalizer.ts  (field remapping, layer config injection)
    → AnalysisResult object
    → layer-factory.ts       (creates layer instances)
    → deck.gl layer props

## Normalizer rules
- Each tool has its own normalizer function in src/services/backend-normalizer.ts.
- Field name remapping MUST be documented in a comment: // _processed_height → _height
- Output MUST include: { type, data: GeoJSON | typed array, layerConfig: {...} }
- Never silently drop fields. Log a warning if an expected field is missing.
- Validate that coordinate values are numbers, not strings, before returning.

## Data shape contracts
- GeoJSON features: { type: 'Feature', geometry: {...}, properties: {...} }
- The `properties` object keys must match what the layer accessor expects.
- If a new field is added to the backend response, update ALL of:
  1. The normalizer function
  2. The TypeScript interface in src/interfaces/
  3. The layer accessor in visualization-templates/ or layer-factory.ts
  4. Both CLAUDE.md files if the API contract changes

## Large dataset rules (> 50k rows)
- Pre-compute attributes as Float32Array / Uint8Array before passing to the layer.
- Do NOT pass raw GeoJSON with string property values when numeric typed arrays can be used.
- Use Apache Arrow via @loaders.gl/arrow if the backend supports Parquet output.

## Testing the pipeline
- Unit test: mock the raw backend JSON → run through normalizer → assert output shape.
- E2E test: inject fixture GeoJSON via Redux dispatch (see e2e/animation.spec.ts pattern).
```

---

### `deckgl-picking.md` — Interaction and picking

```markdown
---
name: deckgl-picking
description: How to implement and test deck.gl picking, hover, click, and tooltips
trigger: keywords
keywords: [picking, tooltip, getTooltip, onHover, onClick, PickingInfo, pickable]
version: 1.0
---

# deck.gl Picking and Interaction
# Source: https://deck.gl/docs/developer-guide/interactivity

## How picking works
- Enable per layer with `pickable: true`.
- deck.gl renders an offscreen picking buffer; hover/click events query it.
- PickingInfo object has: object (the data item), index, layer, coordinate, x, y.

## Tooltip pattern
  getTooltip={({ object }) => object && {
    html: `<b>${object.properties.name}</b><br/>${object.properties.value}`,
    style: { color: '#fff', background: '#333' }
  }}
Return null or undefined to hide. Return a string for plain text.

## onClick pattern
  onClick={(info) => {
    if (!info.object) return;
    dispatch(selectFeature(info.object.properties.id));
  }}

## Testing picking in unit tests (no browser)
  const info = deck.pickObject({ x: 400, y: 300, radius: 1 });
  expect(info?.object?.properties?.id).toBe('expected-id');

## Testing picking in Playwright (E2E)
  await page.mouse.move(640, 400);
  await expect(page.locator('[data-testid="map-tooltip"]')).toContainText('Expected name');
Add data-testid="map-tooltip" to the tooltip container in the app.

## DO NOT
- Do not enable pickable: true on all layers by default — doubles draw cost.
- Do not update React state inside onHover without throttling.
- Do not read DOM coordinates directly; use the x, y from PickingInfo.
```

---

### `deckgl-performance.md` — Performance review

```markdown
---
name: deckgl-performance
description: Performance review checklist for deck.gl layers and data pipelines
trigger: keywords
keywords: [performance, slow, lag, FPS, frame rate, large dataset, profiling,
           StatsWidget, binary, updateTriggers]
version: 1.0
---

# deck.gl Performance Review
# Source: https://deck.gl/docs/developer-guide/performance
# Target: 60 FPS with up to ~1M features on modern hardware.

## Checklist — run before every PR that adds or changes a layer

### Data
- [ ] Data object reference is stable across renders (not recreated in JSX).
- [ ] Arrays are typed (Float32Array, Uint8Array) for datasets > 50k rows.
- [ ] No JSON.parse() or .map() inside the React component body.
- [ ] Async data loading uses deck.gl async iterables (v7.2+) for progressive rendering.

### Accessors
- [ ] Constant accessor values use the array/value form, not a function.
- [ ] Function accessors have a corresponding updateTriggers entry listing all dependencies.
- [ ] No function that creates a new closure on every render is passed as an accessor.

### Layers
- [ ] pickable: true is only set on layers where interaction is needed.
- [ ] Layers that are hidden use visible: false, not conditional array inclusion.
- [ ] No more than one Deck instance in the app.
- [ ] Layers are not recreated inside a React effect that runs on every render.

## Monitoring in development
- Add <StatsWidget /> in dev mode to see live FPS and GPU time.
  Source: https://deck.gl/docs/api-reference/widgets/stats-widget
- Use Chrome DevTools Performance tab → record 5 seconds of interaction.
  Look for: long tasks > 50ms, GPU main thread stalls, repeated buffer uploads.
- Check deck.props.layers.length — more than ~20 simultaneous layers warrants review.

## Known anti-patterns (from official docs)
- Reassigning data prop on every render → rebuilds all GPU buffers.
- Invisible layers (visible: false) still consume memory; remove from array if permanently unused.
- Multiple Deck instances → duplicates WebGL context overhead.
- Complex per-feature accessor callbacks on millions of items → use pre-computed typed arrays.
```

---

### `visual-regression.md` — Visual regression testing

```markdown
---
name: visual-regression
description: How to capture, manage, and update Playwright visual regression baselines
trigger: keywords
keywords: [screenshot, snapshot, visual regression, baseline, toHaveScreenshot,
           Playwright, canvas]
version: 1.0
---

# Visual Regression Testing (deck.gl / WebGL)
# Source: https://playwright.dev/docs/test-snapshots

## Framework
Playwright toHaveScreenshot()
Baselines stored in: app/front-end/e2e/snapshots/ (committed to git)

## WebGL rendering variance
WebGL output varies by GPU and driver. Use a permissive pixel threshold:
  await expect(page).toHaveScreenshot('layer-name.png', {
    maxDiffPixelRatio: 0.02,   // 2% pixel variance allowed
    threshold: 0.1,            // per-pixel color distance threshold
  });

## Adding a new baseline (procedure)
1. Implement the feature; verify it renders correctly in the browser.
2. Run: npm run e2e:update
3. Open e2e/snapshots/<test-name>.png and visually confirm it is correct.
4. Commit the PNG: "test: add visual baseline for <feature>"
5. All subsequent CI runs compare against this committed file.

## NEVER run --update-snapshots in CI.
The npm run e2e script must NOT include --update-snapshots.
Baseline updates require human visual inspection before commit.

## Waiting for deck.gl to finish rendering
  await page.waitForSelector('canvas');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);   // WebGL needs one more animation frame to settle

## Scope screenshot to canvas only (avoids UI false positives)
  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveScreenshot('layer-name.png', { maxDiffPixelRatio: 0.02 });

## Flakiness reduction
- Disable CSS animations in test:
    await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });
- Use retries: 2 in playwright.config.ts for visual tests.
- Always use a fixed viewport (1280x900 already set in playwright.config.ts).

## Headless WebGL note
Current config uses --disable-gpu + --disable-software-rasterizer (CI stability).
This means visual baselines MUST be captured locally (with GPU), then committed.
Do not capture baselines in CI headless mode — the canvas will be blank.
```

---

## 6. Agent Prompts

Store these in `.agent/specs/prompts.md` or paste them directly into the agent's input.

### Implementing a deck.gl feature

```
Implement the following deck.gl feature in this app.

Feature: <name>
Layer type: <deck.gl layer class, e.g. ScatterplotLayer>
Input data: <describe the GeoJSON or typed array shape>
Visual output: <describe what should appear on the map>
Picking behavior: <describe hover/click/tooltip requirements>

Rules:
- Read app/front-end/CLAUDE.md first.
- Add the layer config to src/visualization-templates/<tool>.json.
- Add or update the normalizer in src/services/backend-normalizer.ts
  if backend data is involved.
- Add or update src/services/layer-factory.ts to construct the layer.
- Do NOT modify deck-map-view.tsx unless the view state itself must change.
- Do NOT create new array/object literals for layer data inside a React
  component body.
- Write a Vitest unit test asserting the layer factory returns the correct
  layer type and props.
- After tests pass, run `npm run e2e:update` once to capture the visual baseline.
```

### Reviewing deck.gl performance

```
Review the following layer for performance issues.

Layer or file: <path or layer name>
Dataset size: <approximate row count>

Check against the deckgl-performance skill checklist:
1. Is the data reference stable across renders?
2. Are accessor functions correct (constant value vs function + updateTriggers)?
3. Is pickable: true used selectively?
4. Are there invisible layers that should be removed from the array
   instead of hidden with visible: false?
5. Is there any large transform (map, filter, sort) happening inside
   React render?

Report: list of found issues, severity (blocking / warning / info),
and the suggested fix for each.
Do not make changes — report only.
```

### Adding a new layer type

```
Add a new <LayerTypeName> layer to the tool named <tool-name>.

Steps:
1. Read app/front-end/CLAUDE.md and .agent/skills/deckgl-layer-config.md.
2. Add a new entry to src/visualization-templates/<tool-name>.json.
3. Update src/services/layer-factory.ts to handle the new layer type.
4. If the backend produces new fields, update:
   - src/services/backend-normalizer.ts
   - src/interfaces/ (TypeScript types)
5. Write a Vitest unit test: mock analysis result → assert factory returns
   the correct layer instance with correct props.
6. Run the performance checklist from deckgl-performance skill.
7. Capture a visual baseline locally with `npm run e2e:update` after
   confirming visually.

Do not rename or remove any existing layer types.
Do not change the data schema without updating both CLAUDE.md files.
```

### Adding a visual regression test

```
Add a Playwright visual regression test for the following scenario.

Tool or feature: <name>
Fixture data file: <path to GeoJSON fixture, or describe data to create>
Expected visual outcome: <describe what should be visible on the canvas>

Steps:
1. Read .agent/skills/visual-regression.md.
2. Add a new test in app/front-end/e2e/<tool-name>.spec.ts.
3. Use the Redux store injection pattern from e2e/animation.spec.ts.
4. Wait for canvas → networkidle → 500ms settle before screenshot.
5. Scope the screenshot to the canvas element only.
6. Use maxDiffPixelRatio: 0.02 and threshold: 0.1.
7. Run `npm run e2e:update` to capture the baseline.
8. Visually confirm the PNG before committing.

Do NOT use --update-snapshots in the CI script.
```

### Debugging broken picking or tooltips

```
The picking or tooltip is broken for the <tool-name> layer.

Symptoms: <describe: no tooltip / wrong data / wrong position / etc.>

Debugging steps:
1. Check that pickable: true is set on the correct layer in layer-factory.ts
   or visualization-templates/.
2. Check the getTooltip function in deck-map-view.tsx.
3. Verify the PickingInfo.object shape matches what getTooltip expects —
   add a console.log(info.object) to confirm.
4. Check that the layer's data has the expected property keys.
5. In Playwright: await page.mouse.move(x, y);
   then assert page.locator('[data-testid="map-tooltip"]') has the correct text.
6. In browser console: deck.pickObject({ x, y, radius: 10 })
   to isolate the picking engine from the UI.

Do not change the data schema to fix the tooltip — fix the accessor instead.
Report the root cause before making any change.
```

---

## 7. CI / Commands

### `app/front-end/package.json` — add these scripts

```json
{
  "scripts": {
    "dev":           "vite",
    "build":         "tsc -b && vite build",
    "typecheck":     "tsc --noEmit",
    "lint":          "eslint .",
    "test":          "vitest run",
    "test:watch":    "vitest",
    "test:coverage": "vitest run --coverage",
    "e2e":           "playwright test",
    "e2e:update":    "playwright test --update-snapshots",
    "e2e:ui":        "playwright test --ui",
    "preview":       "vite preview"
  }
}
```

`typecheck` runs `tsc --noEmit` independently of the build — this is the signal for CI to fail on type errors without a full production build, making error messages faster and clearer.

### GitHub Actions CI pipeline

```yaml
# .github/workflows/ci.yml (additions / recommended shape)

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: app/front-end
      - name: typecheck
        run: npm run typecheck
        working-directory: app/front-end
      - name: lint
        run: npm run lint
        working-directory: app/front-end
      - name: unit tests
        run: npm run test
        working-directory: app/front-end
      - name: build
        run: npm run build
        working-directory: app/front-end
      - name: e2e tests
        run: npm run e2e          # NO --update-snapshots here
        working-directory: app/front-end
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: app/front-end/playwright-report/

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install uv && uv sync
        working-directory: app/back-end
      - name: lint
        run: uv run ruff check .
        working-directory: app/back-end
      - name: unit tests
        run: uv run pytest tests/ -v
        working-directory: app/back-end

  contract-check:
    # Validates that frontend and backend tool registries are in sync
    runs-on: ubuntu-latest
    needs: [frontend, backend]
    steps:
      - uses: actions/checkout@v4
      - run: python scripts/check-tool-contract.py
```

### Playwright WebGL note

The existing `playwright.config.ts` uses `--disable-gpu` + `--disable-software-rasterizer` for CI stability. This prevents actual WebGL rendering, so **visual baselines must be captured locally (on a machine with a GPU)** and committed to git before CI runs the comparison.

Two valid approaches:

| Approach | Pros | Cons |
|---|---|---|
| **Capture locally, compare in CI** (recommended) | Simple; no Xvfb setup | Developer must remember to update baselines when visuals change |
| **Software WebGL in CI with Xvfb** | Baselines can be updated in CI PRs | Requires `xvfb-run`, slower, platform-specific rendering |

For the software WebGL approach, replace the launch args with:
```ts
launchOptions: { args: ['--use-angle=angle'] }
```
and add `xvfb-run -a npx playwright test` to the CI step.

---

## 8. Guardrails

### Hard stops — agent must not proceed without human review

| Rule | Reason |
|---|---|
| Do not modify `node_modules/@deck.gl/` or `node_modules/luma.gl/` | This app is a consumer of deck.gl, not a fork. Modifications are lost on `npm install`. |
| Do not change data schemas (field names, types) silently | Breaks the normalizer → layer pipeline; requires updating both CLAUDE.md files and the TypeScript interface simultaneously |
| Do not run `--update-snapshots` in CI | Baselines must be visually verified by a human before commit |
| Do not remove tests or `expect()` assertions to make CI pass | |
| Do not introduce `fetch()` or `axios` calls outside `src/services/backend-api-service.ts` | All network calls must be centralized; new endpoints must be documented in the API contract |
| Do not commit `.env` files, API keys, or map tile access tokens | |
| Do not force-push to `main` | |

### Soft rules — agent should warn and ask before proceeding

| Rule | When triggered |
|---|---|
| Large data transform inside React component body | Any `.map()`, `.filter()`, `.sort()` inside a component function body when data > 1k rows |
| Function accessor without matching `updateTriggers` | Accessor is a function literal but no `updateTriggers` key covers it |
| `pickable: true` on more than 3 layers simultaneously | Picking buffer is rendered once per pickable layer |
| New layer type added without a unit test | `layer-factory.ts` updated but no corresponding Vitest test for the new type |
| Visual baseline missing for a new layer | New layer appears in factory output but no PNG exists in `e2e/snapshots/` |
| `deck-map-view.tsx` is modified | Map component changes are high-risk and should be reviewed carefully |

---

## 9. Final Recommendation

### For this repo, starting today

**Week 1 — Infrastructure (approximately one day):**

1. Create `.agent/skills/` with the five skill files from this document.
2. Add `typecheck`, `e2e`, and `e2e:update` scripts to `app/front-end/package.json`.
3. Add `data-testid="map-tooltip"` to the tooltip container component so E2E tests can assert tooltip content without relying on CSS selectors.
4. Create `app/front-end/e2e/snapshots/` and capture initial visual baselines locally: `npm run e2e:update`, then commit the PNGs.
5. Update `.github/workflows/ci.yml` to run `typecheck` and `e2e` (without `--update-snapshots`).

**Always — the layer development loop:**

Every new or modified layer follows this sequence without exception:
```
unit test → visual baseline (local) → E2E picking test → performance checklist → PR
```

**The single highest-value addition:**

Ensure `src/services/layer-factory.ts` is the **sole place** that constructs deck.gl layer instances, and that it is fully covered by unit tests. When this invariant holds, layer bugs are localized, the agent knows exactly where to make changes, and performance regressions are easy to catch.

**Agent workflow in practice:**

Claude Code reads the relevant CLAUDE.md and the matching skill file before touching any layer code. The skill files carry the context that is too long for CLAUDE.md — they encode the rules specific to deck.gl application development so the agent does not need to rediscover them each session.

---

## Sources

| Topic | Source |
|---|---|
| deck.gl performance | https://deck.gl/docs/developer-guide/performance |
| deck.gl interactivity and picking | https://deck.gl/docs/developer-guide/interactivity |
| deck.gl StatsWidget | https://deck.gl/docs/api-reference/widgets/stats-widget |
| deck.gl getting started | https://deck.gl/docs/get-started/getting-started |
| Playwright snapshot testing | https://playwright.dev/docs/test-snapshots |
| Playwright test configuration | https://playwright.dev/docs/test-configuration |
| GitHub Copilot custom instructions | https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot |
| OpenHands skill format | https://docs.openhands.dev/sdk/guides/skill |
| Cursor rules format | https://cursor.com/docs/context/rules |
| luma.gl profiling | https://luma.gl/docs/developer-guide/profiling/ |
