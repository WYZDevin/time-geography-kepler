/* eslint-disable @typescript-eslint/no-explicit-any */
import { GeoJsonLayer, ScatterplotLayer, PathLayer, TextLayer, LineLayer, ColumnLayer, PolygonLayer } from '@deck.gl/layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import type { DeckLayerDescriptor, MapDataset, AnimationMode } from '@/interfaces/map-types';
import { hexToRgb } from './color-schemes';
import { PROCESSED_HEIGHT_FIELD, PROCESSED_TIME_FIELD } from '@/utils/constants';

const HIGHLIGHT_COLOR: [number, number, number, number] = [255, 255, 0, 128];

export interface AnimationParams {
  progress: number;
  mode: AnimationMode;
  sliceCount: number;
}

/**
 * Build deck.gl Layer instances from declarative descriptors + datasets.
 * Called at render time — Layer objects are ephemeral, never stored in Redux.
 *
 * @param animationProgress — 0..1 time cutoff; only data with _time_order <= this value is shown.
 *                            Defaults to 1 (show everything).
 * @param animationMode — 'progressive' shows 0..T, 'window' shows only features at slice T
 * @param sliceCount — number of discrete slices (used for window half-width)
 */
export function createDeckLayers(
  descriptors: DeckLayerDescriptor[],
  datasets: Record<string, MapDataset>,
  animationProgress = 1,
  animationMode: AnimationMode = 'progressive',
  sliceCount = 0,
) {
  const anim: AnimationParams = { progress: animationProgress, mode: animationMode, sliceCount };
  const layers: any[] = [];
  for (const descriptor of descriptors) {
    if (!descriptor.isVisible) continue;
    const layer = buildLayer(descriptor, datasets[descriptor.datasetId], anim);
    if (Array.isArray(layer)) {
      layers.push(...layer.filter(Boolean));
    } else if (layer) {
      layers.push(layer);
    }
  }
  return layers;
}

/**
 * Check whether a feature's _time_order passes the animation filter.
 */
function passesTimeFilter(timeOrder: number, anim: AnimationParams): boolean {
  if (anim.progress >= 1) return true;
  if (anim.mode === 'progressive') {
    return timeOrder <= anim.progress;
  }
  // Window mode: show features within half a slice of current progress
  const halfWindow = anim.sliceCount > 0 ? 0.5 / anim.sliceCount : 0.05;
  return Math.abs(timeOrder - anim.progress) <= halfWindow;
}

