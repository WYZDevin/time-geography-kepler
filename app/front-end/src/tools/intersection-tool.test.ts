import { describe, it, expect } from 'vitest';
import { IntersectionTool } from './intersection-tool';
import type { FeatureCollection } from '@/interfaces/data-interfaces';

// Two overlapping squares
const overlappingPolygons: FeatureCollection = {
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

// Two non-overlapping squares
const disjointPolygons: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
      properties: { name: 'A' },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
      },
      properties: { name: 'B' },
    },
  ],
};

describe('IntersectionTool', () => {
  const tool = new IntersectionTool();

  it('has correct metadata', () => {
    expect(tool.id).toBe('intersection-analysis');
    expect(tool.category).toBe('analysis');
    expect(tool.capabilities.executionPolicy).toBe('frontend_only');
  });

  it('returns option schema with preserveProperties', () => {
    const schema = tool.getOptionSchema();
    const keys = schema.map(s => s.key);
    expect(keys).toContain('preserveProperties');
  });

  it('finds intersection between overlapping polygons', async () => {
    const results = await tool.analyze(overlappingPolygons, {});
    expect(results).toHaveLength(1);
    const fc = results[0];
    expect(fc.features.length).toBeGreaterThanOrEqual(1);

    const feature = fc.features[0];
    expect(feature.geometry.type).toMatch(/Polygon|MultiPolygon/);
    expect(feature.properties?._intersection_operation).toBe(true);
    expect(feature.properties?._feature_pair).toEqual([0, 1]);
  });

  it('preserves original properties by default', async () => {
    const results = await tool.analyze(overlappingPolygons, {});
    const feature = results[0].features[0];
    expect(feature.properties?.feature_a_props).toEqual({ name: 'A' });
    expect(feature.properties?.feature_b_props).toEqual({ name: 'B' });
  });

  it('omits original properties when preserveProperties is false', async () => {
    const results = await tool.analyze(overlappingPolygons, { preserveProperties: false });
    const feature = results[0].features[0];
    expect(feature.properties?.feature_a_props).toBeUndefined();
    expect(feature.properties?.feature_b_props).toBeUndefined();
  });

  it('returns empty result for disjoint polygons', async () => {
    const results = await tool.analyze(disjointPolygons, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });

  it('returns empty result when fewer than 2 polygons', async () => {
    const singlePolygon: FeatureCollection = {
      type: 'FeatureCollection',
      features: [overlappingPolygons.features[0]],
    };
    const results = await tool.analyze(singlePolygon, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });

  it('returns empty result for invalid input', async () => {
    const results = await tool.analyze({ type: 'FeatureCollection', features: [] } as any, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });

  it('ignores non-polygon features', async () => {
    const mixed: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {},
        },
        overlappingPolygons.features[0],
      ],
    };
    // Only 1 polygon => not enough for intersection
    const results = await tool.analyze(mixed, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });
});
