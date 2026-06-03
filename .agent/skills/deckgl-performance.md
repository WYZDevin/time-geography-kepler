---
name: deckgl-performance
description: Performance review checklist for deck.gl layers and data pipelines in this project
trigger: keywords
keywords: [performance, slow, lag, FPS, frame rate, large dataset, profiling, StatsWidget, binary, updateTriggers, buffer, GPU, memory, re-render]
version: 1.0
---

# deck.gl Performance Review

Reference: https://deck.gl/docs/developer-guide/performance
Target: 60 FPS with up to ~1M features on modern hardware.

## Checklist — run before every PR that adds or changes a layer

### Data stability
- [ ] The `data` prop passed to a layer is a stable reference across renders. No new array created inside a React component body or inside `createDeckLayers()` itself (the datasets come from Redux — that is fine).
- [ ] `cfg.segmentData`, `cfg.pathData` (pre-computed segment arrays stored in `config`) are computed once in the normalizer, not reconstructed on every render.
- [ ] For datasets > 50k rows: are features stored as typed arrays rather than GeoJSON objects?

### Accessors
- [ ] Constant accessor values use the literal form, not a function:
  ```ts
  // CORRECT
  getFillColor: [255, 106, 106, 200]
  // WRONG
  getFillColor: () => [255, 106, 106, 200]
  ```
- [ ] Every function accessor has a matching `updateTriggers` entry listing all of its external dependencies.
- [ ] `buildColorAccessor()` returns a constant when `cfg.colorField` is `null` or `undefined` (this is already implemented — verify it stays that way after changes).

### Layer array
- [ ] `pickable: true` is only set on layers where hover/click is expected. Check that `TextLayer` is always `pickable: false`.
- [ ] Layers that should be hidden use `isVisible: false` on the descriptor (handled by `if (!descriptor.isVisible) continue;` in `createDeckLayers()`), not conditional array filtering at the call site.
- [ ] The number of distinct `DeckLayerDescriptor` entries in the Redux store does not grow unboundedly when the user runs analysis multiple times. Old descriptors should be replaced, not appended.

### Animation filtering
- [ ] `passesTimeFilter()` is called in the build function, not in the layer accessor. Filtering in `buildLayer()` reduces the data array before deck.gl sees it, which is more efficient than per-feature accessor branching.
- [ ] When `anim.progress >= 1` (no animation), no filtering is applied — the fast path returns immediately.

### 3D layers (ColumnLayer, PolygonLayer with extrusion)
- [ ] `elevationScale` is used as a uniform multiplier (fast) rather than per-feature scaling through `getElevation` where possible.
- [ ] `wireframe` and `_full3d` are only enabled when explicitly requested by the user — they increase vertex count significantly.

## How to measure

### Development (browser)
Enable the deck.gl StatsWidget in dev mode:
```tsx
import { StatsWidget } from '@deck.gl/widgets';
// Add to DeckGL props in dev builds:
widgets={import.meta.env.DEV ? [new StatsWidget({})] : []}
```
StatsWidget displays live FPS and GPU time. Source: https://deck.gl/docs/api-reference/widgets/stats-widget

### Chrome DevTools
1. Open DevTools → Performance tab.
2. Record 5 seconds of interaction (pan, zoom, animation).
3. Look for: **long tasks > 50ms**, repeated buffer uploads in GPU activity, `createDeckLayers` taking > 5ms per frame.
4. The `about:tracing` view shows `CrGpuMain` GPU thread — useful for identifying shader compilation stalls.

### Quick size check
```ts
// In a Vitest benchmark — assert layer construction is fast for fixture data
import { bench } from 'vitest';
bench('createDeckLayers with 10k features', () => {
  createDeckLayers(descriptors, datasets);
});
```

## Known anti-patterns in this codebase to watch for

| Pattern | Where it could appear | Impact |
|---|---|---|
| `cfg.segmentData` computed inside `buildLineLayer()` | `layer-factory.ts` | Rebuilds all GPU buffers every render |
| New `[...color, 200]` spread inside an accessor function | Any `build*Layer()` function | Allocates a new array per feature per frame |
| `prismWireframeSegments` rebuilt without change when animation progress changes | `buildGeoJsonLayer()` | O(n²) geometry work on every animation tick |
| `visible: false` layers still included in the descriptors array | Redux map slice | Consumed memory even when hidden |

## Performance red flags — escalate to human review

- More than ~20 `DeckLayerDescriptor` entries in the store at once.
- Any `.map()`, `.filter()`, or `.sort()` inside a React component render function when `dataset.data.features.length > 1000`.
- A new accessor function that closes over a large object reference (e.g. an entire GeoJSON feature collection).
- `prismWireframe: true` enabled by default on a layer receiving > 500 polygon features.

## DO NOT

- Do not add `console.log` inside layer accessor functions — they run thousands of times per render.
- Do not store layer instances in Redux state — they are ephemeral WebGL objects and not serializable.
- Do not create a second `Deck` or `DeckGL` instance. The app has exactly one.