function buildLayer(desc: DeckLayerDescriptor, dataset: MapDataset | undefined, anim: AnimationParams) {
  if (!dataset) return null;

  switch (desc.type) {
    case 'geojson':
      return buildGeoJsonLayer(desc, dataset, anim);
    case 'scatterplot':
      return buildScatterplotLayer(desc, dataset);
    case 'path':
      return buildPathLayer(desc, dataset, anim);
    case 'line':
      return buildLineLayer(desc, dataset, anim);
    case 'column':
      return buildColumnLayer(desc, dataset, anim);
    case 'text':
      return buildTextLayer(desc, dataset);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// GeoJsonLayer — polygons, lines, points (2D and 3D extruded)
// ---------------------------------------------------------------------------

function buildGeoJsonLayer(desc: DeckLayerDescriptor, dataset: MapDataset, anim: AnimationParams) {
  const cfg = desc.config;
  if (cfg.renderAs === 'polygon') {
    return buildPolygonLayerFromGeoJson(desc, dataset, anim);
  }

  const extruded = cfg.extruded === true;
  const animateByTime = cfg.animateByTime === true;
  let featureCollection = cfg.zBaseField
    ? liftPolygonFeaturesToZ(dataset.data, cfg.zBaseField as string)
    : dataset.data;

  if (animateByTime && anim.progress < 1) {
    featureCollection = {
      ...featureCollection,
      features: featureCollection.features.filter(
        f => passesTimeFilter(f.properties?.[PROCESSED_TIME_FIELD] ?? 0, anim),
      ),
    };
  }

  const colorAccessor = buildColorAccessor(desc);

  const solidLayer = new GeoJsonLayer({
    id: desc.id,
    data: featureCollection as any,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT_COLOR,
    opacity: desc.opacity,

    // Fill
    filled: (cfg.filled as boolean) !== false,
    getFillColor: colorAccessor as any,

    // Stroke
    stroked: (cfg.stroked as boolean) !== false,
    getLineColor: cfg.strokeColor
      ? (cfg.strokeColor as [number, number, number, number])
      : [...desc.color, 200] as [number, number, number, number],
    getLineWidth: (cfg.thickness as number) ?? 1,
    lineWidthUnits: 'pixels' as const,

    // 3D extrusion
    extruded,
    wireframe: cfg.wireframe === true,
    getElevation: extruded && cfg.heightField
      ? ((d: any) => d.properties?.[cfg.heightField as string] ?? 0)
      : 0,
    elevationScale: (cfg.elevationScale as number) ?? 1,
    material: cfg.material ?? true,
    parameters: cfg.parameters as any,
    _full3d: cfg.full3d === true,

    updateTriggers: {
      getFillColor: [desc.color, cfg.colorField, cfg.colorRange],
      getElevation: [cfg.heightField, cfg.elevationScale, anim.progress],
    },
  } as any);

  if (cfg.prismWireframe === true) {
    const wireframeSegments = buildPrismWireframeSegments(featureCollection, cfg.zBaseField as string | undefined);
    const wireframeLayer = new LineLayer({
      id: `${desc.id}-wireframe`,
      data: wireframeSegments as any,
      pickable: false,
      opacity: Math.min(1, desc.opacity + 0.35),
      getSourcePosition: (d: any) => d.source as [number, number, number],
      getTargetPosition: (d: any) => d.target as [number, number, number],
      getColor: (d: any) => d.color as [number, number, number, number],
      getWidth: 1.6,
      widthUnits: 'pixels' as const,
      widthMinPixels: 1,
      parameters: { depthTest: false },
    });
    return [solidLayer, wireframeLayer];
  }

  return solidLayer;
}

// ---------------------------------------------------------------------------
// ScatterplotLayer — point features (stay points, etc.)
// ---------------------------------------------------------------------------

function buildScatterplotLayer(desc: DeckLayerDescriptor, dataset: MapDataset) {
  const cfg = desc.config;

  return new ScatterplotLayer({
    id: desc.id,
    data: dataset.data.features as any,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT_COLOR,
    opacity: desc.opacity,
    filled: true,
    stroked: (cfg.stroked as boolean) !== false,

    getPosition: ((d: any) => (d.geometry as GeoJSON.Point).coordinates) as any,
    getRadius: cfg.radiusField
      ? ((d: any) => d.properties?.[cfg.radiusField as string] ?? 10)
      : (cfg.radius as number) ?? 10,
    radiusUnits: 'meters' as const,
    radiusMinPixels: (cfg.radiusMinPixels as number) ?? 2,
    radiusMaxPixels: (cfg.radiusMaxPixels as number) ?? 50,

    getFillColor: buildColorAccessor(desc) as any,
    getLineColor: [255, 255, 255, 200] as [number, number, number, number],
    getLineWidth: 1,
    lineWidthUnits: 'pixels' as const,

    updateTriggers: {
      getFillColor: [desc.color, cfg.colorField, cfg.colorRange],
      getRadius: [cfg.radiusField],
    },
  });
}

// ---------------------------------------------------------------------------
// PathLayer — trajectories, axes lines
// ---------------------------------------------------------------------------

function buildPathLayer(desc: DeckLayerDescriptor, _dataset: MapDataset, anim: AnimationParams) {
  const cfg = desc.config;

  // PathLayer expects data as array of path objects with a `path` property
  // (array of [lng, lat, z] coordinates). The deck-adapter prepares this.
  const pathData = (cfg.pathData ?? []) as any[];

  const layerProps: any = {
    id: desc.id,
    data: pathData,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT_COLOR,
    opacity: desc.opacity,

    getPath: (d: any) => d.path as [number, number, number][],
    getColor: (d: any) => d.properties?.color_rgba ?? [...desc.color, 220] as [number, number, number, number],
    getWidth: (cfg.widthScale as number) ?? 2,
    widthUnits: 'pixels' as const,
    widthMinPixels: (cfg.widthMinPixels as number) ?? 1,

    jointRounded: true,
    capRounded: true,

    // depthTest:false draws paths over solid geometry — the PPA prism is lifted
    // to "time" altitude where the depth buffer loses precision and Chrome's
    // ANGLE pipeline would otherwise depth-cull the lines entirely.
    parameters: cfg.depthTest === false ? { depthTest: false } : undefined,

    updateTriggers: {
      getColor: [desc.color],
    },
  };

  // GPU-side two-cone time filter (used by the PPA road network). The geometry
  // is uploaded once; each animation frame only updates the `filterRange`
  // uniform — no per-frame CPU filtering or buffer re-upload, so scrubbing
  // through time stays smooth even for tens of thousands of edges. Each path
  // carries its forward (A→edge) and backward (edge→B) travel times normalised
  // to [0,1]. At animation time t the reachable slice is { fwd ≤ t AND bwd ≤
  // 1−t }, so the PPA grows out of anchor A, peaks, and contracts into anchor
  // B — directly showing how the reachable region differs at each moment.
  if (cfg.timeFilter2D === true) {
    const t = anim.progress;
    layerProps.extensions = [new DataFilterExtension({ filterSize: 2 })];
    layerProps.getFilterValue = (d: any) =>
      [d.properties?.fwd_norm ?? 0, d.properties?.bwd_norm ?? 0] as [number, number];
    // progress ≥ 1 (not animating) → show the full PPA.
    layerProps.filterRange = t >= 1 ? [[0, 1], [0, 1]] : [[0, t], [0, 1 - t]];
  }

  // GPU sheet filter (used by the on-map prism sheets). Each path carries the
  // fraction of the time budget its sheet sits at; animating either reveals
  // sheets bottom-up (progressive) or isolates the one nearest the current
  // progress (window) — the prism cross-section sweeping from A to B. Same
  // upload-once / uniform-update pattern as the two-cone filter above.
  if (cfg.sheetFilter === true) {
    const t = anim.progress;
    layerProps.extensions = [new DataFilterExtension({ filterSize: 1 })];
    layerProps.getFilterValue = (d: any) => d.properties?._sheet_frac ?? 0;
    const half = anim.sliceCount > 0 ? 0.5 / anim.sliceCount : 0.05;
    layerProps.filterRange = t >= 1
      ? [0, 1]
      : anim.mode === 'progressive' ? [0, t + half] : [t - half, t + half];
  }

  return new PathLayer(layerProps);
}

// ---------------------------------------------------------------------------
// LineLayer — true 3D line segments (trajectories)
// ---------------------------------------------------------------------------

function buildLineLayer(desc: DeckLayerDescriptor, _dataset: MapDataset, anim: AnimationParams) {
  const cfg = desc.config;

  // LineLayer data: array of { source, target, properties } segments
  let segmentData = (cfg.segmentData ?? []) as any[];

  // Filter by animation progress
  if (anim.progress < 1) {
    segmentData = segmentData.filter(
      (s: any) => passesTimeFilter(s.properties?.[PROCESSED_TIME_FIELD] ?? 0, anim),
    );
  }

  return new LineLayer({
    id: desc.id,
    data: segmentData,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT_COLOR,
    opacity: desc.opacity,

    getSourcePosition: (d: any) => d.source as [number, number, number],
    getTargetPosition: (d: any) => d.target as [number, number, number],
    getColor: (d: any) => d.properties?.color_rgba ?? [...desc.color, 220] as [number, number, number, number],
    getWidth: (cfg.widthScale as number) ?? 2,
    widthUnits: 'pixels' as const,
    widthMinPixels: (cfg.widthMinPixels as number) ?? 1,

    // depthTest:false draws the line over solid geometry — needed for the STC
    // exposure path, which runs inside the cube columns and would otherwise be
    // occluded by the (semi-opaque) cube faces.
    parameters: cfg.depthTest === false ? { depthTest: false } : undefined,

    updateTriggers: {
      getColor: [desc.color],
    },
  });
}

// ---------------------------------------------------------------------------
// ColumnLayer — 3D boxes/cylinders (stay points, anchors)
// ---------------------------------------------------------------------------

function buildColumnLayer(desc: DeckLayerDescriptor, dataset: MapDataset, anim: AnimationParams) {
  const cfg = desc.config;
  let features = dataset.data.features;

  // Filter by animation progress
  if (anim.progress < 1) {
    features = features.filter(
      f => passesTimeFilter(f.properties?.[PROCESSED_TIME_FIELD] ?? 0, anim),
    );
  }

  // When elevatedBase is true the column floats at the feature's Z height
  // (cube in the air) instead of rising from the ground.
  const elevatedBase = cfg.elevatedBase === true;
  const colorByAnchorRole = cfg.colorByAnchorRole === true;

  return new ColumnLayer({
    id: desc.id,
    data: features as any,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT_COLOR,
    opacity: desc.opacity,

    getPosition: ((d: any) => {
      const geom = d.geometry as GeoJSON.Point;
      if (elevatedBase) {
        const z = d.properties?.[PROCESSED_HEIGHT_FIELD] ?? 0;
        return [geom.coordinates[0], geom.coordinates[1], z];
      }
      return [geom.coordinates[0], geom.coordinates[1]];
    }) as any,
    getElevation: elevatedBase
      ? (cfg.cubeHeight as number) ?? 100
      : (d: any) => d.properties?.[PROCESSED_HEIGHT_FIELD] ?? 100,
    diskResolution: (cfg.diskResolution as number) ?? 6,
    radius: (cfg.radius as number) ?? 30,
    extruded: true,
    elevationScale: 1,
    flatShading: elevatedBase,
    getFillColor: colorByAnchorRole
      ? ((d: any) => d.properties?.anchor_role === 'end_anchor'
        ? [33, 113, 181, 225]
        : [220, 50, 47, 225]) as any
      : [...desc.color, 200] as [number, number, number, number],

    updateTriggers: {
      getFillColor: [desc.color, colorByAnchorRole],
      getElevation: [PROCESSED_HEIGHT_FIELD, elevatedBase],
      getPosition: [PROCESSED_HEIGHT_FIELD, elevatedBase],
    },
  });
}

// ---------------------------------------------------------------------------
// TextLayer — axis labels, annotations
// ---------------------------------------------------------------------------

function buildTextLayer(desc: DeckLayerDescriptor, dataset: MapDataset) {
  const cfg = desc.config;

  return new TextLayer({
    id: desc.id,
    data: dataset.data.features as any,
    pickable: false,
    opacity: desc.opacity,

    getPosition: ((d: any) => (d.geometry as GeoJSON.Point).coordinates) as any,
    getText: (d: any) => String(d.properties?.[cfg.textField as string] ?? ''),
    getSize: (cfg.textSize as number) ?? 16,
    sizeScale: 1,
    sizeUnits: 'pixels' as const,
    sizeMinPixels: 10,
    sizeMaxPixels: 32,
    getColor: cfg.textColor
      ? (cfg.textColor as [number, number, number, number])
      : [0, 0, 0, 255],
    getTextAnchor: (cfg.textAnchor as 'start' | 'middle' | 'end') ?? 'start',
    getAlignmentBaseline: (cfg.alignmentBaseline as 'top' | 'center' | 'bottom') ?? 'center',
    getPixelOffset: [10, 0] as [number, number],

    outlineWidth: (cfg.outlineWidth as number) ?? 3,
    outlineColor: (cfg.outlineColor as [number, number, number, number]) ?? [255, 255, 255, 255],
    fontFamily: (cfg.fontFamily as string) ?? 'Monaco, monospace',
    fontWeight: 'bold',
    billboard: true,

    updateTriggers: {
      getText: [cfg.textField],
      getColor: [cfg.textColor],
    },
  });
}

// ---------------------------------------------------------------------------
// PolygonLayer — explicit XYZ polygons for elevated prism cross-sections
// ---------------------------------------------------------------------------

function buildPolygonLayerFromGeoJson(desc: DeckLayerDescriptor, dataset: MapDataset, anim: AnimationParams) {
  const cfg = desc.config;
  let polygonData = extractPolygonObjects(dataset.data, cfg.zBaseField as string | undefined);

  if (cfg.animateByTime === true && anim.progress < 1) {
    polygonData = polygonData.filter(
      d => passesTimeFilter(Number(d.properties?.[PROCESSED_TIME_FIELD] ?? 0), anim),
    );
  }

  const colorAccessor = buildColorAccessor(desc);

  const polygonLayer = new PolygonLayer({
    id: desc.id,
    data: polygonData as any,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT_COLOR,
    opacity: desc.opacity,

    getPolygon: (d: any) => d.polygon,
    filled: (cfg.filled as boolean) !== false,
    getFillColor: ((d: any) => typeof colorAccessor === 'function' ? colorAccessor({ properties: d.properties }) : colorAccessor) as any,

    stroked: false,
    extruded: cfg.extruded === true,
    wireframe: false,
    getElevation: cfg.extruded === true && cfg.heightField
      ? ((d: any) => d.properties?.[cfg.heightField as string] ?? 0)
      : 0,
    elevationScale: (cfg.elevationScale as number) ?? 1,
    material: cfg.material ?? true,
    parameters: cfg.parameters as any,
    _full3d: cfg.full3d === true,

    updateTriggers: {
      getFillColor: [desc.color, cfg.colorField, cfg.colorRange],
      getElevation: [cfg.heightField, cfg.elevationScale, anim.progress],
    },
  } as any);

  if (cfg.prismWireframe === true) {
    const wireframeLayer = new LineLayer({
      id: `${desc.id}-wireframe`,
      data: buildPrismWireframeSegmentsFromPolygons(polygonData) as any,
      pickable: false,
      opacity: Math.min(1, desc.opacity + 0.45),
      getSourcePosition: (d: any) => d.source as [number, number, number],
      getTargetPosition: (d: any) => d.target as [number, number, number],
      getColor: (d: any) => d.color as [number, number, number, number],
      getWidth: 1.8,
      widthUnits: 'pixels' as const,
      widthMinPixels: 1,
      parameters: { depthTest: false },
    });
    return [polygonLayer, wireframeLayer];
  }

  return polygonLayer;
}

// ---------------------------------------------------------------------------
// Prism geometry helpers
// ---------------------------------------------------------------------------

function extractPolygonObjects(
  featureCollection: GeoJSON.FeatureCollection,
  zBaseField?: string,
): { polygon: [number, number, number][][]; properties: Record<string, unknown> }[] {
  const objects: { polygon: [number, number, number][][]; properties: Record<string, unknown> }[] = [];

  for (const feature of featureCollection.features) {
    if (!feature.geometry) continue;
    const properties = feature.properties ?? {};
    const z = getFeatureZ(feature, zBaseField);

    if (feature.geometry.type === 'Polygon') {
      objects.push({
        polygon: liftPolygonForLayer(feature.geometry.coordinates as number[][][], z),
        properties,
      });
    } else if (feature.geometry.type === 'MultiPolygon') {
      for (const poly of feature.geometry.coordinates as number[][][][]) {
        objects.push({
          polygon: liftPolygonForLayer(poly, z),
          properties,
        });
      }
    }
  }

  return objects;
}

function liftPolygonForLayer(poly: number[][][], z: number): [number, number, number][][] {
  return poly.map(ring => {
    const lifted = ring.map(coord => [
      coord[0],
      coord[1],
      typeof coord[2] === 'number' ? coord[2] : z,
    ] as [number, number, number]);
    return ensureClosedRing(lifted);
  });
}

function ensureClosedRing(ring: [number, number, number][]): [number, number, number][] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1] && first[2] === last[2]) return ring;
  return [...ring, first];
}

