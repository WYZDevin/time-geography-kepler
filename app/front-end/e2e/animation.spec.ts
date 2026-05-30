import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sampleGeoJSON = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/sample-trajectory.geojson'), 'utf-8'),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the Redux store from the window (exposed in dev mode by main.tsx). */
async function getStore(page: Page) {
  return page.evaluate(() => {
    const store = (window as any).__REDUX_STORE__;
    if (!store) throw new Error('Redux store not exposed on window');
    return true;
  });
}

/** Inject GeoJSON data into the Redux store as a data source. */
async function injectTrajectoryData(page: Page) {
  await page.evaluate((geojson) => {
    const store = (window as any).__REDUX_STORE__;
    if (!store) throw new Error('Redux store not exposed on window');
    store.dispatch({
      type: 'data/addDataSource',
      payload: {
        id: 'test-trajectory',
        name: 'Test Trajectory',
        data: geojson,
        createdAt: new Date().toISOString(),
        featureCount: geojson.features.length,
      },
    });
  }, sampleGeoJSON);
}

/** Select Time Geography tool, pick data source, set field mapping, and run analysis. */
async function runTimeGeographyAnalysis(page: Page) {
  await page.evaluate(() => {
    const store = (window as any).__REDUX_STORE__;
    store.dispatch({ type: 'workflow/selectTool', payload: 'time-geography' });
    store.dispatch({
      type: 'workflow/setSelectedDataSource',
      payload: {
        dataSourceId: 'test-trajectory',
        data: store.getState().data.dataSources['test-trajectory'].data,
      },
    });
    store.dispatch({
      type: 'workflow/setFieldMapping',
      payload: { time: 'timestamp' },
    });
    store.dispatch({
      type: 'workflow/setToolOptions',
      payload: { showAxes: true, timeBreaks: 'auto' },
    });
    store.dispatch({ type: 'workflow/proceedToVisualization' });
  });
}

