import { SimpleTool, ToolOptionSchema } from '@/interfaces/simple-tool';
import { FeatureCollection, GeoJSONFeature } from '@/interfaces/data-interfaces';
import { AttributeMapping, getProperty } from '@/interfaces/attribute-mapping';
import { ToolUtils, ProgressReporter } from './tool-utils';
import { PROCESSED_TIME_FIELD, PROCESSED_NEIGHBORS_FIELD, PROCESSED_HEIGHT_FIELD, COLORS } from '@/utils/constants';

/**
 * 3D Trajectory Visualization Tool
 *
 * Converts trajectory point data (lat, lng, timestamp) into a 3D space-time path
 * where X = longitude, Y = latitude, Z = time. Features include:
 * - 3D trajectory lines connecting consecutive points elevated by time
 * - Optional stay point detection and visualization
 * - Optional 3D coordinate axes with time labels
 */
export class TimeGeographyTool implements SimpleTool {
  id = 'time-geography';
  name = '3D Trajectory';
  description = 'Visualize movement trajectories in 3D space-time (X=longitude, Y=latitude, Z=time)';
  icon = '🕐';
  category = 'visualization' as const;
  version = '2.0.0';
  capabilities = {
    // TEMPORARY: all computation moved to the backend; browser execution is
    // disabled. Restore 'frontend_only' to re-enable the analyze() path below.
    executionPolicy: 'backend_only' as const,
    recommendations: {
      frontendMaxRows: 100000,
      notes: ['Large trajectories (>50k points) may cause slower rendering'],
    },
  };

  attributeMapping: AttributeMapping = {
    time: 'timestamp'
  };

  getOptionSchema(): ToolOptionSchema[] {
    return [
      {
        key: 'showAxes',
        label: 'Show 3D Axis',
        description: 'Draw the X/Y/Z reference axes around the space-time path to help orient the view in space and time.',
        type: 'boolean',
        defaultValue: true,
        group: 'Display'
      },
      {
        key: 'show2D',
        label: 'Show 2D Ground Path',
        description: 'Also draw the trajectory flattened onto the map plane (Z=0) — the route as seen from above.',
        type: 'boolean',
        defaultValue: false,
        group: 'Display'
      },
      {
        key: 'timeBreaks',
        label: 'Z-Axis Time Labels Interval',
        description: 'How often to label the vertical time (Z) axis. "Auto" shows only the start and end times; the fixed intervals add evenly spaced tick labels.',
        type: 'select',
        defaultValue: 'auto',
        options: [
          { label: 'Auto (Min/Max Only)', value: 'auto' },
          { label: 'Every 1 Hour', value: '1h' },
          { label: 'Every 4 Hours', value: '4h' },
          { label: 'Every 12 Hours', value: '12h' },
          { label: 'Every 24 Hours', value: '24h' }
        ],
        group: 'Display'
      },
      {
        key: 'userIdField',
        label: 'User ID Column',
        note: 'Only for multi-user trajectory data',
        description: 'Split the trajectory by this column — each user is drawn as its own distinctly-colored path',
        type: 'field',
        defaultValue: '',
        group: 'Trajectory & time alignment'
      },
      {
        key: 'alignUserTime',
        label: 'Align User Start Times',
        note: 'Only for multi-user trajectory data',
        requires: 'userIdField',
        description: 'When a User ID column is set and multiple users exist, start every user at the same ground level so the Z-axis shows elapsed time (Day 1…Day n) instead of absolute time. Useful when users were tracked over different date ranges.',
        type: 'boolean',
        defaultValue: false,
        group: 'Trajectory & time alignment'
      },
      {
        key: 'visualizeStay',
        label: 'Visualize Stay Points',
        description: 'Detect and highlight stay points — places where the subject lingered instead of moving — as separate markers on top of the trajectory.',
        type: 'boolean',
        defaultValue: false,
        group: 'Stay points'
      },
      {
        key: 'stayField',
        label: 'Stay Location Field',
        description: 'Optional. Column whose value marks a stay: consecutive points sharing the same value are grouped into one stay. Leave empty to detect stays automatically from the time window below.',
        type: 'field',
        defaultValue: '',
        requires: 'visualizeStay',
        group: 'Stay points'
      },
      {
        key: 'timeWindow',
        label: 'Stay Point Time Window (hours)',
        description: 'Used when no Stay Location Field is set: points clustered within this many hours near the same location are treated as a single stay.',
        type: 'number',
        defaultValue: 24,
        min: 1,
        max: 168,
        requires: 'visualizeStay',
        group: 'Stay points'
      }
    ];
  }

