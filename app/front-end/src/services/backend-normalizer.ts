/**
 * Normalizes backend API responses into the frontend AnalysisResult format.
 *
 * Two jobs:
 * A) Field remapping per tool (backend uses different property names)
 * B) Layer config injection (backend doesn't embed Kepler.gl layer configs)
 */
import { AnalysisResult } from './analysis-engine';
import { FeatureCollection, GeoJSONFeature } from '@/interfaces/data-interfaces';
import {
  PROCESSED_TIME_FIELD,
  PROCESSED_HEIGHT_FIELD,
  PROCESSED_NEIGHBORS_FIELD,
  COLORS,
} from '@/utils/constants';

// Backend constant names (from time-geography-backend/app/constants.py)
const BACKEND_TIME_FIELD = '_processed_time';
const BACKEND_HEIGHT_FIELD = '_processed_height';
const BACKEND_NEIGHBORS_FIELD = '_processed_neighbors';

/**
 * Convert a raw backend response into a frontend AnalysisResult.
 */
export function normalizeBackendResponse(raw: any, toolId: string): AnalysisResult {
  const outputs: FeatureCollection[] = (raw.outputs ?? []).map(
    (fc: any, index: number) => normalizeFeatureCollection(fc, toolId, index)
  );

  return {
    success: true,
    toolId: raw.toolId ?? toolId,
    outputs,
    metadata: {
      executionTime: raw.metadata?.executionTime ?? 0,
      featureCount: raw.metadata?.featureCount ?? 0,
      timestamp: raw.metadata?.timestamp ?? new Date().toISOString(),
    },
    runMeta: raw.runMeta,
  };
}

function normalizeFeatureCollection(
  fc: any,
  toolId: string,
  outputIndex: number
): FeatureCollection {
  if (!fc || !fc.features) {
    return { type: 'FeatureCollection', features: [] };
  }

  switch (toolId) {
    case 'time-geography':
      return normalizeTimeGeography(fc, outputIndex);
    case 'stkde':
      return normalizeStkde(fc, outputIndex);
    case 'space-time-cube':
      return normalizeSpaceTimeCube(fc, outputIndex);
    default:
      return normalizeGeneric(fc, toolId);
  }
}

// ---------------------------------------------------------------------------
// Time Geography
// ---------------------------------------------------------------------------

function normalizeTimeGeography(fc: any, outputIndex: number): FeatureCollection {
  // outputIndex 0 = trajectory, outputIndex 1 = stay points
  const isStayPoints = outputIndex > 0 || fc.features.some(
    (f: any) => f.properties?._dataset_type === 'stay-point'
  );

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    // Remap backend field names to frontend field names
    if (BACKEND_TIME_FIELD in props) {
      props[PROCESSED_TIME_FIELD] = props[BACKEND_TIME_FIELD];
      delete props[BACKEND_TIME_FIELD];
    }
    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }
    if (BACKEND_NEIGHBORS_FIELD in props) {
      props[PROCESSED_NEIGHBORS_FIELD] = props[BACKEND_NEIGHBORS_FIELD];
      delete props[BACKEND_NEIGHBORS_FIELD];
    }

    // Remap dataset type
    if (isStayPoints) {
      props._dataset_type = 'stay-points';
      props._layer_config = createStayPointsLayerConfig();
    } else {
      props._dataset_type = 'time-geography-trajectory';
      props._layer_config = createTrajectoryLayerConfig();
    }

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// STKDE
// ---------------------------------------------------------------------------

const STKDE_CONFIDENCE_LEVELS = [
  { confidence: 90, color: COLORS.STKDE_90, opacity: 0.6 },
  { confidence: 95, color: COLORS.STKDE_95, opacity: 0.8 },
  { confidence: 99, color: COLORS.STKDE_99, opacity: 0.3 },
];

function normalizeStkde(fc: any, outputIndex: number): FeatureCollection {
  const level = STKDE_CONFIDENCE_LEVELS[outputIndex] ?? STKDE_CONFIDENCE_LEVELS[0];
  const dataId = `stkde-density-${outputIndex + 1}`;

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    // Backend now uses _processed_height for cellHeight (same semantics as frontend _height).
    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }

    // Set dataset type to per-level id (matching frontend stkde-tool.ts enrichment)
    props._dataset_type = dataId;
    props._confidence = level.confidence;

    // Inject _geojson string for kepler columnMode: 'geojson'
    if (!props._geojson && f.geometry) {
      props._geojson = JSON.stringify(f.geometry);
    }

    // Inject Kepler layer config object (backend doesn't embed these)
    props._layer_config = createStkdeLayerConfig(dataId, level.confidence, level.color, level.opacity);

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Space-Time Cube
// ---------------------------------------------------------------------------

function normalizeSpaceTimeCube(fc: any, outputIndex: number): FeatureCollection {
  const dataId = `space-time-cube-${outputIndex}`;

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    // Remap _processed_height → _height (extrusion height for Kepler 3D)
    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }

    // Remap _processed_time → _time_order
    if (BACKEND_TIME_FIELD in props) {
      props[PROCESSED_TIME_FIELD] = props[BACKEND_TIME_FIELD];
      delete props[BACKEND_TIME_FIELD];
    }

    // Propagate _timestamp (epoch ms) for axes-utils Z-axis time labels.
    // Backend may send it as `time_value` (ISO string) or `_timestamp` (number).
    if (props._timestamp == null && props.time_value != null) {
      const tv = new Date(props.time_value).getTime();
      if (!isNaN(tv)) {
        props._timestamp = tv;
      }
    }

    // Ensure `z` property exists for axes-utils context extraction.
    // Falls back to Z coordinate from geometry if backend didn't set it.
    if (props.z == null && f.geometry?.type === 'Polygon') {
      const firstCoord = f.geometry.coordinates?.[0]?.[0];
      if (Array.isArray(firstCoord) && firstCoord.length >= 3) {
        props.z = firstCoord[2];
      }
    }

    props._dataset_type = dataId;

    if (!props._geojson && f.geometry) {
      props._geojson = JSON.stringify(f.geometry);
    }

    props._layer_config = createSpaceTimeCubeLayerConfig(dataId);

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Generic (buffer, union, intersection)
// ---------------------------------------------------------------------------