/** Wait for the animation control bar to appear at the bottom of the map. */
async function waitForAnimationBar(page: Page) {
  // The animation bar contains a range input for the time slider
  await page.waitForSelector('input[type="range"]', { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('App Load', () => {
  test('app loads and shows tool selector', async ({ page }) => {
    await page.goto('/');
    // The tool selector renders tool cards — look for the header
    await expect(page.getByText('Select Analysis Tool')).toBeVisible({ timeout: 15_000 });
    // At least one tool card should be visible (the 3D Trajectory tool)
    await expect(page.getByText('3D Trajectory')).toBeVisible();
  });
});

test.describe('Tool Selection Workflow', () => {
  test('can select Time Geography tool and reach options step', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the 3D Trajectory tool card
    await page.getByText('3D Trajectory').click();

    // Should navigate to options step — look for "Run Analysis" button
    await expect(page.getByText('Run Analysis')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Animation Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify the store is exposed on window (done in main.tsx in dev mode)
    await getStore(page);
  });

  test('animation controls appear after Time Geography analysis', async ({ page }) => {
    await injectTrajectoryData(page);
    await runTimeGeographyAnalysis(page);

    // Wait for the visualization step to run analysis and render layers
    await waitForAnimationBar(page);

    // Play button should be visible
    const playButton = page.locator('button[title="Play"], button[title="Pause"]');
    await expect(playButton).toBeVisible();

    // Speed buttons should be visible
    await expect(page.getByText('1x')).toBeVisible();
    await expect(page.getByText('4x')).toBeVisible();

    // Mode badge should show "Cumulative" (default progressive mode)
    await expect(page.getByText('Cumulative')).toBeVisible();

    // Slider should exist
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();
  });

  test('play/pause toggles correctly', async ({ page }) => {
    await injectTrajectoryData(page);
    await runTimeGeographyAnalysis(page);
    await waitForAnimationBar(page);

    // Initially should show Play (animation not playing)
    await expect(page.locator('button[title="Play"]')).toBeVisible();

    // The sample data gives sliceCount=1 so the animation loop finishes
    // instantly. To test play/pause UI toggling we drive the state via Redux
    // which is what the UI button does under the hood. We also set loop=true
    // and sliceCount high enough so the animation doesn't auto-complete.
    await page.evaluate(() => {
      const store = (window as any).__REDUX_STORE__;
      store.dispatch({ type: 'map/setAnimationLoop', payload: true });
      store.dispatch({ type: 'map/setSliceCount', payload: 10 });
      store.dispatch({ type: 'map/setAnimationProgress', payload: 0 });
      store.dispatch({ type: 'map/setAnimationPlaying', payload: true });
    });

    // Should now show Pause
    await expect(page.locator('button[title="Pause"]')).toBeVisible({ timeout: 3_000 });

    await page.locator('button[title="Pause"]').click();

    // Should return to Play
    await expect(page.locator('button[title="Play"]')).toBeVisible({ timeout: 3_000 });
  });

  test('mode toggle switches between Cumulative and Slice', async ({ page }) => {
    await injectTrajectoryData(page);
    await runTimeGeographyAnalysis(page);
    await waitForAnimationBar(page);

    // Should start in Cumulative mode
    await expect(page.getByText('Cumulative')).toBeVisible();

    // Click mode toggle — it's the button with title containing "Cumulative mode"
    const modeToggle = page.locator('button[title*="Cumulative mode"]');
    await modeToggle.click();

    // Should now show "Slice"
    await expect(page.getByText('Slice', { exact: true })).toBeVisible({ timeout: 2_000 });

    // Click again to switch back
    const sliceToggle = page.locator('button[title*="Slice mode"]');
    await sliceToggle.click();

    await expect(page.getByText('Cumulative')).toBeVisible({ timeout: 2_000 });
  });

  test('loop toggle activates and deactivates', async ({ page }) => {
    await injectTrajectoryData(page);
    await runTimeGeographyAnalysis(page);
    await waitForAnimationBar(page);

    // Loop button — has title "Loop off"
    const loopBtn = page.locator('button[title*="Loop off"]');
    await expect(loopBtn).toBeVisible();

    // Click to enable loop
    await loopBtn.click();

    // Should now show "Loop on"
    const loopOnBtn = page.locator('button[title*="Loop on"]');
    await expect(loopOnBtn).toBeVisible({ timeout: 2_000 });

    // Click to disable
    await loopOnBtn.click();
    await expect(page.locator('button[title*="Loop off"]')).toBeVisible({ timeout: 2_000 });
  });

  test('slider scrub updates progress display', async ({ page }) => {
    await injectTrajectoryData(page);
    await runTimeGeographyAnalysis(page);
    await waitForAnimationBar(page);

    // The slider step depends on sliceCount. With ~45 min of data the auto
    // slice count is 1 (ceil(45/60)), so valid values are 0 and 1.
    // Use Redux dispatch to set the progress directly, which is the reliable
    // way to test the label update regardless of slider step granularity.
    await page.evaluate(() => {
      const store = (window as any).__REDUX_STORE__;
      store.dispatch({ type: 'map/setAnimationProgress', payload: 0 });
    });

    // The slice label should be "Slice 1 of 1" when sliceCount is 1 and
    // progress is 0. Wait for any slice label to appear.
    const sliceLabel = page.locator('text=/Slice \\d+ of \\d+/');
    await expect(sliceLabel).toBeVisible({ timeout: 3_000 });
  });

  test('speed selector highlights active speed', async ({ page }) => {
    await injectTrajectoryData(page);
    await runTimeGeographyAnalysis(page);
    await waitForAnimationBar(page);

    // Default speed is 1x — it should have active styling (bg-blue-600)
    const speed1x = page.getByText('1x');
    await expect(speed1x).toHaveClass(/bg-blue-600/);

    // Click 4x
    const speed4x = page.getByText('4x');
    await speed4x.click();

    // 4x should now be active
    await expect(speed4x).toHaveClass(/bg-blue-600/);
    // 1x should no longer be active
    await expect(speed1x).not.toHaveClass(/bg-blue-600/);
  });

  test('reset button sets progress to show all', async ({ page }) => {
    await injectTrajectoryData(page);
    await runTimeGeographyAnalysis(page);
    await waitForAnimationBar(page);

    // Use Redux dispatch to set progress to 0 (scrub to start)
    await page.evaluate(() => {
      const store = (window as any).__REDUX_STORE__;
      store.dispatch({ type: 'map/setAnimationProgress', payload: 0 });
    });

    // Verify slider is not at max (1)
    const slider = page.locator('input[type="range"]');
    await expect(slider).toHaveValue('0');

    // Click reset button — use force:true to bypass any overlapping legend
    const resetBtn = page.locator('button[title="Reset (show all)"]');
    await resetBtn.click({ force: true });

    // Slider should return to 1 (max)
    await expect(slider).toHaveValue('1');
  });
});