function buildPrismWireframeSegmentsFromPolygons(
  polygonData: { polygon: [number, number, number][][]; properties: Record<string, unknown> }[],
): { source: [number, number, number]; target: [number, number, number]; color: [number, number, number, number] }[] {
  const segments: { source: [number, number, number]; target: [number, number, number]; color: [number, number, number, number] }[] = [];
  const outerRings = [...polygonData]
    .sort((a, b) => getPolygonObjectZ(a) - getPolygonObjectZ(b))
    .map(d => normalizeClosedRing(d.polygon[0] ?? []))
    .filter(ring => ring.length >= 3);

  for (const ring of outerRings) {
    for (let i = 0; i < ring.length; i++) {
      segments.push({
        source: ring[i],
        target: ring[(i + 1) % ring.length],
        color: [18, 44, 72, 235],
      });
    }
  }

  const ribsPerPair = 24;
  for (let i = 0; i < outerRings.length - 1; i++) {
    const a = outerRings[i];
    const b = outerRings[i + 1];
    for (let j = 0; j < ribsPerPair; j++) {
      const ai = Math.floor((j / ribsPerPair) * a.length) % a.length;
      const bi = Math.floor((j / ribsPerPair) * b.length) % b.length;
      segments.push({
        source: a[ai],
        target: b[bi],
        color: [17, 84, 143, 200],
      });
    }
  }

  return segments;
}

