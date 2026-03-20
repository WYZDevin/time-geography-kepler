import { FeatureCollection } from '@/interfaces/data-interfaces';
import { v4 as uuidv4 } from 'uuid';

/**
 * Common validation utilities for tools
 */
export const ToolUtils = {
  /**
   * Check if data is valid GeoJSON
   */
  isValidGeoJSON(data: any): data is FeatureCollection {
    return (
      data &&
      data.type === 'FeatureCollection' &&
      Array.isArray(data.features) &&
      data.features.length > 0
    );
  },

  /**
   * Create empty result for errors
   */
  emptyResult(): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: []
    };
  },

  /**
   * Generate unique ID for datasets
   */
  generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${uuidv4().slice(0, 8)}`;
  },

  /**
   * Safe property access
   */
  getProperty(feature: GeoJSON.Feature, path: string): any {
    if (!feature.properties) return undefined;
    return feature.properties[path];
  },

  /**
   * Get coordinates from geometry
   */
  getCoordinates(feature: GeoJSON.Feature): number[] | null {
    if (feature.geometry?.type === 'Point') {
      return feature.geometry.coordinates;
    }
    return null;
  },

  /**
   * Calculate bounds of features
   */
  getBounds(features: GeoJSON.Feature[]): {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null {
    if (features.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    features.forEach(feature => {
      const coords = this.getCoordinates(feature);
      if (coords) {
        const [lng, lat] = coords;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
    });

    return { minLat, maxLat, minLng, maxLng };
  },

  /**
   * Calculate the optimal Z-axis max altitude in meters based on horizontal bounding box extent.
   */
  calculateOptimalZAxisHeight(minLng: number, maxLng: number, minLat: number, maxLat: number): number {
    const spatialExtent = Math.max(
      (maxLng - minLng),
      (maxLat - minLat),
      Number.EPSILON
    );
    // 1 degree is roughly 111,000 meters. Z-axis scaled to 50% of the maximum horizontal spread.
    return Math.max(spatialExtent * 111000 * 0.5, 1000);
  }
};

/**
 * Progress reporter utility
 */
export class ProgressReporter {
  constructor(private callback?: (progress: number, message?: string) => void) { }

  report(progress: number, message?: string) {
    if (this.callback) {
      this.callback(Math.min(100, Math.max(0, progress)), message);
    }
  }
}