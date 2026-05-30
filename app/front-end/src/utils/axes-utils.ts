import { FeatureCollection, GeoJSONFeature } from '@/interfaces/data-interfaces';
import { ToolUtils } from '@/tools/tool-utils';
import { PROCESSED_HEIGHT_FIELD } from '@/utils/constants';

// ========================================
// Types
// ========================================

export interface AxesContext {
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  timestamps: number[];
  totalAltitude: number;
  // Per-user elapsed times (ms from each user's own start). Present only when
  // the 3D Trajectory tool runs with "Align User Start Times" enabled; when set,
  // the Z-axis is labeled as elapsed time (Day 1…Day n) instead of absolute dates.
  elapsedMs?: number[];
}

export interface AxesOptions {
  timeBreaks?: 'auto' | '1h' | '4h' | '12h' | '24h';
}

// Fixed dataset IDs — deck.gl replaces rather than duplicates on each run
const SHARED_AXES_ID = 'shared-axes';
const SHARED_AXES_LABELS_ID = 'shared-axes-labels';

// ========================================
// Public API
// ========================================

/**
 * Scan output FeatureCollections to compute axes context (bounds, timestamps, altitude).
 * Returns null if no 3D data is detected.
 */
export function extractAxesContext(outputs: FeatureCollection[]): AxesContext | null {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  const timestamps: number[] = [];
  const elapsedValues: number[] = [];
  let maxZ = 0;

  for (const fc of outputs) {
    for (const f of fc.features) {
      const geom = f.geometry;
      if (!geom) continue;

      // Collect coordinates from Point or LineString geometries
      const coordsList: number[][] = [];
      if (geom.type === 'Point') {
        coordsList.push(geom.coordinates);
      } else if (geom.type === 'LineString') {
        coordsList.push(...geom.coordinates);
      } else if (geom.type === 'MultiLineString') {
        for (const line of geom.coordinates) {
          coordsList.push(...line);
        }
      } else if (geom.type === 'Polygon') {
        for (const ring of geom.coordinates) {
          coordsList.push(...ring);
        }
      } else if (geom.type === 'MultiPolygon') {
        for (const polygon of geom.coordinates) {
          for (const ring of polygon) {
            coordsList.push(...ring);
          }
        }
      }

      for (const coords of coordsList) {
        const [lng, lat, z] = coords;
        if (typeof lng === 'number' && typeof lat === 'number') {
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
        if (typeof z === 'number') {
          maxZ = Math.max(maxZ, z);
        }
      }

      // Collect timestamps
      const ts = f.properties?._timestamp;
      if (typeof ts === 'number') {
        timestamps.push(ts);
      }

      // Collect per-user elapsed times (only set when user-time alignment is on)
      const el = f.properties?._elapsed_ms;
      if (typeof el === 'number') {
        elapsedValues.push(el);
      }

      // Check _height property for STKDE-style outputs
      const h = f.properties?.[PROCESSED_HEIGHT_FIELD];
      if (typeof h === 'number') {
        const zBase = (f.properties?.z as number) || 0;
        maxZ = Math.max(maxZ, zBase + h);
      }
    }
  }

  // No spatial data found
  if (minLng === Infinity) return null;

  // No 3D data detected (no Z coordinates, no timestamps, no heights)
  if (maxZ === 0 && timestamps.length === 0) return null;

  const totalAltitude = maxZ > 0
    ? maxZ + Math.max(maxZ * 0.05, 10) // add padding
    : ToolUtils.calculateOptimalZAxisHeight(minLng, maxLng, minLat, maxLat);

  return {
    bounds: { minLng, maxLng, minLat, maxLat },
    timestamps,
    totalAltitude,
    elapsedMs: elapsedValues,
  };
}

/**
 * Generate shared axes FeatureCollections (lines + labels) from an AxesContext.
 */
export function createSharedAxes(
  context: AxesContext,
  options?: AxesOptions
): { axes: FeatureCollection; labels: FeatureCollection } {
  const { bounds, timestamps, totalAltitude } = context;
  const { minLng, maxLng, minLat, maxLat } = bounds;

  const paddingX = Math.max((maxLng - minLng) * 0.05, 0.001);
  const paddingY = Math.max((maxLat - minLat) * 0.05, 0.001);

  const xExt = maxLng - minLng;
  const yExt = maxLat - minLat;
  const lineLenX = xExt > 0 ? xExt : 0.05;
  const lineLenY = yExt > 0 ? yExt : 0.05;

  // Base axis lines
  const axesLines: GeoJSONFeature[] = [
    // X-axis (longitude)
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[minLng, minLat, 0], [minLng + lineLenX + paddingX, minLat, 0]] },
      properties: { axis_type: 'x_axis', label: '' }
    },
    // Y-axis (latitude)
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[minLng, minLat, 0], [minLng, minLat + lineLenY + paddingY, 0]] },
      properties: { axis_type: 'y_axis', label: '' }
    },
    // Z-axis (time)
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[minLng, minLat, 0], [minLng, minLat, totalAltitude]] },
      properties: { axis_type: 'z_axis', label: '' }
    }
  ];

  // Base axis endpoint labels
  const axesLabels: GeoJSONFeature[] = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [minLng + lineLenX + paddingX, minLat, 0] },
      properties: { axis_type: 'label', axis_label_text: 'X (Longitude)' }
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [minLng, minLat + lineLenY + paddingY, 0] },
      properties: { axis_type: 'label', axis_label_text: 'Y (Latitude)' }
    }
  ];

  // Time labels along Z-axis.
  // Elapsed-time mode (per-user alignment): label as "Day 1…Day n" relative to
  // each user's own start instead of absolute dates.
  const elapsedMs = context.elapsedMs ?? [];
  const maxElapsed = elapsedMs.length > 0 ? Math.max(...elapsedMs) : 0;

  if (maxElapsed > 0) {
    const tickLengthX = lineLenX * 0.05;
    const tickLengthY = lineLenY * 0.05;
    let lastLabel: string | null = null;
    for (const e of computeElapsedBreaks(maxElapsed)) {
      const label = formatElapsed(e);
      if (label === lastLabel) continue; // avoid duplicate adjacent day labels
      lastLabel = label;
      const labelAlt = totalAltitude * (e / maxElapsed);

      axesLines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[minLng, minLat, labelAlt], [minLng + tickLengthX, minLat, labelAlt]] },
        properties: { axis_type: 'z_tick', label: '' }
      });
      axesLines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[minLng, minLat, labelAlt], [minLng, minLat + tickLengthY, labelAlt]] },
        properties: { axis_type: 'z_tick', label: '' }
      });
      axesLabels.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [minLng, minLat, labelAlt] },
        properties: { axis_type: 'label', axis_label_text: label }
      });
    }

    // Z-axis title at top
    axesLabels.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [minLng, minLat, totalAltitude + (totalAltitude * 0.05)] },
      properties: { axis_type: 'label', axis_label_text: 'Z (Elapsed)' }
    });
  } else if (timestamps.length > 0) {
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const timeSpan = maxTime - minTime;

    const isMultiDay = new Date(minTime).toDateString() !== new Date(maxTime).toDateString();
    const formatLabel = (timeMs: number) => {
      return isMultiDay
        ? new Date(timeMs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : new Date(timeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const timeBreakOption = options?.timeBreaks || 'auto';
    let intervalMs: number | null = null;
    if (timeBreakOption === '1h') intervalMs = 60 * 60 * 1000;
    else if (timeBreakOption === '4h') intervalMs = 4 * 60 * 60 * 1000;
    else if (timeBreakOption === '12h') intervalMs = 12 * 60 * 60 * 1000;
    else if (timeBreakOption === '24h') intervalMs = 24 * 60 * 60 * 1000;

    if (intervalMs !== null && timeSpan > 0) {
      // Prevent excessive labels by dynamically widening the interval
      const maxVisualLabels = 10;
      let effectiveIntervalMs = intervalMs;
      while ((timeSpan / effectiveIntervalMs) > maxVisualLabels) {
        effectiveIntervalMs *= 2;
      }

      const maxLabels = 50;
      let count = 0;
      const ms15 = 15 * 60 * 1000;
      let currTime = Math.round(minTime / ms15) * ms15;

      while (currTime <= maxTime + (effectiveIntervalMs * 0.1) && count < maxLabels) {
        const labelAlt = totalAltitude * ((currTime - minTime) / timeSpan);
        const tickLengthX = lineLenX * 0.05;
        const tickLengthY = lineLenY * 0.05;

        // Horizontal tick marks at each time interval
        axesLines.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[minLng, minLat, labelAlt], [minLng + tickLengthX, minLat, labelAlt]] },
          properties: { axis_type: 'z_tick', label: '' }
        });
        axesLines.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[minLng, minLat, labelAlt], [minLng, minLat + tickLengthY, labelAlt]] },
          properties: { axis_type: 'z_tick', label: '' }
        });

        axesLabels.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [minLng, minLat, labelAlt] },
          properties: { axis_type: 'label', axis_label_text: formatLabel(currTime) }
        });
        currTime += effectiveIntervalMs;
        count++;
      }

      // Z-axis title at top
      axesLabels.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [minLng, minLat, totalAltitude + (totalAltitude * 0.05)] },
        properties: { axis_type: 'label', axis_label_text: 'Z (Time)' }
      });

    } else {
      // Auto mode: min/max bounds only
      const ms15 = 15 * 60 * 1000;
      const roundedMin = Math.round(minTime / ms15) * ms15;
      const roundedMax = Math.round(maxTime / ms15) * ms15;

      axesLabels.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [minLng, minLat, 0] },
        properties: { axis_type: 'label', axis_label_text: formatLabel(roundedMin) }
      });
      axesLabels.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [minLng, minLat, totalAltitude] },
        properties: { axis_type: 'label', axis_label_text: `Z: ${formatLabel(roundedMax)}` }
      });
    }
  }

  const axesLayerConfig = createAxesLayerConfig(SHARED_AXES_ID, 'Coordinate Axes', [150, 150, 150]);
  const labelsLayerConfig = createLabelsLayerConfig(SHARED_AXES_LABELS_ID, 'Axis Labels');

  return {
    axes: {
      type: 'FeatureCollection',
      features: axesLines.map(f => ({
        ...f,
        properties: {
          ...f.properties,
          _dataset_type: SHARED_AXES_ID,
          _layer_config: axesLayerConfig,
          _geojson: JSON.stringify(f.geometry)
        }
      }))
    },
    labels: {
      type: 'FeatureCollection',
      features: axesLabels.map(f => ({
        ...f,
        properties: {
          ...f.properties,
          _dataset_type: SHARED_AXES_LABELS_ID,
          _layer_config: labelsLayerConfig,
          _geojson: JSON.stringify(f.geometry)
        }
      }))
    }
  };
}

