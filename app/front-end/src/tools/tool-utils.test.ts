import { describe, it, expect } from 'vitest';
import { ToolUtils, ProgressReporter } from './tool-utils';

describe('ToolUtils', () => {
  describe('isValidGeoJSON', () => {
    it('returns true for valid FeatureCollection with features', () => {
      const data = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }],
      };
      expect(ToolUtils.isValidGeoJSON(data)).toBe(true);
    });

    it('returns false for empty features array', () => {
      expect(ToolUtils.isValidGeoJSON({ type: 'FeatureCollection', features: [] })).toBe(false);
    });

    it('returns falsy for null/undefined', () => {
      expect(ToolUtils.isValidGeoJSON(null)).toBeFalsy();
      expect(ToolUtils.isValidGeoJSON(undefined)).toBeFalsy();
    });

    it('returns false for wrong type', () => {
      expect(ToolUtils.isValidGeoJSON({ type: 'Feature', features: [] })).toBe(false);
    });
  });

  describe('emptyResult', () => {
    it('returns an empty FeatureCollection', () => {
      const result = ToolUtils.emptyResult();
      expect(result.type).toBe('FeatureCollection');
      expect(result.features).toEqual([]);
    });
  });

  describe('generateId', () => {
    it('starts with the given prefix', () => {
      const id = ToolUtils.generateId('test');
      expect(id).toMatch(/^test-\d+-[a-f0-9]{8}$/);
    });
  });

  describe('getCoordinates', () => {
    it('returns coordinates for a Point feature', () => {
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
        properties: {},
      };
      expect(ToolUtils.getCoordinates(feature)).toEqual([-122.4, 37.8]);
    });

    it('returns null for non-Point geometry', () => {
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: {},
      };
      expect(ToolUtils.getCoordinates(feature)).toBeNull();
    });
  });

  describe('getBounds', () => {
    it('returns bounds for Point features', () => {
      const features: GeoJSON.Feature[] = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.4, 37.7] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.3, 37.8] }, properties: {} },
      ];
      const bounds = ToolUtils.getBounds(features);
      expect(bounds).toEqual({ minLng: -122.4, maxLng: -122.3, minLat: 37.7, maxLat: 37.8 });
    });

    it('returns null for empty array', () => {
      expect(ToolUtils.getBounds([])).toBeNull();
    });
  });

  describe('calculateOptimalZAxisHeight', () => {
    it('returns at least 1000', () => {
      const height = ToolUtils.calculateOptimalZAxisHeight(0, 0, 0, 0);
      expect(height).toBeGreaterThanOrEqual(1000);
    });

    it('scales with spatial extent', () => {
      const small = ToolUtils.calculateOptimalZAxisHeight(-1, 1, -1, 1);
      const large = ToolUtils.calculateOptimalZAxisHeight(-10, 10, -10, 10);
      expect(large).toBeGreaterThan(small);
    });
  });
});

describe('ProgressReporter', () => {
  it('calls callback with clamped values', () => {
    const calls: [number, string | undefined][] = [];
    const reporter = new ProgressReporter((p, m) => calls.push([p, m]));

    reporter.report(50, 'half');
    reporter.report(150, 'over');
    reporter.report(-10, 'under');

    expect(calls).toEqual([
      [50, 'half'],
      [100, 'over'],
      [0, 'under'],
    ]);
  });

  it('does nothing without callback', () => {
    const reporter = new ProgressReporter();
    expect(() => reporter.report(50)).not.toThrow();
  });
});
