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
    executionPolicy: 'frontend_only' as const,
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
        key: 'visualizeStay',
        label: 'Visualize Stay Points',
        type: 'boolean',
        defaultValue: false
      },
      {
        key: 'showAxes',
        label: 'Show 3D Axis',
        type: 'boolean',
        defaultValue: true
      },
      {
        key: 'timeBreaks',
        label: 'Z-Axis Time Labels Interval',
        type: 'select',
        defaultValue: 'auto',
        options: [
          { label: 'Auto (Min/Max Only)', value: 'auto' },
          { label: 'Every 1 Hour', value: '1h' },
          { label: 'Every 4 Hours', value: '4h' },
          { label: 'Every 12 Hours', value: '12h' },
          { label: 'Every 24 Hours', value: '24h' }
        ]
      },
      {
        key: 'timeWindow',
        label: 'Stay Point Time Window (hours)',
        type: 'number',
        defaultValue: 24,
        min: 1,
        max: 168
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

      if (!timeField) {
        console.error('Time field mapping is required for trajectory visualization');
        return [ToolUtils.emptyResult()];
      }

      progress.report(30, 'Sorting and projecting trajectory to 3D...');

      const preprocessedData = this._preprocessData(data, timeField, latField, lngField);

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
    lngField: string
  ): FeatureCollection {
    const validFeatures = data.features
      .map((feature, index) => {
        const coords = (feature.geometry as any).coordinates;
        if (!coords) return null;

        const [lng, lat] = coords;
        const timeValue = getProperty(feature, timeField);

        if (!timeValue) return null;

        const timestamp = new Date(timeValue).getTime();
        if (isNaN(timestamp)) return null;

        return {
          ...feature,
          properties: {
            ...feature.properties,
            _timestamp: timestamp,
            _original_index: index,
            [latField]: lat,
            [lngField]: lng
          }
        };
      })
      .filter(Boolean) as GeoJSONFeature[];

    validFeatures.sort((a, b) =>
      a!.properties!._timestamp - b!.properties!._timestamp
    );

    const timeExtent = [
      Math.min(...validFeatures.map(f => f.properties!._timestamp)),
      Math.max(...validFeatures.map(f => f.properties!._timestamp))
    ];
    const timeRange = timeExtent[1] - timeExtent[0];

    const bounds = ToolUtils.getBounds(validFeatures);
    let TOTAL_HEIGHT_METERS = 1000;
    if (bounds) {
      TOTAL_HEIGHT_METERS = ToolUtils.calculateOptimalZAxisHeight(bounds.minLng, bounds.maxLng, bounds.minLat, bounds.maxLat);
    }

    const processedFeatures = validFeatures.map((feature, index) => {
      const timeProgress = timeRange > 0
        ? (feature.properties!._timestamp - timeExtent[0]) / timeRange
        : 0;
      const scaledHeight = timeProgress * TOTAL_HEIGHT_METERS;

      const geom = feature.geometry as any;
      const [lng, lat] = geom.coordinates;

      const neighbors: number[] = [];
      if (index > 0) neighbors.push(index - 1);
      if (index < validFeatures.length - 1) neighbors.push(index + 1);

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

    // 2. Stay points if enabled
    if (options.visualizeStay) {
      const timeWindowHours = (options.timeWindow as number) || 24;
      const stayPoints = this._detectAndCreateStayPoints(
        preprocessedData.features,
        timeWindowHours,
        latField,
        lngField
      );

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

      for (let i = Math.max(0, currentIndex - 10); i < Math.min(features.length, currentIndex + 10); i++) {
        if (i === currentIndex) continue;

        const otherFeature = features[i];
        const otherLat = otherFeature.properties![latField];
        const otherLng = otherFeature.properties![lngField];
        const otherTime = otherFeature.properties!._timestamp;

        if (Math.abs(currentTime - otherTime) > timeThreshold) continue;

        const distance = this._calculateDistance(currentLat, currentLng, otherLat, otherLng);
        if (distance < distanceThreshold) {
          nearbyCount++;
          minNearbyTime = Math.min(minNearbyTime, otherTime);
          maxNearbyTime = Math.max(maxNearbyTime, otherTime);
        }
      }

      if (nearbyCount >= 3) {
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
