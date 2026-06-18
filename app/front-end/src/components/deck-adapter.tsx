/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { addDatasets, addLayers, setLayers, clearAll, removeDataset, removeLayers, setViewState, setSliceCount } from '@/stores/map-slice';
import type { DeckLayerDescriptor, MapDataset } from '@/interfaces/map-types';
import { AnalysisResult } from '@/services/analysis-engine';
import { createVisualizationService } from '@/services/visualization-service';
import { extractAxesContext, createSharedAxes } from '@/utils/axes-utils';
import { PROCESSED_HEIGHT_FIELD, PROCESSED_TIME_FIELD, COLORS } from '@/utils/constants';

interface DeckAdapterProps {
  result: AnalysisResult | null;
  onVisualizationComplete?: () => void;
  appendMode?: boolean;
}

/**
 * Adapter component that converts AnalysisResult → deck.gl layers via Redux.
 * Translates tool _layer_config objects to DeckLayerDescriptor.
 */
export const DeckAdapter: React.FC<DeckAdapterProps> = ({
  result,
  onVisualizationComplete,
  appendMode = false,
}) => {
  const dispatch = useAppDispatch();
  const visualizationService = useMemo(() => createVisualizationService(), []);
  const toolOptions = useAppSelector(s => s.workflow.toolOptions);

  useEffect(() => {
    if (!result || !result.success) return;

    // Get layer configs (existing pipeline)
    const layerConfigs = visualizationService.createLayersFromToolOutput(
      result.toolId,
      result.outputs,
    );

    const newDatasets: MapDataset[] = [];
    const newLayers: DeckLayerDescriptor[] = [];

    // Process each output FeatureCollection
    result.outputs.forEach((output, index) => {
      const layerConfig = layerConfigs[index];
      const dsType = output.features[0]?.properties?._dataset_type as string || '';
      const datasetId =
        layerConfig?.config?.dataId || dsType || `${result.toolId}-${Date.now()}-${index}`;
      const datasetLabel = dsType || `${result.toolId} Result ${index + 1}`;

      // Clean internal properties before storing
      const cleanedOutput: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: output.features.map(f => ({
          type: 'Feature' as const,
          geometry: f.geometry,
          properties: Object.fromEntries(
            Object.entries(f.properties || {}).filter(
              ([key]) => !key.startsWith('_layer_config') && key !== '_dataset_type',
            ),
          ),
        })),
      };

      // Build field summary from first feature
      const firstProps = output.features[0]?.properties || {};
      const fieldSummary = Object.entries(firstProps)
        .filter(([k]) => !k.startsWith('_layer_config') && k !== '_dataset_type')
        .map(([name, val]) => ({
          name,
          type: typeof val === 'number' ? 'real' : typeof val === 'boolean' ? 'boolean' : 'string',
        }));

      newDatasets.push({ id: datasetId, label: datasetLabel, data: cleanedOutput, fieldSummary });

      // Build DeckLayerDescriptor — use direct handlers for known dataset types,
      // fall back to generic layer config for legacy tools
      const descriptor = buildDescriptorForDataset(dsType, layerConfig, datasetId, datasetLabel, cleanedOutput);
      newLayers.push(descriptor);
    });

    // Generate shared 3D axes if requested (prism has its own 3D geometry — skip)
    if (result.toolId !== 'space-time-prism' && toolOptions.showAxes !== false) {
      const axesContext = extractAxesContext(result.outputs);
      if (axesContext) {
        const { axes, labels } = createSharedAxes(axesContext, {
          timeBreaks: toolOptions.timeBreaks as 'auto' | '1h' | '4h' | '12h' | '24h' | undefined,
        });

        // Axes lines dataset
        const axesClean: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: axes.features.map(f => ({
            type: 'Feature' as const,
            geometry: f.geometry,
            properties: Object.fromEntries(
              Object.entries(f.properties || {}).filter(
                ([k]) => !k.startsWith('_layer_config') && k !== '_dataset_type' && k !== '_geojson',
              ),
            ),
          })),
        };
        newDatasets.push({
          id: 'shared-axes',
          label: 'Coordinate Axes',
          data: axesClean,
          fieldSummary: [{ name: 'axis_type', type: 'string' }],
        });

        // Build line segments from axis LineStrings for true 3D rendering
        const axisSegments = buildLineSegmentsFromLineStrings(axesClean);

        newLayers.push({
          id: `shared-axes-layer-${Date.now()}`,
          type: 'line',
          datasetId: 'shared-axes',
          label: 'Coordinate Axes',
          isVisible: true,
          opacity: 0.6,
          color: [150, 150, 150],
          config: {
            segmentData: axisSegments,
            widthScale: 1.5,
          },
        });

        // Labels dataset
        const labelsClean: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: labels.features.map(f => ({
            type: 'Feature' as const,
            geometry: f.geometry,
            properties: Object.fromEntries(
              Object.entries(f.properties || {}).filter(
                ([k]) => !k.startsWith('_layer_config') && k !== '_dataset_type' && k !== '_geojson',
              ),
            ),
          })),
        };
        newDatasets.push({
          id: 'shared-axes-labels',
          label: 'Axis Labels',
          data: labelsClean,
          fieldSummary: [
            { name: 'axis_type', type: 'string' },
            { name: 'axis_label_text', type: 'string' },
          ],
        });

        newLayers.push({
          id: `shared-axes-labels-layer-${Date.now()}`,
          type: 'text',
          datasetId: 'shared-axes-labels',
          label: 'Axis Labels',
          isVisible: true,
          opacity: 1,
          color: [255, 255, 255],
          config: {
            textField: 'axis_label_text',
            textSize: 14,
            textColor: [0, 0, 0, 255],
            textAnchor: 'start',
            alignmentBaseline: 'center',
            outlineWidth: 2,
            outlineColor: [255, 255, 255, 255],
            fontFamily: 'Monaco, monospace',
            billboard: true,
          },
        });
      }
    }

    // Auto-compute time slice count from trajectory timestamps or grid time slices
    const ONE_HOUR_MS = 3_600_000;
    let autoSliceCount = 0;
    for (const output of result.outputs) {
      const dsType = output.features[0]?.properties?._dataset_type as string || '';

      // Trajectory: 1 slice per hour
      if (dsType === 'time-geography-trajectory' || dsType === 'prism-trajectory') {
        let minT = Infinity;
        let maxT = -Infinity;
        for (const f of output.features) {
          const t = f.properties?._timestamp as number | undefined;
          if (typeof t === 'number' && isFinite(t)) {
            if (t < minT) minT = t;
            if (t > maxT) maxT = t;
          }
        }
        if (isFinite(minT) && isFinite(maxT) && maxT > minT) {
          autoSliceCount = Math.max(1, Math.ceil((maxT - minT) / ONE_HOUR_MS));
        }
        break;
      }

      // STKDE / STC: derive from time_slice_index
      if (dsType.startsWith('stkde-density-') || dsType.startsWith('space-time-cube')) {
        let maxIdx = 0;
        for (const f of output.features) {
          const idx = f.properties?.time_slice_index as number | undefined;
          if (typeof idx === 'number' && idx > maxIdx) maxIdx = idx;
        }
        if (maxIdx > 0) {
          autoSliceCount = maxIdx + 1;
        }
        break;
      }

      // PASTA dwell-time voxels: derive from backend time_bin.
      if (dsType === 'pasta-voxels') {
        let maxIdx = 0;
        for (const f of output.features) {
          const idx = f.properties?.time_bin as number | undefined;
          if (typeof idx === 'number' && idx > maxIdx) maxIdx = idx;
        }
        if (maxIdx > 0) {
          autoSliceCount = maxIdx + 1;
        }
        break;
      }

      // Road network minute buffers/segments: one animation slice per route minute.
      if (dsType === 'road-network-minute-buffer' || dsType === 'road-network-minute-segment') {
        let maxMinute = 0;
        for (const f of output.features) {
          const minute = f.properties?.minute as number | undefined;
          if (typeof minute === 'number' && minute > maxMinute) maxMinute = minute;
        }
        autoSliceCount = maxMinute + 1;
        break;
      }
    }

    const orderedLayers = result.toolId === 'space-time-prism'
      ? [...newLayers].sort((a, b) => prismLayerRank(a.datasetId) - prismLayerRank(b.datasetId))
      : newLayers;

    // Dispatch to Redux
    if (appendMode) {
      // Remove old axes before appending new ones
      dispatch(removeDataset('shared-axes'));
      dispatch(removeDataset('shared-axes-labels'));
      dispatch(removeLayers(
        orderedLayers.filter(l => l.datasetId === 'shared-axes' || l.datasetId === 'shared-axes-labels').map(l => l.id),
      ));
      dispatch(addDatasets(newDatasets));
      dispatch(addLayers(orderedLayers));
    } else {
      dispatch(clearAll());
      dispatch(addDatasets(newDatasets));
      dispatch(setLayers(orderedLayers));
    }

    // Set auto-detected slice count (1 slice per hour)
    if (autoSliceCount > 0) {
      dispatch(setSliceCount(autoSliceCount));
    }

    // Auto-center map on new data
    centerMapOnDatasets(newDatasets, dispatch);

    onVisualizationComplete?.();
  }, [result, dispatch, visualizationService, toolOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  return null; // Logic component, no UI
};

