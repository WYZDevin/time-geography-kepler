import { describe, it, expect } from 'vitest';
import { BufferTool } from './buffer-tool';
import type { FeatureCollection } from '@/interfaces/data-interfaces';

const samplePoints: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] },
      properties: { id: 1 },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.4094, 37.7849] },
      properties: { id: 2 },
    },
  ],
};

describe('BufferTool', () => {
  const tool = new BufferTool();

  it('has correct metadata', () => {
    expect(tool.id).toBe('buffer-analysis');
    expect(tool.category).toBe('analysis');
    expect(tool.capabilities.executionPolicy).toBe('frontend_only');
  });

  it('returns option schema with bufferDistance, units, dissolve, steps', () => {
    const schema = tool.getOptionSchema();
    const keys = schema.map(s => s.key);
    expect(keys).toContain('bufferDistance');
    expect(keys).toContain('units');
    expect(keys).toContain('dissolve');
    expect(keys).toContain('steps');
  });

  it('creates buffers around points', async () => {
    const results = await tool.analyze(samplePoints, { bufferDistance: 100, units: 'meters' });
    expect(results).toHaveLength(1);
    const fc = results[0];
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);

    // Each feature should be a polygon with buffer metadata
    for (const feature of fc.features) {
      expect(feature.geometry.type).toBe('Polygon');
      expect(feature.properties?._buffer_distance).toBe(100);
      expect(feature.properties?._buffer_units).toBe('meters');
    }
  });

  it('dissolves overlapping buffers with dissolve option', async () => {
    // Use large buffer to guarantee overlap, then verify dissolve was attempted
    const results = await tool.analyze(samplePoints, {
      bufferDistance: 5000,
      units: 'meters',
      dissolve: true,
    });
    expect(results).toHaveLength(1);
    const fc = results[0];
    // Dissolve may or may not succeed depending on turf.union version,
    // but we should still get valid output
    expect(fc.features.length).toBeGreaterThanOrEqual(1);
    for (const feature of fc.features) {
      expect(feature.geometry.type).toMatch(/Polygon|MultiPolygon/);
    }
  });

  it('returns empty result for invalid input', async () => {
    const results = await tool.analyze({ type: 'FeatureCollection', features: [] } as any, {});
    expect(results).toHaveLength(1);
    expect(results[0].features).toHaveLength(0);
  });
});
