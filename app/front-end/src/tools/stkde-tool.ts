import { SimpleTool, ToolOptionSchema } from '@/interfaces/simple-tool';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { AttributeMapping, getProperty } from '@/interfaces/attribute-mapping';
import { ToolUtils, ProgressReporter } from './tool-utils';
import { createSTKDE, STKDE_Z_AXIS_FIELD } from '@/data-processors/stkde';
import { COLORS, PROCESSED_HEIGHT_FIELD } from '@/utils/constants';

/**
 * STKDE Tool - Auto-determines all parameters from data
 * User only needs to select the datasource
 */
export class STKDETool implements SimpleTool {
  id = 'stkde';
  name = 'Space-Time Kernel Density';
  description = 'Generate 3D space-time kernel density estimation with auto-determined parameters';
  icon = '🌊';
  category = 'analysis' as const;
  version = '1.0.0';
  capabilities = {
    executionPolicy: 'frontend_only' as const,
    recommendations: {
      frontendMaxRows: 50000,
      notes: ['Grid capped at 50x50 cells to prevent WebGL memory errors'],
    },
  };

  attributeMapping: AttributeMapping = {
    time: 'timestamp'
  };

  getOptionSchema(): ToolOptionSchema[] {
    return [
      {
        key: 'showAxes',
        type: 'boolean',
        label: 'Show 3D Coordinate Axes',
        defaultValue: true
      },
      {
        key: 'timeBreaks',
        type: 'select',
        label: 'Z-Axis Time Labels Interval',
        defaultValue: 'auto',
        options: [
          { label: 'Auto (Min/Max Only)', value: 'auto' },
          { label: 'Every 1 Hour', value: '1h' },
          { label: 'Every 4 Hours', value: '4h' },
          { label: 'Every 12 Hours', value: '12h' },
          { label: 'Every 24 Hours', value: '24h' }
        ]
      }
    ];
  }

  async analyze(
    data: FeatureCollection,
    options: Record<string, unknown>,
    attributes?: AttributeMapping
  ): Promise<FeatureCollection[]> {
    const progress = new ProgressReporter(options.onProgress as ((progress: number, message?: string) => void) | undefined);

    if (!ToolUtils.isValidGeoJSON(data)) {
      console.error('Invalid GeoJSON data provided');
      return [ToolUtils.emptyResult()];
    }

    progress.report(10, 'Validating data...');

    const timeField = attributes?.time || this.attributeMapping.time;
    if (!timeField) {
      console.error('Time field mapping is required for STKDE analysis');
      return [ToolUtils.emptyResult()];
    }

    // console.log('data', data);
    // Validate that all features are points
    const hasNonPoints = data.features.some(f => f.geometry.type !== 'Point');
    if (hasNonPoints) {
      console.error('STKDE requires Point geometries only');
      return [ToolUtils.emptyResult()];
    }

    // Validate time data exists
    const hasTimeData = data.features.every(f => {
      const timeValue = getProperty(f, timeField);
      return timeValue && !isNaN(new Date(timeValue).getTime());
    });

    if (!hasTimeData) {
      console.error('All features must have valid time data');
      return [ToolUtils.emptyResult()];
    }

    try {
      progress.report(30, 'Computing space-time kernel density...');

      // Call createSTKDE which handles computation, classification, and GeoJSON conversion
      const { features: results } = await createSTKDE(
        data as GeoJSON.FeatureCollection<GeoJSON.Point>,
        timeField,
        undefined, // spatial_bandwidth - auto-determined
        undefined, // temporal_bandwidth - auto-determined
        undefined, // cell_size - auto-determined
        10         // n_time_slices
      );

      const enrichedResults = results.map((collection, index) => {
        const { confidence, color, opacity } = STKDE_CONFIDENCE_LEVELS[index] ?? STKDE_CONFIDENCE_LEVELS[0];
        const dataId = `stkde-density-${index + 1}`;
        const layerConfig = createStkdeLayerConfig(dataId, confidence, color, opacity);

        return {
          ...collection,
          features: collection.features.map(feature => {
            const originalProperties = (feature.properties ?? {}) as Record<string, unknown>;
            const zAxisCandidate = originalProperties[STKDE_Z_AXIS_FIELD];
            const fallbackCandidate = originalProperties.z;
            const zAxisStart =
              typeof zAxisCandidate === 'number'
                ? zAxisCandidate
                : typeof fallbackCandidate === 'number'
                  ? fallbackCandidate
                  : 0;

            return {
              ...feature,
              properties: {
                ...originalProperties,
                _dataset_type: dataId,
                _confidence: confidence,
                _layer_config: layerConfig,
                _geojson: JSON.stringify(feature.geometry),
                [STKDE_Z_AXIS_FIELD]: zAxisStart,
                z: zAxisStart,
                [PROCESSED_HEIGHT_FIELD]: originalProperties[PROCESSED_HEIGHT_FIELD]
              }
            };
          })
        };
      });

      progress.report(100, 'Complete');
      return enrichedResults;

    } catch (error) {
      console.error('STKDE analysis error:', error);
      return [ToolUtils.emptyResult()];
    }
  }
}

type ConfidenceLevel = {
  confidence: number;
  color: number[];
  opacity: number;
};

const STKDE_CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  { confidence: 90, color: COLORS.STKDE_90, opacity: 0.6 },
  { confidence: 95, color: COLORS.STKDE_95, opacity: 0.8 },
  { confidence: 99, color: COLORS.STKDE_99, opacity: 0.3 }
];

const createStkdeLayerConfig = (
  dataId: string,
  confidence: number,
  color: number[],
  opacity: number
) => ({
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
      fixedHeight: true
    },
    hidden: false,
    heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'float' }
  },
  visualChannels: {
    heightScale: 'linear',
    colorField: null,
    colorScale: 'quantile',
    strokeColorField: null,
    strokeColorScale: 'quantile',
    sizeField: null,
  }
});