// ========================================
// Elapsed-time helpers (per-user alignment)
// ========================================

const DAY_MS = 86_400_000;

// Tick positions (in elapsed ms) for the elapsed-time Z-axis: one per day when
// the span covers at least a day, otherwise start / middle / end.
function computeElapsedBreaks(maxElapsed: number): number[] {
  if (maxElapsed <= 0) return [0];
  if (maxElapsed >= DAY_MS) {
    const breaks: number[] = [];
    // Cap at a reasonable number of daily ticks to avoid label clutter.
    const step = Math.max(1, Math.ceil(maxElapsed / DAY_MS / 12)) * DAY_MS;
    for (let t = 0; t <= maxElapsed; t += step) breaks.push(t);
    if (breaks[breaks.length - 1] !== maxElapsed) breaks.push(maxElapsed);
    return breaks;
  }
  return [0, maxElapsed / 2, maxElapsed];
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs === 0 || elapsedMs >= DAY_MS) {
    return `Day ${Math.floor(elapsedMs / DAY_MS) + 1}`;
  }
  const hours = elapsedMs / 3600_000;
  if (hours >= 1) return `+${Math.round(hours)}h`;
  return `+${Math.round(elapsedMs / 60_000)}m`;
}

// ========================================
// Layer Configuration Builders
// ========================================