function getPolygonObjectZ(d: { polygon: [number, number, number][][] }): number {
  return d.polygon[0]?.[0]?.[2] ?? 0;
}

function liftPolygonFeaturesToZ(
  featureCollection: GeoJSON.FeatureCollection,
  zBaseField: string,
): GeoJSON.FeatureCollection {
  return {
    ...featureCollection,
    features: featureCollection.features.map(feature => {
      const z = feature.properties?.[zBaseField] ?? feature.properties?.z;
      if (typeof z !== 'number' || !feature.geometry) return feature;

      if (feature.geometry.type === 'Polygon') {
        return {
          ...feature,
          geometry: {
            ...feature.geometry,
            coordinates: liftPolygonCoords(feature.geometry.coordinates as any, z),
          } as GeoJSON.Polygon,
        };
      }

      if (feature.geometry.type === 'MultiPolygon') {
        return {
          ...feature,
          geometry: {
            ...feature.geometry,
            coordinates: (feature.geometry.coordinates as any).map((poly: any) => liftPolygonCoords(poly, z)),
          } as GeoJSON.MultiPolygon,
        };
      }

      return feature;
    }),
  };
}

function liftPolygonCoords(poly: number[][][], z: number): number[][][] {
  return poly.map(ring => ring.map(coord => [coord[0], coord[1], z]));
}

