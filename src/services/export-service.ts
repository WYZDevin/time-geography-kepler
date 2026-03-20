/**
 * Export Service
 * Handles exporting map visualizations and data
 */

import { FeatureCollection } from '../interfaces/data-interfaces';
import type { LayerConfig } from './visualization-service-enhanced';

/**
 * Export current view as GeoJSON
 */
export const exportViewAsGeoJSON = (
  data: FeatureCollection,
  filename?: string
): void => {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `map-export-${new Date().toISOString().slice(0, 10)}.geojson`;
  a.click();

  URL.revokeObjectURL(url);
};

/**
 * Export layer configuration
 */
export const exportLayerConfig = (
  layers: LayerConfig[],
  filename?: string
): void => {
  const config = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    layers: layers.map((layer) => ({
      id: layer.id,
      type: layer.type,
      config: layer.config,
      visualChannels: layer.visualChannels,
    })),
  };

  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `layer-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();

  URL.revokeObjectURL(url);
};

/**
 * Export map as image (requires canvas element)
 * Note: This is a simplified version. Full implementation would require
 * capturing the Kepler.gl canvas directly, which may require additional
 * Kepler.gl API calls
 */
export const exportMapAsImage = async (
  canvasElement?: HTMLCanvasElement,
  filename?: string,
  format: 'png' | 'jpeg' = 'png'
): Promise<void> => {
  // Try to find Kepler.gl canvas if not provided
  const canvas = canvasElement || document.querySelector('canvas.mapboxgl-canvas') as HTMLCanvasElement;

  if (!canvas) {
    throw new Error('Canvas element not found. Make sure the map is rendered.');
  }

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create image blob'));
          return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `map-${new Date().toISOString().slice(0, 10)}.${format}`;
        a.click();

        URL.revokeObjectURL(url);
        resolve();
      }, `image/${format}`);
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Create shareable URL with view state
 * Note: This would require URL parameter handling
 */
export const createShareableURL = (
  viewState: {
    latitude: number;
    longitude: number;
    zoom: number;
    bearing?: number;
    pitch?: number;
  },
  layerIds?: string[]
): string => {
  const params = new URLSearchParams();
  params.set('lat', viewState.latitude.toFixed(6));
  params.set('lng', viewState.longitude.toFixed(6));
  params.set('zoom', viewState.zoom.toFixed(2));

  if (viewState.bearing !== undefined) {
    params.set('bearing', viewState.bearing.toFixed(2));
  }

  if (viewState.pitch !== undefined) {
    params.set('pitch', viewState.pitch.toFixed(2));
  }

  if (layerIds && layerIds.length > 0) {
    params.set('layers', layerIds.join(','));
  }

  const baseURL = window.location.origin + window.location.pathname;
  return `${baseURL}?${params.toString()}`;
};

/**
 * Parse shareable URL to get view state
 */
export const parseShareableURL = (): {
  latitude?: number;
  longitude?: number;
  zoom?: number;
  bearing?: number;
  pitch?: number;
  layerIds?: string[];
} | null => {
  const params = new URLSearchParams(window.location.search);

  const lat = params.get('lat');
  const lng = params.get('lng');
  const zoom = params.get('zoom');

  if (!lat || !lng || !zoom) {
    return null;
  }

  const viewState: any = {
    latitude: parseFloat(lat),
    longitude: parseFloat(lng),
    zoom: parseFloat(zoom),
  };

  const bearing = params.get('bearing');
  if (bearing) {
    viewState.bearing = parseFloat(bearing);
  }

  const pitch = params.get('pitch');
  if (pitch) {
    viewState.pitch = parseFloat(pitch);
  }

  const layers = params.get('layers');
  if (layers) {
    viewState.layerIds = layers.split(',');
  }

  return viewState;
};

/**
 * Export multiple datasets as a single GeoJSON FeatureCollection
 */
export const exportMultipleDatasetsAsGeoJSON = (
  datasets: FeatureCollection[],
  filename?: string
): void => {
  // Merge all features into one collection
  const mergedFeatures = datasets.flatMap((dataset) => dataset.features);

  const mergedCollection: FeatureCollection = {
    type: 'FeatureCollection',
    features: mergedFeatures,
  };

  exportViewAsGeoJSON(mergedCollection, filename);
};

/**
 * Export data as CSV (simplified - works best with point data)
 */
export const exportAsCSV = (
  data: FeatureCollection,
  filename?: string
): void => {
  if (data.features.length === 0) {
    throw new Error('No features to export');
  }

  // Get all unique property keys
  const allKeys = new Set<string>();
  data.features.forEach((feature) => {
    Object.keys(feature.properties || {}).forEach((key) => allKeys.add(key));
  });

  // Add coordinate columns
  const headers = ['longitude', 'latitude', 'altitude', ...Array.from(allKeys)];

  // Build CSV rows
  const rows = [headers.join(',')];

  data.features.forEach((feature) => {
    if (feature.geometry.type === 'Point') {
      const coords = feature.geometry.coordinates;
      const row = [
        coords[0], // longitude
        coords[1], // latitude
        coords[2] || '', // altitude (optional)
        ...Array.from(allKeys).map((key) => {
          const value = feature.properties?.[key];
          // Escape commas and quotes
          if (value === undefined || value === null) return '';
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        }),
      ];
      rows.push(row.join(','));
    }
  });

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `data-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();

  URL.revokeObjectURL(url);
};