  async analyze(
    data: FeatureCollection,
    options: Record<string, unknown>,
    attributes?: AttributeMapping
  ): Promise<FeatureCollection[]> {
    const progress = new ProgressReporter(options.onProgress as ((progress: number, message?: string) => void) | undefined);

    try {
      progress.report(10, 'Preprocessing trajectory data...');

      if (!ToolUtils.isValidGeoJSON(data)) {
        console.error('Invalid GeoJSON data provided');
        return [ToolUtils.emptyResult()];
      }

      const timeField = attributes?.time || this.attributeMapping.time;
      const latField = 'latitude';
      const lngField = 'longitude';
      const userIdField = (options.userIdField as string || '').trim();
      const alignUserTime = options.alignUserTime === true;

      if (!timeField) {
        console.error('Time field mapping is required for trajectory visualization');
        return [ToolUtils.emptyResult()];
      }

      progress.report(30, 'Sorting and projecting trajectory to 3D...');

      const preprocessedData = this._preprocessData(data, timeField, latField, lngField, userIdField, alignUserTime);

      if (preprocessedData.features.length === 0) {
        console.error('No valid trajectory points found');
        return [ToolUtils.emptyResult()];
      }

      progress.report(60, 'Building visualization layers...');

      const results = this._createVisualizationDatasets(
        preprocessedData,
        options,
        latField,
        lngField
      );

      progress.report(100, 'Complete');
      return results;

    } catch (error) {
      console.error('3D Trajectory visualization error:', error);
      return [ToolUtils.emptyResult()];
    }
  }