export function createAxesLayerConfig(dataId: string, label: string, color: number[]) {
  return {
    type: 'geojson',
    config: {
      dataId,
      columnMode: 'geojson',
      label,
      columns: { geojson: '_geojson' },
      isVisible: true,
      color,
      visConfig: {
        opacity: 0.6,
        strokeOpacity: 0.6,
        thickness: 1.5,
        radius: 1,
        sizeRange: [0, 10],
        radiusRange: [0, 50],
        heightRange: [0, 500],
        elevationScale: 1,
        stroked: true,
        filled: false,
        enable3d: true,
        wireframe: false,
        fixedHeight: true
      },
      hidden: false,
      textLabel: [],
      heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'real' }
    },
    visualChannels: {
      heightScale: 'linear',
      colorField: null,
      colorScale: 'quantile',
      strokeColorField: null,
      strokeColorScale: 'quantile',
      sizeField: null,
      sizeScale: 'linear'
    }
  };
}

export function createLabelsLayerConfig(dataId: string, label: string) {
  return {
    type: 'point',
    config: {
      dataId,
      columnMode: 'geojson',
      label,
      columns: { geojson: '_geojson' },
      isVisible: true,
      color: [255, 255, 255],
      visConfig: {
        opacity: 0,
        outline: false,
        thickness: 1,
        strokeColor: null,
        radius: 1,
        fixedRadius: false,
        allowHover: false,
        showNeighborOnHover: false,
        showHighlightColor: false
      },
      hidden: false,
      textLabel: [
        {
          field: { name: 'axis_label_text', type: 'string' },
          color: [255, 255, 255],
          size: 16,
          offset: [15, 0],
          anchor: 'start',
          alignment: 'center',
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 255],
          background: false
        }
      ]
    },
    visualChannels: {
      colorField: null,
      colorScale: 'quantile',
      strokeColorField: null,
      strokeColorScale: 'quantile',
      sizeField: null,
      sizeScale: 'linear'
    }
  };
}