function buildPrismWireframeSegments(
  featureCollection: GeoJSON.FeatureCollection,
  zBaseField?: string,
): { source: [number, number, number]; target: [number, number, number]; color: [number, number, number, number] }[] {
  const segments: { source: [number, number, number]; target: [number, number, number]; color: [number, number, number, number] }[] = [];
  const sliceRings: [number, number, number][][] = [];

  const addRingSegments = (ring: number[][], zFallback: number) => {
    if (ring.length < 2) return;

    const liftedRing = ring.map(coord => [
      coord[0],
      coord[1],
      typeof coord[2] === 'number' ? coord[2] : zFallback,
    ] as [number, number, number]);

    for (let i = 0; i < liftedRing.length - 1; i++) {
      segments.push({
        source: liftedRing[i],
        target: liftedRing[i + 1],
        color: [18, 44, 72, 230],
      });
    }
    sliceRings.push(liftedRing);
  };

  const sortedFeatures = [...featureCollection.features].sort((a, b) => {
    const az = getFeatureZ(a, zBaseField);
    const bz = getFeatureZ(b, zBaseField);
    return az - bz;
  });

  for (const feature of sortedFeatures) {
    const z = getFeatureZ(feature, zBaseField);
    if (feature.geometry?.type === 'Polygon') {
      const rings = feature.geometry.coordinates as number[][][];
      addRingSegments(rings[0] ?? [], z);
    } else if (feature.geometry?.type === 'MultiPolygon') {
      const polys = feature.geometry.coordinates as number[][][][];
      for (const poly of polys) {
        addRingSegments(poly[0] ?? [], z);
      }
    }
  }

  const ribsPerPair = 18;
  for (let i = 0; i < sliceRings.length - 1; i++) {
    const a = normalizeClosedRing(sliceRings[i]);
    const b = normalizeClosedRing(sliceRings[i + 1]);
    if (a.length < 3 || b.length < 3) continue;

    for (let j = 0; j < ribsPerPair; j++) {
      const ai = Math.floor((j / ribsPerPair) * a.length) % a.length;
      const bi = Math.floor((j / ribsPerPair) * b.length) % b.length;
      segments.push({
        source: a[ai],
        target: b[bi],
        color: [17, 84, 143, 185],
      });
    }
  }

  return segments;
}

