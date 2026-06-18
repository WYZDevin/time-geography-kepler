/**
 * Normalizes backend API responses into the frontend AnalysisResult format.
 *
 * Two jobs:
 * A) Field remapping per tool (backend uses different property names)
 * B) Layer config injection (backend doesn't embed layer configs)
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
    case 'space-time-prism':
      return normalizeSpaceTimePrism(fc, outputIndex);
    case 'pasta':
      return normalizePasta(fc, outputIndex);
    default:
      throw new Error(`No normalizer for tool: ${toolId}`);
  }
}

// ---------------------------------------------------------------------------
// Time Geography
// ---------------------------------------------------------------------------

function normalizeTimeGeography(fc: any, outputIndex: number): FeatureCollection {
  // Output kinds are detected by the backend's _dataset_type tag: the 2D
  // ground path is optional and shifts the ordering, so index alone is only
  // a fallback for older backends that don't tag the trajectory output.
  const dsType = fc.features[0]?.properties?._dataset_type;
  const is2D = dsType === 'time-geography-trajectory-2d';
  const isStayPoints = !is2D && (
    dsType === 'stay-point' ||
    (dsType == null && outputIndex > 0) ||
    fc.features.some((f: any) => f.properties?._dataset_type === 'stay-point')
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
    if (props._time_progress != null && props[PROCESSED_TIME_FIELD] == null) {
      props[PROCESSED_TIME_FIELD] = props._time_progress;
    }
    if (BACKEND_NEIGHBORS_FIELD in props) {
      props[PROCESSED_NEIGHBORS_FIELD] = props[BACKEND_NEIGHBORS_FIELD];
      delete props[BACKEND_NEIGHBORS_FIELD];
    }

    // Ensure _timestamp is a number (backend may send it as-is)
    if (props._timestamp != null && typeof props._timestamp !== 'number') {
      const parsed = Number(props._timestamp);
      if (!isNaN(parsed)) props._timestamp = parsed;
    }

    // Remap dataset type — backend sends "stay-point" (singular),
    // deck-adapter expects "stay-points" (plural)
    if (isStayPoints) {
      props._dataset_type = 'stay-points';
      props._layer_config = createStayPointsLayerConfig();
    } else if (is2D) {
      props._dataset_type = 'time-geography-trajectory-2d';
      props._layer_config = create2DTrajectoryLayerConfig();
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
  const first = fc.features[0];

  // Optional 3D trajectory overlay output — same shape as a time-geography run
  if (first?.properties?._dataset_type === 'time-geography-trajectory') {
    return normalizeTimeGeography(fc, 0);
  }

  // Optional flat 2D KDE ground projection — gradient-colored by density
  if (first?.properties?.ground_projection === true) {
    return normalizeStkdeGround(fc);
  }

  // Confidence level comes from the per-class classification value (1..3):
  // outputIndex is unreliable once ground/trajectory outputs extend the list.
  const classification = first?.properties?.classification;
  const levelIndex = typeof classification === 'number'
    ? Math.min(Math.max(classification - 1, 0), 2)
    : Math.min(outputIndex, 2);
  const level = STKDE_CONFIDENCE_LEVELS[levelIndex] ?? STKDE_CONFIDENCE_LEVELS[0];
  const dataId = `stkde-density-${levelIndex + 1}`;

  // Derive max time_slice_index to compute _time_order (0..1)
  let maxSliceIndex = 0;
  for (const f of fc.features) {
    const idx = f.properties?.time_slice_index;
    if (typeof idx === 'number' && idx > maxSliceIndex) maxSliceIndex = idx;
  }

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    // Backend now uses _processed_height for cellHeight (same semantics as frontend _height).
    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }

    // Compute normalized time order from time_slice_index
    const sliceIdx = props.time_slice_index;
    if (typeof sliceIdx === 'number') {
      props[PROCESSED_TIME_FIELD] = maxSliceIndex > 0 ? sliceIdx / maxSliceIndex : 0;
    }

    // Ensure _timestamp is a number (from time_value ISO string)
    if (props._timestamp == null && props.time_value) {
      const parsed = new Date(props.time_value).getTime();
      if (isFinite(parsed)) props._timestamp = parsed;
    }

    // Set dataset type to per-level id (matching frontend stkde-tool.ts enrichment)
    props._dataset_type = dataId;
    props._confidence = level.confidence;

    // Inject _geojson string for layer data
    if (!props._geojson && f.geometry) {
      props._geojson = JSON.stringify(f.geometry);
    }

    // Inject layer config object (backend doesn't embed these)
    props._layer_config = createStkdeLayerConfig(dataId, level.confidence, level.color, level.opacity);

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// Flat 2D spatial KDE of all points (time ignored): one collection of cells
// gradient-colored by their raw density value, ArcGIS-style.
function normalizeStkdeGround(fc: any): FeatureCollection {
  const dataId = 'stkde-ground';

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }

    props._dataset_type = dataId;
    if (!props._geojson && f.geometry) {
      props._geojson = JSON.stringify(f.geometry);
    }
    props._layer_config = createStkdeGroundLayerConfig(dataId);

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Space-Time Cube
// ---------------------------------------------------------------------------

function normalizeSpaceTimeCube(fc: any, _outputIndex: number): FeatureCollection {
  // Output kinds are detected by content, not index: the ground projection is
  // optional and shifts the ordering. Trajectory = LineStrings; ground = flat
  // polygons tagged `ground_projection`; everything else = the cube stack.
  const first = fc.features?.[0];
  if (first?.geometry?.type === 'LineString') return _normalizeStcTrajectory(fc);
  if (first?.properties?.ground_projection) return _normalizeStcGround(fc);

  const dataId = 'space-time-cube-0';

  // Detect whether env data is present so we can choose the right color field
  const hasEnv = fc.features.some(
    (f: any) => f.properties?.env_value != null
  );

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }

    if (BACKEND_TIME_FIELD in props) {
      props[PROCESSED_TIME_FIELD] = props[BACKEND_TIME_FIELD];
      delete props[BACKEND_TIME_FIELD];
    }

    if (props._timestamp == null && props.time_value != null) {
      const tv = new Date(props.time_value).getTime();
      if (!isNaN(tv)) props._timestamp = tv;
    }

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

    props._layer_config = createSpaceTimeCubeLayerConfig(dataId, hasEnv);

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

function _normalizeStcTrajectory(fc: any): FeatureCollection {
  const dataId = 'stc-trajectory';

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };
    props._dataset_type = dataId;

    if (!props._geojson && f.geometry) {
      props._geojson = JSON.stringify(f.geometry);
    }

    props._layer_config = createStcTrajectoryLayerConfig();
    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

function _normalizeStcGround(fc: any): FeatureCollection {
  const dataId = 'stc-ground';
  const hasEnv = fc.features.some((f: any) => f.properties?.env_value != null);

  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }

    props._dataset_type = dataId;
    if (!props._geojson && f.geometry) {
      props._geojson = JSON.stringify(f.geometry);
    }
    props._layer_config = createStcGroundLayerConfig(dataId, hasEnv);

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Space-Time Prism
// ---------------------------------------------------------------------------

function normalizeSpaceTimePrism(fc: any, outputIndex: number): FeatureCollection {
  // Backend may return either explanatory prism outputs or PASTA outputs.
  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    // Remap backend height field
    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }
    if (props._time_progress != null && props[PROCESSED_TIME_FIELD] == null) {
      props[PROCESSED_TIME_FIELD] = props._time_progress;
    }
    if (props.z == null && f.geometry?.type === 'Polygon') {
      const firstCoord = f.geometry.coordinates?.[0]?.[0];
      if (Array.isArray(firstCoord) && firstCoord.length >= 3) {
        props.z = firstCoord[2];
      }
    } else if (props.z == null && f.geometry?.type === 'MultiPolygon') {
      const firstCoord = f.geometry.coordinates?.[0]?.[0]?.[0];
      if (Array.isArray(firstCoord) && firstCoord.length >= 3) {
        props.z = firstCoord[2];
      }
    }

    const dsType = props._dataset_type ?? (
      outputIndex === 0 ? 'space-time-prism' :
      outputIndex === 1 ? 'potential-path-area' : 'prism-anchors'
    );
    props._dataset_type = dsType;

    // Inject layer configs based on dataset type
    if (dsType === 'pasta-aggregate-surface') {
      props._layer_config = {
        type: 'geojson',
        config: {
          dataId: 'pasta-aggregate-surface',
          label: 'PASTA Potential Dwell Time',
          isVisible: true,
          color: [20, 126, 126],
          colorRange: {
            name: 'Yellow-Red',
            type: 'sequential',
            category: 'Uber',
            colors: ['#FFF5EB', '#FDD49E', '#FDBB84', '#FC8D59', '#E34A33', '#B30000'],
          },
          visConfig: {
            opacity: 0.75,
            stroked: true,
            filled: true,
            enable3d: true,
            wireframe: false,
            fixedHeight: false,
            elevationScale: 1,
            thickness: 0.5,
          },
          heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'float' },
          colorField: { name: 'dwell_minutes', type: 'real' },
        },
      };
    } else if (dsType === 'pasta-voxels') {
      props._layer_config = {
        type: 'geojson',
        config: {
          dataId: 'pasta-voxels',
          label: 'PASTA Dwell-Time Voxels',
          isVisible: true,
          color: [255, 196, 77],
          visConfig: {
            opacity: 0.45,
            stroked: false,
            filled: true,
            enable3d: true,
            wireframe: false,
            fixedHeight: true,
            elevationScale: 1,
          },
          heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'float' },
        },
      };
    } else if (dsType === 'pasta-anchor-windows') {
      props._layer_config = {
        type: 'point',
        config: {
          dataId: 'pasta-anchor-windows',
          label: 'PASTA Anchor Windows',
          isVisible: true,
          color: [220, 50, 50],
          visConfig: {
            opacity: 0.9,
            radius: 20,
            filled: true,
            stroked: true,
          },
        },
      };
    } else if (dsType === 'space-time-prism') {
      props._layer_config = {
        type: 'geojson',
        config: {
          dataId: 'space-time-prism',
          label: 'Space-Time Prism',
          isVisible: true,
          color: [88, 166, 255],
          visConfig: {
            opacity: 0.32,
            stroked: true,
            filled: true,
            enable3d: true,
            wireframe: false,
            fixedHeight: true,
            elevationScale: 1,
            thickness: 0.5,
          },
          heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'float' },
          colorField: PROCESSED_TIME_FIELD,
        },
      };
    } else if (dsType === 'potential-path-area') {
      props._layer_config = {
        type: 'geojson',
        config: {
          dataId: 'potential-path-area',
          label: 'Potential Path Area (2D)',
          isVisible: true,
          color: [25, 135, 84],
          visConfig: {
            opacity: 0.12,
            stroked: true,
            filled: true,
            enable3d: false,
            thickness: 2,
          },
        },
      };
    } else if (dsType === 'prism-anchors') {
      props._layer_config = {
        type: 'point',
        config: {
          dataId: 'prism-anchors',
          label: 'Anchor Points (A/B)',
          isVisible: true,
          color: [255, 100, 100],
          visConfig: {
            opacity: 0.9,
            radius: 55,
            filled: true,
            stroked: true,
          },
        },
      };
    } else if (dsType === 'road-network-minute-buffer') {
      props._layer_config = {
        type: 'geojson',
        config: {
          dataId: 'road-network-minute-buffer',
          label: 'Road Network Buffer Slice',
          isVisible: true,
          color: [11, 114, 133],
          visConfig: {
            opacity: 0.15,
            stroked: true,
            filled: true,
            enable3d: true,
            wireframe: false,
            fixedHeight: true,
            elevationScale: 1,
            thickness: 0.5,
          },
          heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'float' },
        },
      };
    } else if (dsType === 'road-network-minute-segment') {
      props._layer_config = {
        type: 'geojson',
        config: {
          dataId: 'road-network-minute-segment',
          label: 'Clipped Road Network',
          isVisible: true,
          color: [201, 42, 42],
          visConfig: {
            opacity: 0.9,
            stroked: true,
            filled: false,
            enable3d: false,
            thickness: 2,
          },
        },
      };
    } else if (dsType === 'ppa-road-network') {
      // No _layer_config — deck-adapter dispatches this to a LineLayer with
      // explicit 3D source/target positions extracted from the LineString
      // coordinates' Z values, so the rendered roads track the per-GPS-point
      // altitude (z = time_progress × total_height).  Per-segment colour
      // comes from properties.color_rgba which the backend pre-computes from
      // dwell_sec_min on the same blue→red ramp used elsewhere in the legend.
    } else if (dsType === 'ppa-origin-points') {
      // GPS origin points stacked 3D along the anchor time window.
      // Sized by reachable PPA road length, colored by mean dwell time.
      props._layer_config = {
        type: 'point',
        config: {
          dataId: 'ppa-origin-points',
          label: 'PPA Origin Points',
          isVisible: true,
          color: [255, 215, 0],
          colorRange: {
            name: 'Dwell Time (min → red)',
            type: 'sequential',
            category: 'Uber',
            colors: ['#2C7BB6', '#ABD9E9', '#FFFFBF', '#FDAE61', '#D7191C'],
          },
          visConfig: {
            opacity: 0.95,
            radius: 18,
            filled: true,
            stroked: true,
            strokeColor: [255, 255, 255],
          },
        },
        visualChannels: {
          colorField: { name: 'dwell_sec_mean', type: 'real' },
          colorScale: 'quantize',
          sizeField: { name: 'ppa_reachable_length_m', type: 'real' },
          sizeScale: 'sqrt',
        },
      };
    }

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// PASTA
// ---------------------------------------------------------------------------

function normalizePasta(fc: any, outputIndex: number): FeatureCollection {
  const features: GeoJSONFeature[] = fc.features.map((f: any) => {
    const props = { ...f.properties };

    if (BACKEND_HEIGHT_FIELD in props) {
      props[PROCESSED_HEIGHT_FIELD] = props[BACKEND_HEIGHT_FIELD];
      delete props[BACKEND_HEIGHT_FIELD];
    }

    if (!props._dataset_type) {
      props._dataset_type = outputIndex === 0 ? 'pasta-aggregate-surface' : 'road-network-minute-segment';
    }

    return { type: 'Feature' as const, geometry: f.geometry, properties: props };
  });

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Generic (buffer, union, intersection)
// ---------------------------------------------------------------------------

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

function create2DTrajectoryLayerConfig(): any {
  return {
    id: `time-geography-trajectory-2d-layer-${Date.now()}`,
    type: 'line',
    config: {
      dataId: 'time-geography-trajectory-2d',
      label: '2D Trajectory',
      columnMode: 'neighbors',
      color: COLORS.LINE,
      columns: {
        lat: 'latitude',
        lng: 'longitude',
        neighbors: PROCESSED_NEIGHBORS_FIELD,
      },
      isVisible: true,
      visConfig: {
        opacity: 0.9,
        thickness: 2,
        enable3d: false,
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

function createStkdeGroundLayerConfig(dataId: string): any {
  return {
    type: 'geojson',
    config: {
      dataId,
      columnMode: 'geojson',
      label: 'STKDE 2D Density (Ground)',
      columns: { geojson: '_geojson' },
      isVisible: true,
      color: COLORS.STKDE_95,
      // Low → high density: pale yellow → dark red, the classic KDE heat ramp
      colorRange: {
        name: 'Density',
        type: 'sequential',
        category: 'Uber',
        colors: ['#FFF5EB', '#FDD49E', '#FDBB84', '#FC8D59', '#E34A33', '#B30000'],
      },
      visConfig: {
        opacity: 0.7,
        strokeOpacity: 0,
        thickness: 0.5,
        stroked: false,
        filled: true,
        enable3d: false,
        wireframe: false,
      },
      hidden: false,
    },
    visualChannels: {
      colorField: { name: 'density', type: 'real' },
      colorScale: 'quantize',
      strokeColorField: null,
      strokeColorScale: 'quantile',
      sizeField: null,
    },
  };
}

// Quiet (low) → loud (high): blue → red, matching noise/pollution scales
const EXPOSURE_COLOR_RANGE = {
  name: 'Exposure',
  type: 'sequential',
  category: 'Custom',
  colors: ['#2166ac', '#4393c3', '#92c5de', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
};

function createSpaceTimeCubeLayerConfig(dataId: string, hasEnv: boolean): any {
  return {
    type: 'geojson',
    config: {
      dataId,
      columnMode: 'geojson',
      label: 'Space-Time Cube',
      columns: { geojson: '_geojson' },
      isVisible: true,
      color: COLORS.AQUARIUM,
      colorRange: hasEnv ? EXPOSURE_COLOR_RANGE : {
        name: 'Count',
        type: 'sequential',
        category: 'Custom',
        colors: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'],
      },
      visConfig: {
        opacity: 0.65,
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
      colorField: hasEnv
        ? { name: 'env_value', type: 'real' }
        : { name: 'count', type: 'integer' },
      colorScale: 'quantize',
      strokeColorField: null,
      strokeColorScale: 'quantile',
      sizeField: null,
    },
  };
}

function createStcGroundLayerConfig(dataId: string, hasEnv: boolean): any {
  return {
    type: 'geojson',
    config: {
      dataId,
      columnMode: 'geojson',
      label: 'Space-Time Cube (Ground)',
      columns: { geojson: '_geojson' },
      isVisible: true,
      color: COLORS.AQUARIUM,
      colorRange: hasEnv ? EXPOSURE_COLOR_RANGE : {
        name: 'Count',
        type: 'sequential',
        category: 'Custom',
        colors: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'],
      },
      visConfig: {
        opacity: 0.65,
        strokeOpacity: 0.8,
        thickness: 0.5,
        stroked: true,
        filled: true,
        enable3d: false,
        wireframe: false,
      },
      hidden: false,
    },
    visualChannels: {
      colorField: hasEnv
        ? { name: 'env_value', type: 'real' }
        : { name: 'count', type: 'integer' },
      colorScale: 'quantize',
      strokeColorField: null,
      strokeColorScale: 'quantile',
      sizeField: null,
    },
  };
}

function createStcTrajectoryLayerConfig(): any {
  return {
    type: 'geojson',
    config: {
      dataId: 'stc-trajectory',
      columnMode: 'geojson',
      label: 'Trajectory Exposure',
      columns: { geojson: '_geojson' },
      isVisible: true,
      color: [255, 165, 0],
      colorRange: EXPOSURE_COLOR_RANGE,
      visConfig: {
        opacity: 0.9,
        thickness: 3,
        filled: false,
        stroked: true,
        enable3d: false,
        elevationScale: 1,
      },
      hidden: false,
    },
    visualChannels: {
      colorField: null,
      colorScale: 'quantize',
      sizeField: null,
      strokeColorField: { name: 'env_exposure', type: 'real' },
      strokeColorScale: 'quantize',
    },
  };
}

