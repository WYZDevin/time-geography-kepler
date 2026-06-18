import { describe, it, expect } from 'vitest';
import { tf_stkde, estimateAutoCellSizeMeters, METERS_PER_DEGREE_LAT } from './stkde';

function makeData(n: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (let i = 0; i < n; i++) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [-72.25 + 0.1 * Math.sin(i * 1.7) , 41.8 + 0.05 * Math.cos(i * 2.3)],
      },
      properties: { timestamp: new Date(1700000000000 + i * 60000).toISOString() },
    });
  }
  return { type: 'FeatureCollection', features };
}

describe('estimateAutoCellSizeMeters', () => {
  it('matches the auto cell size tf_stkde actually uses', async () => {
    const data = makeData(60);
    const estimated = estimateAutoCellSizeMeters(data);
    expect(estimated).not.toBeNull();
    const result = await tf_stkde(data, 'timestamp', undefined, undefined, undefined, 3);
    const actualMeters = result.cell_size * METERS_PER_DEGREE_LAT;
    // float32 tensor math vs float64 JS — allow a small relative tolerance
    expect(Math.abs((estimated! - actualMeters) / actualMeters)).toBeLessThan(0.01);
  });

  it('a user-entered value in meters is honored as N-S degrees', async () => {
    const data = makeData(60);
    const meters = 500;
    const result = await tf_stkde(data, 'timestamp', undefined, undefined, meters / METERS_PER_DEGREE_LAT, 3);
    expect(result.cell_size * METERS_PER_DEGREE_LAT).toBeCloseTo(meters, 3);
  });

  it('honors an explicit cell size finer than the auto-detected 50x50 grid', { timeout: 60_000 }, async () => {
    const data = makeData(80);
    const meters = 250; // auto picks ~417m for this extent; 250m used to be clamped back to it
    const result = await tf_stkde(data, 'timestamp', undefined, undefined, meters / METERS_PER_DEGREE_LAT, 3);
    expect(result.cell_size * METERS_PER_DEGREE_LAT).toBeCloseTo(meters, 1);
    expect(result.x_centers.length * result.y_centers.length).toBeGreaterThan(2500);
  });

  it('point-batched fine grid conserves density mass vs the single-batch auto grid', { timeout: 120_000 }, async () => {
    const data = makeData(80);
    const auto = await tf_stkde(data, 'timestamp', undefined, undefined, undefined, 2);
    // A 100m grid here is >40k cells, forcing multiple point batches per slice.
    const fine = await tf_stkde(data, 'timestamp', undefined, undefined, 100 / METERS_PER_DEGREE_LAT, 2);
    const mass = (r: { density: number[][][] | number[][]; cell_size: number }, slice: number) => {
      const grid = (r.density as number[][][])[slice];
      let s = 0;
      for (const row of grid) for (const v of row) s += v;
      return s * r.cell_size * r.cell_size;
    };
    for (const slice of [0, 1]) {
      const a = mass(auto, slice);
      const f = mass(fine, slice);
      expect(a).toBeGreaterThan(0);
      expect(Math.abs(f - a) / a).toBeLessThan(0.05);
    }
  });
});