function getFeatureZ(feature: GeoJSON.Feature, zBaseField?: string): number {
  const props = feature.properties ?? {};
  const z = zBaseField ? props[zBaseField] : props.z;
  if (typeof z === 'number') return z;
  if (typeof props.z === 'number') return props.z;

  const geom = feature.geometry;
  if (geom?.type === 'Polygon') {
    const coord = geom.coordinates?.[0]?.[0];
    return typeof coord?.[2] === 'number' ? coord[2] : 0;
  }
  if (geom?.type === 'MultiPolygon') {
    const coord = geom.coordinates?.[0]?.[0]?.[0];
    return typeof coord?.[2] === 'number' ? coord[2] : 0;
  }
  return 0;
}

function normalizeClosedRing(ring: [number, number, number][]): [number, number, number][] {
  if (ring.length <= 1) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1] && first[2] === last[2]) {
    return ring.slice(0, -1);
  }
  return ring;
}

// ---------------------------------------------------------------------------
// Color accessor builder
// ---------------------------------------------------------------------------

type RGBAColor = [number, number, number, number];

function interpolateColor(palette: RGBAColor[], t: number): RGBAColor {
  if (palette.length === 1) return palette[0];

  const scaled = t * (palette.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(lowerIndex + 1, palette.length - 1);
  const localT = scaled - lowerIndex;
  const lower = palette[lowerIndex];
  const upper = palette[upperIndex];

  return [
    Math.round(lower[0] + (upper[0] - lower[0]) * localT),
    Math.round(lower[1] + (upper[1] - lower[1]) * localT),
    Math.round(lower[2] + (upper[2] - lower[2]) * localT),
    Math.round(lower[3] + (upper[3] - lower[3]) * localT),
  ];
}

function buildColorAccessor(
  desc: DeckLayerDescriptor,
): RGBAColor | ((d: any) => RGBAColor) {
  const cfg = desc.config;
  const baseColor: RGBAColor = [...desc.color, 255];

  // If no color field mapping, return flat color
  if (!cfg.colorField || !cfg.colorRange) {
    return baseColor;
  }

  const colorField = cfg.colorField as string;
  const colorRange = cfg.colorRange as string[];

  // Convert hex palette to RGB if needed
  const rgbPalette: RGBAColor[] = colorRange.map(c => {
    if (c.startsWith('#')) {
      const rgb = hexToRgb(c);
      return [...rgb, 255] as RGBAColor;
    }
    return baseColor;
  });

  if (rgbPalette.length === 0) return baseColor;

  // Build a continuous low-to-high gradient across every palette stop.
  return (d: any): RGBAColor => {
    const val = d.properties?.[colorField];
    if (val == null || typeof val !== 'number') return baseColor;

    const domain = cfg.colorDomain as [number, number] | undefined;
    if (!domain) return rgbPalette[0];

    const t = Math.max(0, Math.min(1, (val - domain[0]) / (domain[1] - domain[0] || 1)));
    return interpolateColor(rgbPalette, t);
  };
}