// ===========================================================================
// Auto-center map on data bounds
// ===========================================================================

function centerMapOnDatasets(datasets: MapDataset[], dispatch: any) {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  for (const ds of datasets) {
    // Skip axes datasets
    if (ds.id.startsWith('shared-axes')) continue;

    for (const f of ds.data.features) {
      const geom = f.geometry;
      if (!geom) continue;
      const coords = extractAllCoords(geom);
      for (const [lng, lat] of coords) {
        if (typeof lng === 'number' && typeof lat === 'number') {
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
      }
    }
  }

  if (minLng === Infinity) return;

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  // Estimate zoom from extent (rough heuristic)
  const latExtent = maxLat - minLat;
  const lngExtent = maxLng - minLng;
  const maxExtent = Math.max(latExtent, lngExtent, 0.001);
  const hasPrism = datasets.some(ds => ds.id.includes('space-time-prism') || ds.id.includes('prism-trajectory'));
  const zoom = Math.min(18, Math.max(1, Math.floor(Math.log2(360 / maxExtent)) - (hasPrism ? 1 : 0)));

  dispatch(setViewState({
    longitude: centerLng,
    latitude: centerLat,
    zoom,
    pitch: hasPrism ? 62 : 45,
    bearing: hasPrism ? -25 : 0,
  }));
}

function prismLayerRank(datasetId: string): number {
  if (datasetId === 'potential-path-area') return 0;
  if (datasetId === 'road-network-minute-segment') return 1;
  if (datasetId.includes('road-network-minute-segment')) return 1;
  if (datasetId === 'space-time-prism') return 1;
  if (datasetId === 'prism-trajectory') return 2;
  if (datasetId === 'prism-anchors') return 3;
  if (datasetId === 'shared-axes') return 4;
  if (datasetId === 'shared-axes-labels') return 5;
  return 10;
}

function extractAllCoords(geom: GeoJSON.Geometry): number[][] {
  switch (geom.type) {
    case 'Point': return [geom.coordinates];
    case 'MultiPoint': return geom.coordinates;
    case 'LineString': return geom.coordinates;
    case 'MultiLineString': return geom.coordinates.flat();
    case 'Polygon': return geom.coordinates.flat();
    case 'MultiPolygon': return geom.coordinates.flat(2);
    default: return [];
  }
}

// ===========================================================================
// Direct descriptor builders for known dataset types
// ===========================================================================

export function buildDescriptorForDataset(
  dsType: string,
  _legacyConfig: any,
  datasetId: string,
  label: string,
  dataset: GeoJSON.FeatureCollection,
): DeckLayerDescriptor {
  const ts = Date.now();

  // --- Trajectories (LineLayer for true 3D lines) ---
  if (dsType === 'time-geography-trajectory' || dsType === 'prism-trajectory') {
    const isPrismPath = dsType === 'prism-trajectory';
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'line',
      datasetId,
      label: isPrismPath ? 'Anchor Time Path' : '3D Trajectory',
      isVisible: true,
      opacity: isPrismPath ? 0.95 : 0.8,
      color: (isPrismPath ? [36, 36, 36] : COLORS.LINE) as [number, number, number],
      config: { segmentData: buildLineSegments(dataset), widthScale: isPrismPath ? 4 : 2 },
    };
  }

  // --- 2D ground projection of the trajectory (flat line on the map plane) ---
  // The dataset's points carry _processed_height = 0 and Z = 0, so the same
  // segment builder yields flat segments at ground level.
  if (dsType === 'time-geography-trajectory-2d') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'line',
      datasetId,
      label: '2D Trajectory',
      isVisible: true,
      opacity: 0.9,
      color: COLORS.LINE as [number, number, number],
      config: { segmentData: buildLineSegments(dataset), widthScale: 2 },
    };
  }

  // --- STKDE density (3D extruded polygons per confidence level) ---
  if (dsType.startsWith('stkde-density-')) {
    const levelIndex = parseInt(dsType.split('-')[2] || '1', 10) - 1;
    const levels = [
      { color: COLORS.STKDE_90, opacity: 0.6, label: 'STKDE 90%' },
      { color: COLORS.STKDE_95, opacity: 0.8, label: 'STKDE 95%' },
      { color: COLORS.STKDE_99, opacity: 0.3, label: 'STKDE 99%' },
    ];
    const level = levels[levelIndex] ?? levels[0];
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: level.label,
      isVisible: true,
      opacity: level.opacity,
      color: level.color as [number, number, number],
      config: {
        renderAs: 'polygon',
        extruded: true,
        animateByTime: true,
        filled: true,
        stroked: true,
        wireframe: false,
        heightField: PROCESSED_HEIGHT_FIELD,
        elevationScale: 1,
      },
    };
  }

  // --- STKDE 2D spatial KDE ground projection (flat cells at Z=0, gradient-
  //     coloured by raw density, ArcGIS-style) ---
  if (dsType === 'stkde-ground') {
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of dataset.features) {
      const v = f.properties?.density;
      if (typeof v === 'number') {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'STKDE 2D Density (Ground)',
      isVisible: true,
      opacity: 0.7,
      color: COLORS.STKDE_95 as [number, number, number],
      config: {
        extruded: false,
        filled: true,
        stroked: false,
        wireframe: false,
        colorField: 'density',
        colorDomain: [lo, hi],
        // Low → high density: pale yellow → dark red, the classic KDE heat ramp
        colorRange: ['#FFF5EB', '#FDD49E', '#FDBB84', '#FC8D59', '#E34A33', '#B30000'],
      },
    };
  }

  // --- Legacy STKDE per-confidence-level ground footprints (flat polygons at
  //     Z=0; produced by the currently-disabled browser implementation) ---
  if (dsType.startsWith('stkde-ground-')) {
    const levelIndex = parseInt(dsType.split('-')[2] || '1', 10) - 1;
    const levels = [
      { color: COLORS.STKDE_90, opacity: 0.6, label: 'STKDE 90% (Ground)' },
      { color: COLORS.STKDE_95, opacity: 0.8, label: 'STKDE 95% (Ground)' },
      { color: COLORS.STKDE_99, opacity: 0.3, label: 'STKDE 99% (Ground)' },
    ];
    const level = levels[levelIndex] ?? levels[0];
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: level.label,
      isVisible: true,
      opacity: level.opacity,
      color: level.color as [number, number, number],
      config: {
        renderAs: 'polygon',
        extruded: false,
        filled: true,
        stroked: true,
        wireframe: false,
        // Coplanar fills at Z=0 across confidence levels would z-fight; disable
        // depth testing so draw order decides and the ground stays flicker-free.
        parameters: { depthTest: false },
      },
    };
  }

  // --- Space-Time Cube trajectory (true 3D line threading the cube stack;
  //     coloured per-segment by environmental exposure when env data is
  //     present, otherwise drawn in the default trajectory colour) ---
  if (dsType === 'stc-trajectory') {
    const hasExposure = dataset.features.some(f => f.properties?.env_exposure != null);
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'line',
      datasetId,
      label: hasExposure ? 'Trajectory Exposure' : '3D Trajectory',
      isVisible: true,
      opacity: 1,
      color: [255, 165, 0],
      config: {
        segmentData: buildLineSegmentsFromLineFeatures(dataset),
        widthScale: 4,
        widthMinPixels: 2.5,
        // Draw over the cube columns it threads through (otherwise occluded).
        depthTest: false,
      },
    };
  }

  // --- Space-Time Cube (3D extruded polygons with color field) ---
  if (dsType.startsWith('space-time-cube')) {
    // Colour by environmental exposure when present (env_value), otherwise by
    // point count. buildColorAccessor needs an explicit domain, so derive it.
    const hasEnv = dataset.features.some(f => f.properties?.env_value != null);
    const colorField = hasEnv ? 'env_value' : 'count';
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of dataset.features) {
      const v = f.properties?.[colorField];
      if (typeof v === 'number') {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'Space-Time Cube',
      isVisible: true,
      opacity: 0.6,
      color: COLORS.AQUARIUM as [number, number, number],
      config: {
        extruded: true,
        animateByTime: true,
        filled: true,
        stroked: true,
        wireframe: false,
        heightField: PROCESSED_HEIGHT_FIELD,
        elevationScale: 1,
        colorField,
        colorDomain: [lo, hi],
        colorRange: hasEnv
          ? ['#2166ac', '#4393c3', '#92c5de', '#fddbc7', '#f4a582', '#d6604d', '#b2182b']
          : ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'],
      },
    };
  }

  // --- Space-Time Cube 2D ground projection (flat polygons at Z=0, aggregated
  //     over time, coloured by exposure when present else by total count) ---
  if (dsType === 'stc-ground') {
    const hasEnv = dataset.features.some(f => f.properties?.env_value != null);
    const colorField = hasEnv ? 'env_value' : 'count';
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of dataset.features) {
      const v = f.properties?.[colorField];
      if (typeof v === 'number') {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'Space-Time Cube (Ground)',
      isVisible: true,
      opacity: 0.7,
      color: COLORS.AQUARIUM as [number, number, number],
      config: {
        extruded: false,
        filled: true,
        stroked: true,
        wireframe: false,
        colorField,
        colorDomain: [lo, hi],
        colorRange: hasEnv
          ? ['#2166ac', '#4393c3', '#92c5de', '#fddbc7', '#f4a582', '#d6604d', '#b2182b']
          : ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'],
      },
    };
  }

  // --- Space-Time Prism (extruded thin slabs at vertex Z positions) ---
  if (dsType === 'space-time-prism') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: '3D Space-Time Prism',
      isVisible: true,
      opacity: 0.52,
      color: [88, 166, 255],
      config: {
        extruded: true,
        animateByTime: true,
        filled: true,
        stroked: false,
        wireframe: false,
        heightField: '_slice_height',
        zBaseField: 'z',
        elevationScale: 1,
        prismWireframe: true,
        full3d: true,
        colorField: PROCESSED_TIME_FIELD,
        colorDomain: [0, 1],
        colorRange: ['#d73027', '#fee08b', '#4575b4'],
        material: {
          ambient: 0.45,
          diffuse: 0.6,
          shininess: 24,
          specularColor: [255, 255, 255],
        },
        parameters: { depthTest: false },
      },
    };
  }

  // --- PASTA aggregate surface (2D flat choropleth, colored by dwell time) ---
  if (dsType === 'pasta-aggregate-surface') {
    const maxWeightedDwell = dataset.features.reduce((max, feature) => {
      const value = feature.properties?.weighted_dwell_minutes;
      return typeof value === 'number' ? Math.max(max, value) : max;
    }, 0);

    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'PASTA Potential Dwell Time',
      isVisible: true,
      opacity: 0.72,
      color: [20, 126, 126],
      config: {
        extruded: false,
        filled: true,
        stroked: true,
        colorField: 'weighted_dwell_minutes',
        colorDomain: [0, maxWeightedDwell],
        colorRange: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'],
      },
    };
  }

  // --- PASTA road network (3D lines lifted to dwell-time height) ---
  if (dsType === 'pasta-road-network') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'line',
      datasetId,
      label: 'PASTA Road Network',
      isVisible: true,
      opacity: 0.9,
      color: [255, 140, 0],
      config: {
        segmentData: buildLineSegmentsFromLineFeatures(dataset),
        widthScale: 1.5,
      },
    };
  }

  // --- PPA road network (per-GPS-point reachable roads, stacked 3D by time) ---
  // Render each reachable road edge as a continuous PathLayer path (rounded
  // joints/caps) so adjacent edges read as a connected road surface instead of
  // dashed segments. The geometry is uploaded once and a GPU two-cone time
  // filter (see buildPathLayer) animates which edges are reachable at each
  // moment, keeping time-scrubbing smooth. Each path carries its own
  // colour_rgba pre-computed on the backend from dwell_sec_min.
  if (dsType === 'ppa-road-network') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'path',
      datasetId,
      label: 'PPA Reachable Roads',
      isVisible: true,
      opacity: 0.9,
      color: [220, 90, 60],
      config: {
        pathData: buildPpaPathsFromLineFeatures(dataset),
        widthScale: 4,
        widthMinPixels: 2,
        timeFilter2D: true,
        // The prism is lifted to "time" altitude (often many km up), where the
        // depth buffer loses precision and Chrome's ANGLE pipeline depth-culls
        // the lines entirely (they render in Firefox's native GL). Drawing
        // without depth-testing makes them appear in both browsers.
        depthTest: false,
      },
    };
  }

  // --- PPA road network ground projection (same paths flattened to z=0) ---
  // Reads like a "shadow" of the stacked 3D PPA layer — same shape on the
  // basemap so users can see road coverage without the depth-cue clutter.
  // Animates in sync with the 3D layer via the same GPU two-cone filter.
  if (dsType === 'ppa-road-network-ground') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'path',
      datasetId,
      label: 'PPA Reachable Roads (Ground)',
      isVisible: true,
      opacity: 0.55,
      color: [120, 60, 40],
      config: {
        pathData: buildPpaPathsFromLineFeatures(dataset, true),
        widthScale: 2.5,
        widthMinPixels: 1,
        timeFilter2D: true,
        depthTest: false,
      },
    };
  }

  // --- PPA dwell surface (flat H3 cells, colored by available activity time) ---
  // The default main-map reading of the network prism: where the subject could
  // have been AND how long they could have stayed there. Same blue→red ramp as
  // the backend's per-edge color_rgba, so the roads and the surface agree.
  if (dsType === 'ppa-dwell-surface') {
    const maxDwell = dataset.features.reduce((max, feature) => {
      const value = feature.properties?.dwell_minutes;
      return typeof value === 'number' ? Math.max(max, value) : max;
    }, 0);

    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'Potential Dwell Time Surface',
      isVisible: true,
      opacity: 0.55,
      color: [44, 123, 182],
      config: {
        extruded: false,
        filled: true,
        stroked: false,
        colorField: 'dwell_minutes',
        colorDomain: [0, maxDwell],
        colorRange: ['#2C7BB6', '#ABD9E9', '#FFFFBF', '#FDAE61', '#D7191C'],
        parameters: { depthTest: false },
      },
    };
  }

  // --- PASTA voxels (individual person-window dwell-time intervals) ---
  if (dsType === 'pasta-voxels') {
    const maxWeightedDwell = dataset.features.reduce((max, feature) => {
      const value = feature.properties?.weighted_dwell_minutes;
      return typeof value === 'number' ? Math.max(max, value) : max;
    }, 0);

    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'PASTA Dwell-Time Voxels',
      isVisible: true,
      opacity: 0.45,
      color: [255, 196, 77],
      config: {
        extruded: true,
        animateByTime: true,
        filled: true,
        stroked: false,
        wireframe: false,
        heightField: PROCESSED_HEIGHT_FIELD,
        elevationScale: 1,
        colorField: 'weighted_dwell_minutes',
        colorDomain: [0, maxWeightedDwell],
        colorRange: ['#fff7bc', '#fee391', '#fec44f', '#fe9929', '#cc4c02'],
      },
    };
  }

  // --- PASTA anchor windows (fixed activities bracketing flexible activity) ---
  if (dsType === 'pasta-anchor-windows') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'column',
      datasetId,
      label: 'PASTA Anchor Windows',
      isVisible: true,
      opacity: 0.85,
      color: [220, 50, 50],
      config: { radius: 45, diskResolution: 8, elevatedBase: true, cubeHeight: 80 },
    };
  }

  // --- Road-network STP buffer circles (one per GPS point, 3D by time) ---
  if (dsType === 'road-network-stp-buffer') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'GPS Point Buffers',
      isVisible: true,
      opacity: 0.25,
      color: [11, 114, 133],
      config: {
        extruded: true,
        filled: true,
        stroked: true,
        wireframe: false,
        heightField: PROCESSED_HEIGHT_FIELD,
        elevationScale: 1,
      },
    };
  }

  // --- Road-network minute buffers (3D extruded route-time slabs) ---
  if (dsType === 'road-network-minute-buffer') {
    const maxMinute = dataset.features.reduce((max, feature) => {
      const minute = feature.properties?.minute;
      return typeof minute === 'number' ? Math.max(max, minute) : max;
    }, 0);

    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'UTM to Airport Road Buffers',
      isVisible: true,
      opacity: 0.55,
      color: [20, 126, 126],
      config: {
        extruded: true,
        animateByTime: true,
        filled: true,
        stroked: true,
        wireframe: false,
        heightField: PROCESSED_HEIGHT_FIELD,
        elevationScale: 1,
        colorField: 'minute',
        colorDomain: [0, maxMinute],
        colorRange: ['#0b7285', '#22b8cf', '#69db7c', '#ffd43b', '#f08c00', '#c92a2a'],
      },
    };
  }

  // --- Road-network minute segments (animated 3D route lines) ---
  if (dsType === 'road-network-minute-segment') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'line',
      datasetId,
      label: 'Network Prism Corridor',
      isVisible: true,
      opacity: 0.95,
      color: [8, 126, 164],
      config: {
        segmentData: buildLineSegmentsFromLineFeatures(dataset),
        widthScale: 1,
      },
    };
  }

  // --- Potential Path Area (flat 2D polygon) ---
  if (dsType === 'potential-path-area') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'geojson',
      datasetId,
      label: 'Potential Path Area (2D Projection)',
      isVisible: true,
      opacity: 0.12,
      color: [25, 135, 84],
      config: {
        extruded: false,
        filled: true,
        stroked: true,
        thickness: 2,
        parameters: { depthTest: false },
      },
    };
  }

  // --- Stay points (3D columns at their Z position) ---
  if (dsType === 'stay-points') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'column',
      datasetId,
      label: 'Stay Points',
      isVisible: true,
      opacity: 0.8,
      color: COLORS.ACTIVITY_SPACE as [number, number, number],
      config: { radius: 40, diskResolution: 4, elevatedBase: true, cubeHeight: 80 },
    };
  }

  // --- Prism anchors: visible A/B endpoints in time-space ---
  if (dsType === 'prism-anchors') {
    return {
      id: `${datasetId}-layer-${ts}`,
      type: 'column',
      datasetId,
      label: 'Anchor Points (A/B)',
      isVisible: true,
      opacity: 0.9,
      color: [255, 100, 100],
      config: { radius: 55, diskResolution: 8, elevatedBase: true, cubeHeight: 120, colorByAnchorRole: true },
    };
  }

  // --- Fallback: generic GeoJsonLayer ---
  return {
    id: `${datasetId}-layer-${ts}`,
    type: 'geojson',
    datasetId,
    label,
    isVisible: true,
    opacity: 0.8,
    color: [18, 147, 154],
    config: { extruded: false, filled: true, stroked: true },
  };
}

