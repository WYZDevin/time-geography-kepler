---
name: visual-regression
description: How to capture, manage, and update Playwright visual regression baselines for this project's deck.gl canvas
trigger: keywords
keywords: [screenshot, snapshot, visual regression, baseline, toHaveScreenshot, Playwright, canvas, e2e, animation.spec]
version: 1.0
---

# Visual Regression Testing

## Framework
Playwright `toHaveScreenshot()` — https://playwright.dev/docs/test-snapshots
Config: `app/front-end/playwright.config.ts`
Baseline directory: `app/front-end/e2e/snapshots/` (committed to git)
Existing E2E tests: `app/front-end/e2e/animation.spec.ts`

## WebGL rendering variance

deck.gl renders to a WebGL canvas. Pixel output varies by GPU, driver, and platform, so a permissive threshold is required:

```ts
await expect(canvas).toHaveScreenshot('my-layer.png', {
  maxDiffPixelRatio: 0.02,   // up to 2% of pixels may differ
  threshold: 0.1,            // per-pixel color distance tolerance
});
```

Always scope the screenshot to the canvas element, not the full page, to avoid false positives from UI changes unrelated to the map:

```ts
const canvas = page.locator('canvas').first();
await expect(canvas).toHaveScreenshot('my-layer.png', { maxDiffPixelRatio: 0.02 });
```

## Headless WebGL note

The current `playwright.config.ts` uses:
```ts
launchOptions: { args: ['--disable-gpu', '--disable-software-rasterizer'] }
```

This means **WebGL canvas rendering is not available in headless CI**. The canvas will be blank or black in GitHub Actions.

**Baseline capture must be done locally** (on a machine with a GPU), then the PNG is committed to git. CI runs compare against the committed file — but only for interaction and DOM tests, not canvas pixel equality.

For canvas pixel tests that must run in CI, consider switching to `--use-angle=angle` with `xvfb-run` on Linux. Document this clearly if you make the switch.

## Redux store injection pattern

All E2E tests in this project use the Redux store injection approach from `e2e/animation.spec.ts`. Replicate it exactly:

```ts
// 1. Navigate and wait for app to load
await page.goto('/');
await page.waitForSelector('canvas');

// 2. Inject fixture data via Redux dispatch
await page.evaluate((geojson) => {
  const store = (window as any).__REDUX_STORE__;
  if (!store) throw new Error('Redux store not exposed on window');
  store.dispatch({
    type: 'data/addDataSource',
    payload: {
      id: 'test-fixture',
      name: 'Test Fixture',
      data: geojson,
      createdAt: new Date().toISOString(),
      featureCount: geojson.features.length,
    },
  });
}, fixtureGeoJSON);

// 3. Select tool, set field mapping, run analysis — via additional dispatches
// (see animation.spec.ts for the full runAnalysis() helper)

// 4. Wait for render to settle before screenshot
await page.waitForLoadState('networkidle');
await page.waitForTimeout(500);  // WebGL needs one animation frame to finish
```

`window.__REDUX_STORE__` is exposed in dev mode by `src/main.tsx`. Confirm it is still exposed before relying on it; if it is missing, add back to `main.tsx` behind `import.meta.env.DEV`.

## Procedure for adding a new visual baseline

1. Implement the feature. Verify it looks correct in the browser (`npm run dev`).
2. Write the Playwright test spec, including the `waitForTimeout(500)` settle.
3. Run: `npm run e2e:update` (this calls `playwright test --update-snapshots`).
4. Open `e2e/snapshots/<test-name>-chromium.png` and visually confirm the canvas shows the expected layer.
5. Commit the PNG: `test: add visual baseline for <feature-name>`.
6. All subsequent `npm run e2e` runs in CI compare against this file.

## Procedure for updating an existing baseline

A baseline must be updated when a **deliberate visual change** is made (new color scheme, changed layer geometry, etc.) — not to silence a failing test.

1. Confirm the visual change was intentional.
2. Run `npm run e2e:update` locally.
3. Visually inspect the new PNG — diff it against the previous version.
4. Commit with a clear message: `test: update visual baseline for <feature> — changed color scheme to YlOrRd`.

## Flakiness reduction

```ts
// Disable CSS animations to prevent timing-based pixel differences
await page.addStyleTag({
  content: '* { animation-duration: 0s !important; transition-duration: 0s !important; }',
});

// Use a fixed viewport (already set in playwright.config.ts: 1280×900)
// Do not override viewport inside individual tests
```

`playwright.config.ts` already sets `retries: 1` — sufficient for most WebGL variance.

## Fixture files

Store fixture GeoJSON in `e2e/fixtures/`. The existing `sample-trajectory.geojson` is a reference. When adding a new tool test, add a minimal fixture that exercises the key geometry types for that tool (e.g. a polygon fixture for buffer zones, a point set for STKDE).

Keep fixtures small — enough to render a visible layer, not production-scale data. Large fixtures slow test startup.

## DO NOT

- Do not run `--update-snapshots` in CI. The `npm run e2e` script must not include that flag.
- Do not commit a baseline PNG without visually inspecting it first.
- Do not take a full-page screenshot for canvas comparisons — scope to `canvas` element.
- Do not remove a visual test because it is flaky — investigate the flakiness source (timing, threshold) and fix it.
- Do not add `waitForTimeout` values larger than 1000ms — if the layer takes longer than 1 second to render, there is likely a performance issue to fix first.