  /**
   * Preprocess trajectory data - sort by time, calculate neighbors, and map time to Z-axis
   */
  private _preprocessData(
    data: FeatureCollection,
    timeField: string,
    latField: string,
    lngField: string,
    userIdField?: string,
    alignUserTime?: boolean
  ): FeatureCollection {
    const validFeatures = data.features
      .map((feature, index) => {
        const coords = (feature.geometry as any).coordinates;
        if (!coords) return null;

        const [lng, lat] = coords;
        const timeValue = getProperty(feature, timeField);

        if (timeValue == null || timeValue === '') return null;

        const timestamp = parseTimestamp(timeValue);
        if (isNaN(timestamp)) return null;

        const userId = userIdField
          ? String(getProperty(feature, userIdField) ?? 'unknown')
          : undefined;

        return {
          ...feature,
          properties: {
            ...feature.properties,
            _timestamp: timestamp,
            _original_index: index,
            _user_id: userId,
            [latField]: lat,
            [lngField]: lng
          }
        };
      })
      .filter(Boolean) as GeoJSONFeature[];

    // Sort so each user's points are contiguous and time-ordered. Without a
    // user column this is a plain chronological sort (single trajectory).
    validFeatures.sort((a, b) => {
      if (userIdField) {
        const ua = a!.properties!._user_id as string;
        const ub = b!.properties!._user_id as string;
        if (ua !== ub) return ua < ub ? -1 : 1;
      }
      return a!.properties!._timestamp - b!.properties!._timestamp;
    });

    // Time axis is shared across all users so trajectories are comparable.
    const timeExtent = [
      Math.min(...validFeatures.map(f => f.properties!._timestamp)),
      Math.max(...validFeatures.map(f => f.properties!._timestamp))
    ];
    const timeRange = timeExtent[1] - timeExtent[0];

    // Assign each distinct user a stable index (and therefore a distinct color),
    // in order of first appearance.
    const userIndex = new Map<string, number>();
    if (userIdField) {
      for (const f of validFeatures) {
        const uid = f.properties!._user_id as string;
        if (!userIndex.has(uid)) userIndex.set(uid, userIndex.size);
      }
    }

    // Per-user time alignment: when enabled and there is more than one user,
    // shift each trajectory by a whole number of days so every user starts on
    // the same date, while preserving the original clock time of each
    // observation. Elapsed time is measured from the midnight of each user's
    // first day, and the Z-axis spans the longest date range across all users.
    const align = !!userIdField && alignUserTime === true && userIndex.size > 1;
    const userStartDay = new Map<string, number>();
    let maxElapsed = 0;
    if (align) {
      for (const f of validFeatures) {
        const uid = f.properties!._user_id as string;
        const day = startOfDay(f.properties!._timestamp as number);
        const cur = userStartDay.get(uid);
        if (cur === undefined || day < cur) userStartDay.set(uid, day);
      }
      for (const f of validFeatures) {
        const uid = f.properties!._user_id as string;
        const e = (f.properties!._timestamp as number) - (userStartDay.get(uid) as number);
        if (e > maxElapsed) maxElapsed = e;
      }
    }

    // When aligning, the displayed/animated timeline is the normalized one:
    // every trajectory is re-anchored to the midnight of the earliest day, so
    // the time slider, time read-out and slice count all span the longest date
    // range (~elapsed) instead of the raw calendar spread. Time-of-day is kept
    // because the shift is a whole number of days.
    const alignAnchor = align ? startOfDay(timeExtent[0]) : 0;

    const bounds = ToolUtils.getBounds(validFeatures);
    let TOTAL_HEIGHT_METERS = 1000;
    if (bounds) {
      TOTAL_HEIGHT_METERS = ToolUtils.calculateOptimalZAxisHeight(bounds.minLng, bounds.maxLng, bounds.minLat, bounds.maxLat);
    }

    const processedFeatures = validFeatures.map((feature, index) => {
      let timeProgress: number;
      let elapsedMs: number | undefined;
      if (align) {
        const uid = feature.properties!._user_id as string;
        elapsedMs = (feature.properties!._timestamp as number) - (userStartDay.get(uid) as number);
        timeProgress = maxElapsed > 0 ? elapsedMs / maxElapsed : 0;
      } else {
        timeProgress = timeRange > 0
          ? (feature.properties!._timestamp - timeExtent[0]) / timeRange
          : 0;
      }
      const scaledHeight = timeProgress * TOTAL_HEIGHT_METERS;

      const geom = feature.geometry as any;
      const [lng, lat] = geom.coordinates;

      // Neighbors connect only points belonging to the same user, so distinct
      // users never get linked into one path.
      const uid = feature.properties!._user_id;
      const neighbors: number[] = [];
      if (index > 0 && validFeatures[index - 1].properties!._user_id === uid) {
        neighbors.push(index - 1);
      }
      if (index < validFeatures.length - 1 && validFeatures[index + 1].properties!._user_id === uid) {
        neighbors.push(index + 1);
      }

      const colorRgba = userIdField
        ? [...colorForUserIndex(userIndex.get(uid as string) ?? 0), 220]
        : undefined;

      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: [lng, lat, scaledHeight]
        },
        properties: {
          ...feature.properties,
          [PROCESSED_TIME_FIELD]: timeProgress,
          [PROCESSED_HEIGHT_FIELD]: scaledHeight,
          [PROCESSED_NEIGHBORS_FIELD]: neighbors,
          ...(colorRgba ? { color_rgba: colorRgba } : {}),
          ...(elapsedMs !== undefined
            ? { _elapsed_ms: elapsedMs, _timestamp: alignAnchor + elapsedMs }
            : {}),
          _time_progress: timeProgress,
          _sequence: index
        }
      };
    });

    return {
      type: 'FeatureCollection',
      features: processedFeatures
    };
  }

  /**
   * Create visualization datasets based on enabled options
   */
  private _createVisualizationDatasets(
    preprocessedData: FeatureCollection,
    options: Record<string, unknown>,
    latField: string,
    lngField: string
  ): FeatureCollection[] {
    const results: FeatureCollection[] = [];

    const heightScale = options.heightScale as number | undefined;

    // 1. Main trajectory dataset (always produced)
    const trajectoryData: FeatureCollection = {
      ...preprocessedData,
      features: preprocessedData.features.map(f => ({
        ...f,
        properties: {
          ...f.properties,
          _dataset_type: 'time-geography-trajectory',
          _layer_config: this._createTrajectoryLayerConfig(latField, lngField, heightScale)
        }
      }))
    };
    results.push(trajectoryData);

    // 2. Optional flat 2D ground path — the same trajectory projected onto the
    // map plane (Z=0), so the route can be read from above alongside the 3D
    // space-time path. Reuses the per-user colors and animation order.
    if (options.show2D) {
      const groundData: FeatureCollection = {
        ...preprocessedData,
        features: preprocessedData.features.map(f => {
          const [lng, lat] = (f.geometry as any).coordinates;
          return {
            ...f,
            geometry: { ...f.geometry, coordinates: [lng, lat, 0] },
            properties: {
              ...f.properties,
              [PROCESSED_HEIGHT_FIELD]: 0,
              _dataset_type: 'time-geography-trajectory-2d',
              _layer_config: this._create2DTrajectoryLayerConfig(latField, lngField),
            },
          };
        }),
      };
      results.push(groundData);
    }

    // 3. Stay points if enabled
    if (options.visualizeStay) {
      const stayField = (options.stayField as string || '').trim();
      let stayPoints: FeatureCollection;

      if (stayField) {
        // Attribute-based: consecutive rows with the same field value = one stay
        stayPoints = this._detectStaysByField(preprocessedData.features, stayField, latField, lngField);
      } else {
        // Fallback: spatial proximity-based detection
        const timeWindowHours = (options.timeWindow as number) || 24;
        stayPoints = this._detectAndCreateStayPoints(preprocessedData.features, timeWindowHours, latField, lngField);
      }

      if (stayPoints.features.length > 0) {
        const stayPointsData: FeatureCollection = {
          ...stayPoints,
          features: stayPoints.features.map(f => ({
            ...f,
            properties: {
              ...f.properties,
              _dataset_type: 'stay-points',
              _layer_config: this._createStayPointsLayerConfig()
            }
          }))
        };
        results.push(stayPointsData);
      }
    }

    return results;
  }

  /**
   * Detect stay points in trajectory
   */
  private _detectAndCreateStayPoints(
    features: GeoJSONFeature[],
    timeWindowHours: number,
    latField: string,
    lngField: string
  ): FeatureCollection {
    const distanceThreshold = 100; // meters
    const timeThreshold = timeWindowHours * 60 * 60 * 1000;
    const stayPoints: GeoJSONFeature[] = [];

    features.forEach((currentFeature, currentIndex) => {
      const currentLat = currentFeature.properties![latField];
      const currentLng = currentFeature.properties![lngField];
      const currentTime = currentFeature.properties!._timestamp;

      let nearbyCount = 0;
      let minNearbyTime = currentTime;
      let maxNearbyTime = currentTime;

      // Scan backward while within time threshold (data is sorted by time)
      for (let i = currentIndex - 1; i >= 0; i--) {
        const otherTime = features[i].properties!._timestamp;
        if (currentTime - otherTime > timeThreshold) break;

        const distance = this._calculateDistance(
          currentLat, currentLng,
          features[i].properties![latField], features[i].properties![lngField]
        );
        if (distance < distanceThreshold) {
          nearbyCount++;
          minNearbyTime = Math.min(minNearbyTime, otherTime);
        }
      }

      // Scan forward while within time threshold
      for (let i = currentIndex + 1; i < features.length; i++) {
        const otherTime = features[i].properties!._timestamp;
        if (otherTime - currentTime > timeThreshold) break;

        const distance = this._calculateDistance(
          currentLat, currentLng,
          features[i].properties![latField], features[i].properties![lngField]
        );
        if (distance < distanceThreshold) {
          nearbyCount++;
          maxNearbyTime = Math.max(maxNearbyTime, otherTime);
        }
      }

      if (nearbyCount >= 1) {
        const stayDuration = (maxNearbyTime - minNearbyTime) / 1000;
        stayPoints.push({
          ...currentFeature,
          properties: {
            ...currentFeature.properties,
            _is_stay_point: true,
            _stay_duration: stayDuration,
            _stay_id: stayPoints.length,
            _stay_cluster: Math.floor(stayPoints.length / 3)
          }
        });
      }
    });

    return {
      type: 'FeatureCollection',
      features: stayPoints
    };
  }

  /**
   * Detect stays by grouping consecutive rows with the same field value.
   * Each run of identical values produces one stay point at the centroid.
   */
  private _detectStaysByField(
    features: GeoJSONFeature[],
    stayField: string,
    latField: string,
    lngField: string
  ): FeatureCollection {
    const stayPoints: GeoJSONFeature[] = [];
    if (features.length === 0) return { type: 'FeatureCollection', features: stayPoints };

    let groupStart = 0;

    for (let i = 1; i <= features.length; i++) {
      const prev = features[i - 1].properties![stayField];
      const curr = i < features.length ? features[i].properties![stayField] : undefined;

      // End of a consecutive group
      if (i === features.length || String(curr) !== String(prev)) {
        const group = features.slice(groupStart, i);

        // Compute centroid position
        let sumLat = 0;
        let sumLng = 0;
        let sumHeight = 0;
        let minTime = Infinity;
        let maxTime = -Infinity;

        for (const f of group) {
          sumLat += f.properties![latField] as number;
          sumLng += f.properties![lngField] as number;
          sumHeight += (f.properties![PROCESSED_HEIGHT_FIELD] as number) ?? 0;
          const t = f.properties!._timestamp as number;
          if (t < minTime) minTime = t;
          if (t > maxTime) maxTime = t;
        }

        const n = group.length;
        const centroidLat = sumLat / n;
        const centroidLng = sumLng / n;
        const centroidHeight = sumHeight / n;
        const stayDuration = (maxTime - minTime) / 1000; // seconds
        const midTimeProgress = ((group[0].properties![PROCESSED_TIME_FIELD] as number) +
          (group[n - 1].properties![PROCESSED_TIME_FIELD] as number)) / 2;

        const label = String(prev ?? 'unknown');

        stayPoints.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [centroidLng, centroidLat, centroidHeight],
          },
          properties: {
            ...group[0].properties,
            [latField]: centroidLat,
            [lngField]: centroidLng,
            [PROCESSED_HEIGHT_FIELD]: centroidHeight,
            [PROCESSED_TIME_FIELD]: midTimeProgress,
            _timestamp: (minTime + maxTime) / 2,
            _is_stay_point: true,
            _stay_duration: stayDuration,
            _stay_id: stayPoints.length,
            _stay_label: label,
            _stay_point_count: n,
            _stay_cluster: stayPoints.length,
          },
        });

        groupStart = i;
      }
    }

    return { type: 'FeatureCollection', features: stayPoints };
  }

  /**
   * Calculate Haversine distance between two points
   */
  private _calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // ========================================
  // Layer Configuration Templates
  // ========================================

  private _createTrajectoryLayerConfig(latField: string, lngField: string, heightScale?: number): any {
    const timestamp = Date.now();
    const elevationScale = Math.max(1, Math.round(heightScale || 1));

    return {
      id: `time-geography-trajectory-layer-${timestamp}`,
      type: 'line',
      config: {
        dataId: 'time-geography-trajectory',
        label: '3D Trajectory',
        columnMode: 'neighbors',
        color: COLORS.LINE,
        columns: {
          lat: latField,
          lng: lngField,
          neighbors: PROCESSED_NEIGHBORS_FIELD,
          alt: PROCESSED_HEIGHT_FIELD
        },
        isVisible: true,
        visConfig: {
          opacity: 0.8,
          thickness: 2,
          elevationScale,
          enable3d: true
        }
      }
    };
  }

  private _create2DTrajectoryLayerConfig(latField: string, lngField: string): any {
    const timestamp = Date.now();

    return {
      id: `time-geography-trajectory-2d-layer-${timestamp}`,
      type: 'line',
      config: {
        dataId: 'time-geography-trajectory-2d',
        label: '2D Trajectory',
        columnMode: 'neighbors',
        color: COLORS.LINE,
        columns: {
          lat: latField,
          lng: lngField,
          neighbors: PROCESSED_NEIGHBORS_FIELD
        },
        isVisible: true,
        visConfig: {
          opacity: 0.9,
          thickness: 2,
          enable3d: false
        }
      }
    };
  }

  private _createStayPointsLayerConfig(): any {
    const timestamp = Date.now();

    return {
      id: `stay-points-layer-${timestamp}`,
      type: 'point',
      config: {
        dataId: 'stay-points',
        label: 'Stay Points',
        color: COLORS.ACTIVITY_SPACE,
        columns: {
          lat: 'latitude',
          lng: 'longitude'
        },
        isVisible: true,
        visConfig: {
          opacity: 0.8,
          radius: 20,
          radiusRange: [5, 50],
          filled: true,
          stroked: true,
          strokeColor: [255, 255, 255],
          thickness: 2
        }
      },
      visualChannels: {
        sizeField: { name: '_stay_duration', type: 'real' },
        sizeScale: 'linear',
        colorField: { name: '_stay_id', type: 'integer' },
        colorScale: 'quantile'
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Floor a timestamp to the UTC midnight of its day. Per-user alignment shifts
// trajectories by whole days using this, so each observation keeps its
// original time-of-day while only its date changes.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  return Math.floor(ts / DAY_MS) * DAY_MS;
}

// ---------------------------------------------------------------------------
// Per-user color assignment — distinct hues via the golden-angle sequence so
// adjacent user indices stay visually well-separated.
// ---------------------------------------------------------------------------

function colorForUserIndex(index: number): [number, number, number] {
  const hue = (index * 137.508) % 360;
  return hslToRgb(hue, 0.65, 0.5);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

// ---------------------------------------------------------------------------
// Robust timestamp parser — handles ISO strings, Unix seconds, and Unix ms
// ---------------------------------------------------------------------------

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number') {
    // Distinguish Unix seconds from milliseconds:
    // Unix ms timestamps are >= 1e12 (Sep 2001+); anything smaller is likely seconds.
    if (value > 0 && value < 1e12) {
      return value * 1000; // seconds → ms
    }
    return value; // already milliseconds (or negative/zero edge case)
  }

  if (typeof value === 'string') {
    // Try as number first (CSV sometimes stores numbers as strings)
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') {
      return parseTimestamp(num);
    }
    // Fall through to Date constructor for ISO / human-readable strings
    return new Date(value).getTime();
  }

  return NaN;
}