// ===========================================================================
// Trajectory preprocessing: points → line segments for true 3D rendering
// ===========================================================================

/**
 * Build an array of {source, target} line segments from sorted Point features.
 * Each consecutive pair of points becomes one segment. LineLayer renders each
 * segment as a true 3D line between two positions — no flat-ribbon artifacts.
 */
export function buildLineSegments(
  dataset: GeoJSON.FeatureCollection,
): { source: [number, number, number]; target: [number, number, number]; properties: Record<string, unknown> }[] {
  const points = dataset.features.filter(f => f.geometry?.type === 'Point');
  if (points.length < 2) return [];

  const segments: { source: [number, number, number]; target: [number, number, number]; properties: Record<string, unknown> }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    // Don't connect points that belong to different users — each user is drawn
    // as its own path. (_user_id is undefined for both when no user column is
    // set, so single-trajectory rendering is unaffected.)
    if (points[i].properties?._user_id !== points[i + 1].properties?._user_id) continue;

    const cs = (points[i].geometry as GeoJSON.Point).coordinates;
    const ct = (points[i + 1].geometry as GeoJSON.Point).coordinates;
    const hs = points[i].properties?.[PROCESSED_HEIGHT_FIELD] ?? cs[2] ?? 0;
    const ht = points[i + 1].properties?.[PROCESSED_HEIGHT_FIELD] ?? ct[2] ?? 0;
    segments.push({
      source: [cs[0], cs[1], hs as number],
      target: [ct[0], ct[1], ht as number],
      properties: points[i].properties ?? {},
    });
  }
  return segments;
}

