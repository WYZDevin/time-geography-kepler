---
name: deckgl-layer-config
description: How to safely add and configure deck.gl layers at the application level in this project
trigger: keywords
keywords: [layer, ScatterplotLayer, PathLayer, PolygonLayer, GeoJsonLayer, ColumnLayer, LineLayer, TextLayer, visualization-templates, layer-factory, DeckLayerDescriptor, buildLayer, createDeckLayers]
version: 1.0
---

# deck.gl Layer Configuration

You are configuring deck.gl layers as a **consumer** of the API.
Do NOT modify `node_modules/@deck.gl/` or `node_modules/luma.gl/`.

## How layers work in this project

The pipeline has three stages:

```
DeckLayerDescriptor[]  (Redux map slice)
  → createDeckLayers()   (src/services/layer-factory.ts)
  → deck.gl Layer instances (ephemeral, never stored)
```

`DeckLayerDescriptor` is the canonical shape (see `src/interfaces/map-types.ts`):

```ts
interface DeckLayerDescriptor {
  id: string;
  type: 'geojson' | 'scatterplot' | 'path' | 'text' | 'column' | 'line';
  datasetId: string;
  label: string;
  isVisible: boolean;
  opacity: number;
  color: [number, number, number];
  config: Record<string, unknown>;
  visualChannels?: Record<string, unknown>;
}
```

## Where to make changes

| What | File |
|---|---|
| Add a new layer type | `src/services/layer-factory.ts` → add a case in `buildLayer()` |
| Change default layer config | `src/visualization-templates/<tool>.json` |
| Change how a config field maps to a layer prop | The relevant `build*Layer()` function in `layer-factory.ts` |
| Add a new `DeckLayerDescriptor` type variant | `src/interfaces/map-types.ts` → extend the `type` union |

**Never** construct layer instances anywhere else. `createDeckLayers()` is the single factory entry point.

## Layer ID convention

```
<tool-name>-<layer-role>-layer
```

Examples already in the codebase:
- `time-geography-trajectory-layer`
- `space-time-cube-column-layer`
- `stkde-heatmap-layer`

IDs must be **stable** across re-renders. Do not use random values or timestamps in IDs.

## The `config` bag

`desc.config` is a `Record<string, unknown>`. Access it with typed casts:

```ts
const extruded = cfg.extruded === true;
const heightField = cfg.heightField as string | undefined;
const radius = (cfg.radius as number) ?? 10;
```

Always provide a fallback — `config` values are optional by design.

## updateTriggers — mandatory rule

Every **function accessor** must have a matching `updateTriggers` entry. Failing to set this causes deck.gl to silently skip GPU buffer updates when the dependency changes.

```ts
// CORRECT
getFillColor: buildColorAccessor(desc),
updateTriggers: {
  getFillColor: [desc.color, cfg.colorField, cfg.colorRange],
}

// WRONG — getFillColor will not update when desc.color changes
getFillColor: buildColorAccessor(desc),
```

## Constant vs function accessors

Use a constant value when the same value applies to every feature — it is faster and skips the CPU loop entirely.

```ts
// FAST — uniform value, no per-feature CPU work
getFillColor: [255, 106, 106, 200]

// SLOW — forces CPU evaluation for every feature on every render
getFillColor: () => [255, 106, 106, 200]
```

Use a function only when the value differs per feature (e.g. colorField mapping, elevation from a property).

## Animation filtering

When a layer should animate by time, filter in the build function using `passesTimeFilter()`:

```ts
if (anim.progress < 1) {
  features = features.filter(
    f => passesTimeFilter(f.properties?.[PROCESSED_TIME_FIELD] ?? 0, anim),
  );
}
```

`PROCESSED_TIME_FIELD` is `'_time_order'` (see `src/utils/constants.ts`). Import it — do not hardcode the string.

## Picking defaults

Most layers in this project use:
```ts
pickable: true,
autoHighlight: true,
highlightColor: HIGHLIGHT_COLOR,   // [255, 255, 0, 128] — defined at top of layer-factory.ts
```

`TextLayer` is always `pickable: false` — text labels are visual only.

## Adding a new layer type — checklist

1. Add the new type string to the `type` union in `src/interfaces/map-types.ts`.
2. Add a `build<Type>Layer()` function in `layer-factory.ts`.
3. Add a `case '<type>':` branch in `buildLayer()`.
4. Add a template JSON to `src/visualization-templates/<tool>.json` if the layer has tool-specific defaults.
5. Write a Vitest unit test: given a mock `DeckLayerDescriptor`, assert that `createDeckLayers()` returns the correct layer class and key props.
6. Run the performance checklist (see `deckgl-performance.md`).

## DO NOT

- Do not construct `new ScatterplotLayer(...)` (or any layer class) outside `layer-factory.ts`.
- Do not store layer instances in Redux or React state.
- Do not call `createDeckLayers()` inside a React component body — it is called by `DeckMapView` which passes the result to `DeckGL.layers`.
- Do not put `visible: false` logic inside the factory; visibility is handled by `if (!descriptor.isVisible) continue;` at the top of `createDeckLayers()`.
- Do not modify deck.gl source code.
