import { describe, it, expect } from 'vitest';
import { UnionTool } from './union-tool';
import type { FeatureCollection } from '@/interfaces/data-interfaces';

const twoPolygons: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      },
      properties: { name: 'A' },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]],
      },
      properties: { name: 'B' },
    },
  ],
};

describe('UnionTool', () => {
  const tool = new UnionTool();

  it('has correct metadata', () => {
    expect(tool.id).toBe('union-analysis');
    expect(tool.category).toBe('analysis');
    expect(tool.capabilities.executionPolicy).toBe('frontend_only');
  });

  it('returns option schema with preserveProperties', () => {
    const schema = tool.getOptionSchema();
    const keys = schema.map(s => s.key);
    expect(keys).toContain('preserveProperties');
  });

  it('unions overlapping polygons into a single feature', async () => {
    const results = await tool.analyze(twoPolygons, {});
    expect(results).toHaveLength(1);
    const fc = results[0];
    expect(fc.features).toHaveLength(1);

    const feature = fc.features[0];
    expect(feature.geometry.type).toMatch(/Polygon|MultiPolygon/);
    expect(feature.properties?._union_operation).toBe(true);
    expect(feature.properties?._original_feature_count).toBe(2);
  });

  it('returns single polygon as-is', async () => {
    const single: FeatureCollection = {
      type: 'FeatureCollection',
      features: [twoPolygons.features[0]],
    };
    const results = await tool.analyze(single, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(1);
  });

  it('returns empty result for no polygon features', async () => {
    const points: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {},
        },
      ],
    };
    const results = await tool.analyze(points, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });

  it('returns empty result for invalid input', async () => {
    const results = await tool.analyze({ type: 'FeatureCollection', features: [] } as any, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });
});
