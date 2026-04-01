import { describe, it, expect, vi } from 'vitest';
import { STKDETool } from './stkde-tool';
import type { FeatureCollection } from '@/interfaces/data-interfaces';

// Mock the heavy STKDE computation
vi.mock('@/data-processors/stkde', () => ({
  STKDE_Z_AXIS_FIELD: '_stkde_z_start',
  createSTKDE: vi.fn().mockResolvedValue({
    features: [
      // 3 confidence levels: 90%, 95%, 99%
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            },
            properties: { density: 0.5, _height: 100, _stkde_z_start: 50 },
          },
        ],
      },
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            },
            properties: { density: 0.8, _height: 200, _stkde_z_start: 100 },
          },
        ],
      },
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            },
            properties: { density: 0.95, _height: 300, _stkde_z_start: 200 },
          },
        ],
      },
    ],
  }),
}));

function makePointsWithTime(count: number): FeatureCollection {
  const base = new Date('2024-01-01T08:00:00Z').getTime();
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: count }, (_, i) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [-122.42 + i * 0.01, 37.78 + i * 0.01],
      },
      properties: {
        timestamp: new Date(base + i * 3600_000).toISOString(),
      },
    })),
  };
}

describe('STKDETool', () => {
  const tool = new STKDETool();

  it('has correct metadata', () => {
    expect(tool.id).toBe('stkde');
    expect(tool.category).toBe('analysis');
    expect(tool.capabilities.executionPolicy).toBe('frontend_only');
  });

  it('declares attributeMapping with time field', () => {
    expect(tool.attributeMapping!.time).toBe('timestamp');
  });

  it('returns option schema with showAxes and timeBreaks', () => {
    const schema = tool.getOptionSchema();
    const keys = schema.map(s => s.key);
    expect(keys).toContain('showAxes');
    expect(keys).toContain('timeBreaks');
  });

  it('produces 3 confidence-level outputs', async () => {
    const data = makePointsWithTime(10);
    const results = await tool.analyze(data, {}, { time: 'timestamp' });

    expect(results).toHaveLength(3);

    // Each level should have enriched properties
    results.forEach((fc, index) => {
      expect(fc.features.length).toBeGreaterThan(0);
      const feature = fc.features[0];
      expect(feature.properties?._dataset_type).toBe(`stkde-density-${index + 1}`);
      expect(feature.properties?._confidence).toBeDefined();
      expect(feature.properties?._layer_config).toBeDefined();
      expect(typeof feature.properties?._geojson).toBe('string');
    });

    // Confidence levels: 90, 95, 99
    expect(results[0].features[0].properties?._confidence).toBe(90);
    expect(results[1].features[0].properties?._confidence).toBe(95);
    expect(results[2].features[0].properties?._confidence).toBe(99);
  });

  it('returns empty result for non-Point geometries', async () => {
    const polygons: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          },
          properties: { timestamp: '2024-01-01T00:00:00Z' },
        },
      ],
    };
    const results = await tool.analyze(polygons, {}, { time: 'timestamp' });
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });

  it('returns empty result for invalid input', async () => {
    const results = await tool.analyze({ type: 'FeatureCollection', features: [] } as any, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });

  it('returns empty result when features lack valid time data', async () => {
    const noTime: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { timestamp: 'not-a-date' },
        },
      ],
    };
    const results = await tool.analyze(noTime, {}, { time: 'timestamp' });
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });
});