/**
 * Build line segments from LineString features (used for axes, tick marks).
 * Each LineString becomes one or more consecutive segments.
 */
function buildLineSegmentsFromLineStrings(
  dataset: GeoJSON.FeatureCollection,
): { source: [number, number, number]; target: [number, number, number] }[] {
  const segments: { source: [number, number, number]; target: [number, number, number] }[] = [];

  for (const f of dataset.features) {
    if (f.geometry?.type !== 'LineString') continue;
    const coords = (f.geometry as GeoJSON.LineString).coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const s = coords[i];
      const t = coords[i + 1];
      segments.push({
        source: [s[0], s[1], s[2] ?? 0],
        target: [t[0], t[1], t[2] ?? 0],
      });
    }
  }

  return segments;
}

/**
 * Build continuous PathLayer paths from the PPA road-network LineString edges.
 * Each edge becomes one path with its vertices lifted to time-height (or
 * flattened to the ground for the shadow layer). Forward/backward travel times
 * are normalised to [0,1] against the A→B budget and attached as fwd_norm /
 * bwd_norm so the GPU two-cone time filter can reveal the reachable slice at
 * any animation time t (fwd ≤ t AND bwd ≤ 1−t).
 */
function buildPpaPathsFromLineFeatures(
  dataset: GeoJSON.FeatureCollection,
  flattenToGround = false,
): { path: [number, number, number][]; properties: Record<string, unknown> }[] {
  const paths: { path: [number, number, number][]; properties: Record<string, unknown> }[] = [];

  const addPath = (coords: number[][], properties: Record<string, unknown>) => {
    const z = (properties[PROCESSED_HEIGHT_FIELD] as number) ?? null;
    const budget = (properties.total_budget_sec as number) || 0;
    const fwd = (properties.forward_sec as number) ?? 0;
    const bwd = (properties.backward_sec as number) ?? 0;
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const fwd_norm = budget > 0 ? clamp01(fwd / budget) : 0;
    const bwd_norm = budget > 0 ? clamp01(bwd / budget) : 0;
    const path = coords.map(
      c => [c[0], c[1], flattenToGround ? 0 : (z ?? c[2] ?? 0)] as [number, number, number],
    );
    paths.push({ path, properties: { ...properties, fwd_norm, bwd_norm } });
  };

  for (const f of dataset.features) {
    const properties = f.properties ?? {};
    if (f.geometry?.type === 'LineString') {
      addPath((f.geometry as GeoJSON.LineString).coordinates, properties);
    } else if (f.geometry?.type === 'MultiLineString') {
      for (const coords of (f.geometry as GeoJSON.MultiLineString).coordinates) {
        addPath(coords, properties);
      }
    }
  }

  return paths;
}

