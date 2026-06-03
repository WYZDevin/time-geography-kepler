---
name: deckgl-picking
description: How picking, hover, click, and tooltips work in this project
trigger: keywords
keywords: [picking, tooltip, hoverInfo, HoverInfo, onHover, onClick, pickable, autoHighlight, TOOLTIP_HIDDEN_KEYS, getTooltip, PickingInfo]
version: 1.0
---

# deck.gl Picking and Tooltips

## How picking is wired in this project

Picking is handled entirely in `src/components/deck-map-view.tsx`.

The `DeckGL` component receives:
```tsx
onHover={(info) => {
  if (info.object && info.x !== undefined && info.y !== undefined) {
    setHoverInfo({ x: info.x, y: info.y, properties: info.object.properties ?? {} });
  } else {
    setHoverInfo(null);
  }
}}
```

A custom `<HoverTooltip>` (or equivalent) renders from local `hoverInfo` state, positioned at `{x, y}`.

Internal/visual-only properties are filtered out using `TOOLTIP_HIDDEN_KEYS`:
```ts
const TOOLTIP_HIDDEN_KEYS = new Set([
  '_geojson', '_layer_config', '_dataset_type', '_original_index',
  '_sequence', '_time_progress', '_is_stay_point', '_stay_cluster',
]);
```

Properties in this set are never shown to the user.

## Layer-level picking config

Every layer that needs hover/click must have:
```ts
pickable: true,
autoHighlight: true,
highlightColor: HIGHLIGHT_COLOR,   // [255, 255, 0, 128]
```

`HIGHLIGHT_COLOR` is defined at the top of `layer-factory.ts`. Import it there.

`TextLayer` is always `pickable: false` — it is label-only.

## Adding a new tooltip field

1. Make sure the backend normalizer includes the field in `feature.properties` (see `deckgl-data-pipeline.md`).
2. Confirm the field name is NOT in `TOOLTIP_HIDDEN_KEYS`.
3. The tooltip renderer already iterates all properties, so no further change is needed for basic display.
4. If the field needs special formatting (e.g. a timestamp rendered as a date string), add a formatter entry in the tooltip render logic in `deck-map-view.tsx`.

## Hiding a field from the tooltip

Add its key to `TOOLTIP_HIDDEN_KEYS` in `deck-map-view.tsx`. Do not remove the property from the feature — it may be needed by layer accessors.

## Adding click behavior

`onClick` is also handled in `DeckGL`:
```tsx
onClick={(info) => {
  if (!info.object) return;
  // dispatch Redux action here
}}
```

For spatial tools that require user-selected anchor points (Space-Time Prism), the existing `pushAnchor` pattern in `deck-map-view.tsx` is the reference. Follow the same dispatch pattern.

## Testing picking

### In a unit test (no browser)
The `Deck` instance exposes `pickObject()`. Use it to assert that a specific pixel hits the correct feature:
```ts
const deck = new Deck({ ... });
const info = deck.pickObject({ x: 400, y: 300, radius: 5 });
expect(info?.object?.properties?.id).toBe('expected-id');
```

### In a Playwright E2E test
```ts
await page.mouse.move(640, 400);
// The tooltip container must have data-testid="map-tooltip"
await expect(page.locator('[data-testid="map-tooltip"]')).toContainText('Expected label');
```

Add `data-testid="map-tooltip"` to the tooltip container element in `deck-map-view.tsx` if it is not already present.

## Debugging broken picking

Work through this checklist in order:

1. **Is `pickable: true` set on the correct layer?**
   Check `build<Type>Layer()` in `layer-factory.ts`.

2. **Is `info.object` populated?**
   Add `console.log('pick:', info.object)` inside the `onHover` handler temporarily.

3. **Do `info.object.properties` keys match what the tooltip expects?**
   Log the properties object. Compare against `TOOLTIP_HIDDEN_KEYS` and the tooltip render logic.

4. **Is the feature coordinate system correct?**
   Deck.gl expects `[longitude, latitude]`. If backend returns `[lat, lng]`, it is swapped — fix it in the normalizer, not the layer.

5. **Is there another layer on top blocking the hit?**
   Picking returns the topmost pickable layer. Reorder the layers array if needed.

6. **Is `autoHighlight` causing confusion?**
   `autoHighlight` only highlights; it does not affect `info.object`. If highlight works but `onHover` does not fire, check the event handler binding.

## DO NOT

- Do not enable `pickable: true` on `TextLayer` — it is label-only and adds unnecessary picking overhead.
- Do not update React state inside `onHover` with heavy computation — keep the handler to a single `setHoverInfo()` call.
- Do not show raw internal fields (prefixed with `_`) in the tooltip. Add them to `TOOLTIP_HIDDEN_KEYS` instead.
- Do not hardcode `x: 640, y: 400` in Playwright tests — calculate from the canvas element bounds.
