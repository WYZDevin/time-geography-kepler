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
 * capturing the map canvas directly, which may require additional
 * deck.gl API calls
 */
export const exportMapAsImage = async (
  canvasElement?: HTMLCanvasElement,
  filename?: string,
  format: 'png' | 'jpeg' = 'png'
): Promise<void> => {
  // Try to find map canvas if not provided
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

// ---------------------------------------------------------------------------
// Analysis-grade GeoJSON export
//
// The datasets on the map are shaped for the 3D renderer: geometry vertices
// are lifted to a synthetic "time = altitude" z, and features carry fields
// that exist only to drive deck.gl (extrusion heights, normalized time
// fractions, per-feature colors). Exports meant for ArcGIS / geopandas / QGIS
// should instead be flat 2D WGS84 features whose attributes are the analysis
// quantities, so this transform:
//   - strips the synthetic z from all coordinates (time stays available as
//     timestamp attributes),
//   - drops renderer-internal fields (underscore-prefixed unless renamed
//     below, plus a few non-prefixed ones like z / color_rgba),
//   - renames internal-but-meaningful fields to plain names (_timestamp →
//     timestamp_ms, plus a human-readable time_iso derived from it),
//   - drops non-scalar values (arrays / objects), which cannot live in an
//     attribute table.
// ---------------------------------------------------------------------------

/** Internal fields that carry analysis meaning — exported under plain names. */
const ANALYSIS_RENAMES: Record<string, string> = {
  _timestamp: 'timestamp_ms',
  _user_id: 'user_id',
  _confidence: 'confidence_level',
  _original_index: 'source_row_index',
  _sequence: 'sequence',
  _elapsed_ms: 'elapsed_ms',
  _slice: 'slice_index',
  _segment: 'segment_index',
  // Stay points (time geography)
  _stay_id: 'stay_id',
  _stay_label: 'stay_label',
  _stay_duration: 'stay_duration_sec',
  _stay_point_count: 'stay_point_count',
  // Potential Path Area summary stats (interactive prism)
  _ppa_total_area_m2: 'ppa_area_m2',
  _ppa_total_area_km2: 'ppa_area_km2',
  _speed_kmh: 'speed_kmh',
  _time_span_min: 'time_span_min',
  _distance_m: 'anchor_distance_m',
  _feasible_segments: 'feasible_segments',
  _infeasible_segments: 'infeasible_segments',
};

/** Renderer fields not caught by the underscore rule: synthetic z values
 *  (z, z_axis), renderer scaling helpers (side_length is the grid extent in
 *  degrees used for the z scale), colors, and GPU-filter normalizations. */
const VIS_ONLY_FIELDS = new Set(['z', 'z_axis', 'side_length', 'color_rgba', 'fwd_norm', 'bwd_norm']);

/** Legend-compat aliases of activity_sec_* on PPA roads — duplicates. */
const ALIAS_FIELDS = new Set(['dwell_sec_min', 'dwell_sec_mid', 'dwell_sec_max']);

const cleanAnalysisProperties = (
  props: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    const renamed = ANALYSIS_RENAMES[key];
    if (renamed) {
      if (value != null && typeof value !== 'object') out[renamed] = value;
      if (key === '_timestamp' && typeof value === 'number' && isFinite(value)) {
        out.time_iso = new Date(value).toISOString();
      }
      continue;
    }
    if (key.startsWith('_')) continue;
    if (VIS_ONLY_FIELDS.has(key) || ALIAS_FIELDS.has(key)) continue;
    if (value !== null && typeof value === 'object') continue;
    out[key] = value;
  }
  return out;
};

type CoordinateTree = number[] | CoordinateTree[];

interface GeometryLike {
  type: string;
  coordinates?: CoordinateTree;
  geometries?: GeometryLike[];
}

/** Drop the z coordinate from every vertex, at any nesting depth. */
const dropZ = (coords: CoordinateTree): CoordinateTree =>
  Array.isArray(coords[0])
    ? (coords as CoordinateTree[]).map(dropZ)
    : [(coords as number[])[0], (coords as number[])[1]];

const geometryTo2D = (geometry: GeometryLike | null | undefined): GeometryLike | null | undefined => {
  if (!geometry) return geometry;
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: (geometry.geometries ?? []).map(g => geometryTo2D(g)!) };
  }
  if (geometry.coordinates == null) return geometry;
  return { ...geometry, coordinates: dropZ(geometry.coordinates) };
};

export interface AnalysisExportInfo {
  /** Human-readable dataset name — written as the GDAL-style `name` member. */
  label?: string;
  /** The dataset's `_dataset_type` tag (or dataset id), for provenance. */
  datasetType?: string;
  /** Tool id that produced the result, for provenance. */
  tool?: string;
}

/**
 * Convert a visualization dataset into an analysis-grade FeatureCollection:
 * 2D WGS84 geometry + scalar analysis attributes only. The provenance info
 * is written as top-level foreign members (RFC 7946 §6.1 — readers that do
 * not know them ignore them).
 */
export const toAnalysisFeatureCollection = (
  data: FeatureCollection,
  info?: AnalysisExportInfo,
): FeatureCollection => {
  const fc: Record<string, unknown> = { type: 'FeatureCollection' };
  if (info?.label) fc.name = info.label;
  if (info?.datasetType) fc.dataset_type = info.datasetType;
  if (info?.tool) fc.tool = info.tool;
  fc.exported_at = new Date().toISOString();
  fc.features = data.features.map((feature) => ({
    type: 'Feature' as const,
    geometry: geometryTo2D(feature.geometry as unknown as GeometryLike),
    properties: cleanAnalysisProperties(feature.properties as Record<string, unknown>),
  }));
  return fc as unknown as FeatureCollection;
};

/**
 * Download a dataset as analysis-grade GeoJSON (see toAnalysisFeatureCollection).
 */
export const exportAnalysisGeoJSON = (
  data: FeatureCollection,
  filename?: string,
  info?: AnalysisExportInfo,
): void => {
  exportViewAsGeoJSON(toAnalysisFeatureCollection(data, info), filename);
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