/**
 * Discrete space-time prism sheets for the regular map view — the same
 * forward∩backward cone slicing the Focused 3D View draws (see
 * prism-illustration.tsx slicePaths), but at the map's ORIGINAL z scale:
 * sheet i sits at z = zStart + frac·(zEnd − zStart), so the prism stays
 * aligned with the trajectory's time axis instead of being re-stretched.
 *
 * An edge appears on sheet i (elapsed time τ = frac·T) when it lies in both
 * cones: reachable from A by then (forward_sec ≤ τ) and still able to make B
 * on time (backward_sec ≤ T − τ). Edges lacking travel times fall back to the
 * single sheet nearest their time-window midpoint. The sheet count is capped
 * so edges × sheets stays bounded on large networks.
 */
export function buildPrismSheetPaths(
  roads: GeoJSON.FeatureCollection,
  zStart: number,
  zEnd: number,
  desiredSlices: number,
): {
  paths: { path: [number, number, number][]; properties: Record<string, unknown> }[];
  nSlices: number;
} {
  const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

  type SheetEdge = {
    coords: number[][];
    props: Record<string, unknown>;
    da: number | null;
    db: number | null;
    tp: number;
  };
  const edges: SheetEdge[] = [];
  let T = 0;
  for (const f of roads.features) {
    if (f.geometry?.type !== 'LineString') continue;
    const props = f.properties ?? {};
    const da = num(props.forward_sec);
    const db = num(props.backward_sec);
    const t = num(props.total_budget_sec);
    if (t != null && t > 0) T = t;
    // Outside the two-cone intersection — on no A→B path within the budget.
    if (da != null && db != null && t != null && t > 0 && da + db > t + 1e-6) continue;
    edges.push({
      coords: (f.geometry as GeoJSON.LineString).coordinates,
      props,
      da,
      db,
      tp: num(props._time_progress) ?? 0.5,
    });
  }
  if (edges.length === 0) return { paths: [], nSlices: 0 };

  type SheetPath = { path: [number, number, number][]; properties: Record<string, unknown> };
  const buildAt = (n: number): SheetPath[] => {
    const out: SheetPath[] = [];
    for (const e of edges) {
      for (let i = 0; i < n; i++) {
        const frac = n > 1 ? i / (n - 1) : 1;
        const tau = frac * T;
        const inSheet = e.da != null && e.db != null && T > 0
          ? e.da <= tau + 1e-6 && e.db <= T - tau + 1e-6
          : Math.round(e.tp * (n - 1)) === i;
        if (!inSheet) continue;
        const z = zStart + frac * (zEnd - zStart);
        out.push({
          path: e.coords.map(c => [c[0], c[1], z] as [number, number, number]),
          properties: { ...e.props, _sheet_frac: frac, [PROCESSED_TIME_FIELD]: frac },
        });
      }
    }
    return out;
  };

  // Budget on the ACTUAL rendered sheet count, not the edges × nSlices worst
  // case. The two-cone filter keeps most edges out of most slices, so the real
  // total runs well below that product. The old worst-case bound silently
  // collapsed dense networks (~28k edges → floor(300k/28k) ≈ 10 slices) no
  // matter how many the user requested; honor the request and step down only
  // if the rendered total actually overflows the budget.
  const MAX_RENDERED_PATHS = 300_000;
  let nSlices = Math.max(2, desiredSlices);
  let paths = buildAt(nSlices);
  while (paths.length > MAX_RENDERED_PATHS && nSlices > 2) {
    const fit = Math.floor(nSlices * (MAX_RENDERED_PATHS / paths.length));
    nSlices = Math.max(2, Math.min(nSlices - 1, fit));
    paths = buildAt(nSlices);
  }
  if (nSlices < desiredSlices) {
    console.warn(
      `buildPrismSheetPaths: clamped ${desiredSlices} → ${nSlices} time slices to stay ` +
      `under ${MAX_RENDERED_PATHS.toLocaleString()} rendered sheet paths ` +
      `(${edges.length.toLocaleString()} reachable edges).`,
    );
  }
  return { paths, nSlices };
}

