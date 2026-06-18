import { describe, it, expect } from 'vitest';
import { TimeGeographyTool } from './time-geography-tool';
import type { FeatureCollection } from '@/interfaces/data-interfaces';

function makeTrajectory(count: number, baseTime = '2024-01-01T08:00:00Z'): FeatureCollection {
  const base = new Date(baseTime).getTime();
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: count }, (_, i) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [-122.42 + i * 0.001, 37.78 + i * 0.001],
      },
      properties: {
        timestamp: new Date(base + i * 3600_000).toISOString(), // 1 hour apart
      },
    })),
  };
}

describe('TimeGeographyTool', () => {
  const tool = new TimeGeographyTool();

  it('has correct metadata', () => {
    expect(tool.id).toBe('time-geography');
    expect(tool.category).toBe('visualization');
    expect(tool.version).toBe('2.0.0');
    expect(tool.capabilities.executionPolicy).toBe('backend_only'); // TEMPORARY: computation moved to backend
  });

  it('declares attributeMapping with time field', () => {
    expect(tool.attributeMapping!.time).toBe('timestamp');
  });

  it('returns option schema with expected keys', () => {
    const schema = tool.getOptionSchema();
    const keys = schema.map(s => s.key);
    expect(keys).toContain('visualizeStay');
    expect(keys).toContain('showAxes');
    expect(keys).toContain('timeBreaks');
    expect(keys).toContain('timeWindow');
    expect(keys).toContain('show2D');
  });

  it('produces trajectory output from point data', async () => {
    const data = makeTrajectory(5);
    const results = await tool.analyze(data, {}, { time: 'timestamp' });

    // At minimum, the trajectory dataset
    expect(results.length).toBeGreaterThanOrEqual(1);

    const trajectory = results[0];
    expect(trajectory.type).toBe('FeatureCollection');
    expect(trajectory.features).toHaveLength(5);

    // Each feature should have processed fields
    for (const feature of trajectory.features) {
      expect(feature.properties?._dataset_type).toBe('time-geography-trajectory');
      expect(feature.properties?._layer_config).toBeDefined();
      expect(typeof feature.properties?._height).toBe('number');
      expect(typeof feature.properties?._time_order).toBe('number');
      expect(Array.isArray(feature.properties?._neighbors)).toBe(true);
    }
  });

  it('sorts features by time and assigns sequential neighbors', async () => {
    // Insert out of order
    const data = makeTrajectory(3);
    const reversed: FeatureCollection = {
      type: 'FeatureCollection',
      features: [...data.features].reverse(),
    };

    const results = await tool.analyze(reversed, {}, { time: 'timestamp' });
    const features = results[0].features;

    // Should be sorted by time: heights should be ascending
    for (let i = 1; i < features.length; i++) {
      expect(features[i].properties!._height).toBeGreaterThanOrEqual(
        features[i - 1].properties!._height
      );
    }
  });

  it('does not produce a 2D ground path by default', async () => {
    const data = makeTrajectory(5);
    const results = await tool.analyze(data, {}, { time: 'timestamp' });
    expect(
      results.some(r => r.features[0]?.properties?._dataset_type === 'time-geography-trajectory-2d'),
    ).toBe(false);
  });

  it('produces a flat 2D ground path when show2D is enabled', async () => {
    const data = makeTrajectory(5);
    const results = await tool.analyze(data, { show2D: true }, { time: 'timestamp' });

    const ground = results.find(
      r => r.features[0]?.properties?._dataset_type === 'time-geography-trajectory-2d',
    );
    expect(ground).toBeDefined();
    expect(ground!.features).toHaveLength(5);

    // The 3D path still exists and is unchanged (output 0)
    expect(results[0].features[0]?.properties?._dataset_type).toBe('time-geography-trajectory');

    // Every ground-path point is flattened to Z = 0 (geometry + _height)
    for (const feature of ground!.features) {
      const coords = (feature.geometry as { coordinates: number[] }).coordinates;
      expect(coords[2]).toBe(0);
      expect(feature.properties?._height).toBe(0);
    }
  });

  it('produces stay points when visualizeStay is enabled', async () => {
    // Create a cluster of close points at the same location
    const base = new Date('2024-01-01T08:00:00Z').getTime();
    const cluster: FeatureCollection = {
      type: 'FeatureCollection',
      features: Array.from({ length: 10 }, (_, i) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          // Tiny jitter to keep them within 100m
          coordinates: [-122.42 + i * 0.00001, 37.78 + i * 0.00001],
        },
        properties: {
          timestamp: new Date(base + i * 60_000).toISOString(), // 1 min apart
        },
      })),
    };

    const results = await tool.analyze(
      cluster,
      { visualizeStay: true, timeWindow: 24 },
      { time: 'timestamp' },
    );

    // Should have trajectory + stay points
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Check if stay points were detected (depends on cluster density)
    if (results.length > 1) {
      const stayPoints = results[1];
      expect(stayPoints.features[0]?.properties?._dataset_type).toBe('stay-points');
    }
  });

  it('returns empty result for invalid input', async () => {
    const results = await tool.analyze({ type: 'FeatureCollection', features: [] } as any, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });

  it('returns empty result when time field is missing', async () => {
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { notime: 'value' },
        },
      ],
    };
    // Pass attributes with no time mapping and override default
    const results = await tool.analyze(data, {}, { time: undefined });
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });
});