function normalizeGeneric(fc: any, toolId: string): FeatureCollection {
  const dataId = toolId; // e.g. 'buffer-analysis'

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    props._dataset_type = dataId;
    props._layer_config = createGenericPolygonLayerConfig(dataId, toolId);

    // Inject _geojson for kepler
    if (!props._geojson && f.geometry) {
      props._geojson = JSON.stringify(f.geometry);
    }

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Layer Config Factories (matching frontend tool implementations)
// ---------------------------------------------------------------------------

function createTrajectoryLayerConfig(): any {
  return {
    id: `time-geography-trajectory-layer-${Date.now()}`,
    type: 'line',
    config: {
      dataId: 'time-geography-trajectory',
      label: '3D Trajectory',
      columnMode: 'neighbors',
      color: COLORS.LINE,
      columns: {
        lat: 'latitude',
        lng: 'longitude',
        neighbors: PROCESSED_NEIGHBORS_FIELD,
        alt: PROCESSED_HEIGHT_FIELD,
      },
      isVisible: true,
      visConfig: {
        opacity: 0.8,
        thickness: 2,
        elevationScale: 1,
        enable3d: true,
      },
    },
  };
}

function createStayPointsLayerConfig(): any {
  return {
    id: `stay-points-layer-${Date.now()}`,
    type: 'point',
    config: {
      dataId: 'stay-points',
      label: 'Stay Points',
      color: COLORS.ACTIVITY_SPACE,
      columns: {
        lat: 'latitude',
        lng: 'longitude',
      },
      isVisible: true,
      visConfig: {
        opacity: 0.8,
        radius: 20,
        radiusRange: [5, 50],
        filled: true,
        stroked: true,
        strokeColor: [255, 255, 255],
        thickness: 2,
      },
    },
    visualChannels: {
      sizeField: { name: '_stay_duration', type: 'real' },
      sizeScale: 'linear',
      colorField: { name: '_stay_id', type: 'integer' },
      colorScale: 'quantile',
    },
  };
}

function createStkdeLayerConfig(
  dataId: string,
  confidence: number,
  color: number[],
  opacity: number,
): any {
  return {
    type: 'geojson',
    config: {
      dataId,
      columnMode: 'geojson',
      label: `STKDE ${confidence}%`,
      columns: { geojson: '_geojson' },
      isVisible: true,
      color,
      visConfig: {
        opacity,
        strokeOpacity: 0.8,
        thickness: 0.5,
        radius: 10,
        sizeRange: [0, 10],
        radiusRange: [0, 50],
        heightRange: [0, 500],
        elevationScale: 1,
        stroked: true,
        filled: true,
        enable3d: true,
        wireframe: false,
        fixedHeight: true,
      },
      hidden: false,
      heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'float' },
    },
    visualChannels: {
      heightScale: 'linear',
      colorField: null,
      colorScale: 'quantile',
      strokeColorField: null,
      strokeColorScale: 'quantile',
      sizeField: null,
    },
  };
}

function createSpaceTimeCubeLayerConfig(dataId: string): any {
  return {
    type: 'geojson',
    config: {
      dataId,
      columnMode: 'geojson',
      label: 'Space-Time Cube',
      columns: { geojson: '_geojson' },
      isVisible: true,
      color: COLORS.AQUARIUM,
      colorRange: {
        name: 'PM2.5',
        type: 'diverging',
        category: 'Custom',
        colors: [
          '#2b83ba', // low — blue
          '#abdda4', // low-mid — green
          '#ffffbf', // mid — yellow
          '#fdae61', // mid-high — orange
          '#d7191c', // high — red
        ],
      },
      visConfig: {
        opacity: 0.6,
        strokeOpacity: 0.8,
        thickness: 0.5,
        radius: 10,
        sizeRange: [0, 10],
        radiusRange: [0, 50],
        heightRange: [0, 500],
        elevationScale: 1,
        stroked: true,
        filled: true,
        enable3d: true,
        wireframe: false,
        fixedHeight: true,
      },
      hidden: false,
      heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'float' },
    },
    visualChannels: {
      heightScale: 'linear',
      colorField: { name: 'pm25', type: 'real' },
      colorScale: 'quantize',
      strokeColorField: null,
      strokeColorScale: 'quantile',
      sizeField: null,
    },
  };
}

function createGenericPolygonLayerConfig(dataId: string, toolId: string): any {
  const labels: Record<string, string> = {
    'buffer-analysis': 'Buffer',
    'union-analysis': 'Union',
    'intersection-analysis': 'Intersection',
  };

  return {
    type: 'geojson',
    config: {
      dataId,
      columnMode: 'geojson',
      label: labels[toolId] ?? toolId,
      columns: { geojson: '_geojson' },
      isVisible: true,
      color: COLORS.AQUARIUM,
      visConfig: {
        opacity: 0.5,
        strokeOpacity: 0.8,
        thickness: 1,
        stroked: true,
        filled: true,
        enable3d: false,
        wireframe: false,
      },
    },
  };
}