function buildLineSegmentsFromLineFeatures(
  dataset: GeoJSON.FeatureCollection,
): { source: [number, number, number]; target: [number, number, number]; properties: Record<string, unknown> }[] {
  const segments: { source: [number, number, number]; target: [number, number, number]; properties: Record<string, unknown> }[] = [];

  const addSegments = (coords: number[][], properties: Record<string, unknown>) => {
    // Prefer the _height property (same source the trajectory uses) over geometry Z.
    const z = (properties[PROCESSED_HEIGHT_FIELD] as number) ?? null;
    for (let i = 0; i < coords.length - 1; i++) {
      const s = coords[i];
      const t = coords[i + 1];
      segments.push({
        source: [s[0], s[1], z ?? s[2] ?? 0],
        target: [t[0], t[1], z ?? t[2] ?? 0],
        properties,
      });
    }
  };

  for (const f of dataset.features) {
    const properties = f.properties ?? {};
    if (f.geometry?.type === 'LineString') {
      addSegments((f.geometry as GeoJSON.LineString).coordinates, properties);
    } else if (f.geometry?.type === 'MultiLineString') {
      for (const coords of (f.geometry as GeoJSON.MultiLineString).coordinates) {
        addSegments(coords, properties);
      }
    }
  }

  return segments;
}
