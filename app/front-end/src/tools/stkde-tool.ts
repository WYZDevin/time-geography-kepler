import { SimpleTool, ToolOptionSchema } from '@/interfaces/simple-tool';
import { FeatureCollection, GeoJSONFeature } from '@/interfaces/data-interfaces';
import { AttributeMapping, getProperty } from '@/interfaces/attribute-mapping';
import { ToolUtils, ProgressReporter } from './tool-utils';
import { createSTKDE, METERS_PER_DEGREE_LAT, STKDE_Z_AXIS_FIELD } from '@/data-processors/stkde';
import { COLORS, PROCESSED_HEIGHT_FIELD } from '@/utils/constants';
import { TimeGeographyTool } from './time-geography-tool';

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
    // TEMPORARY: all computation moved to the backend; browser execution is
    // disabled. Restore 'frontend_only' to re-enable the analyze() path below.
    executionPolicy: 'backend_only' as const,
    recommendations: {
      frontendMaxRows: 50000,
      notes: ['Auto-detected grid capped at 50x50 cells; an explicit cell size is honored up to 250x250 cells'],
    },
  };

  attributeMapping: AttributeMapping = {
    time: 'timestamp'
  };

  getOptionSchema(): ToolOptionSchema[] {
    return [
      {
        key: 'cellSizeMeters',
        type: 'number',
        label: 'Grid Cell Size (meters)',
        description: 'Side length of each grid cell, in meters on the ground. Leave at 0 to auto-detect from the data extent — the auto-detected size is shown below once a data source is selected. Very fine values are coarsened if the grid would exceed 250x250 cells.',
        defaultValue: 0,
        min: 0,
        step: 'any',
        group: 'Grid'
      },
      {
        key: 'timeSliceMethod',
        type: 'select',
        label: 'Time Slice Method',
        description: 'Equal interval: every slice covers the same amount of time. Equal count: each slice contains about the same number of points (slice durations vary, so the Z axis is no longer uniform in time). Fixed duration: slices of an exact length (e.g. 6 hours), aligned to an anchor time such as midnight.',
        defaultValue: 'equal_interval',
        options: [
          { label: 'Equal interval (same duration per slice)', value: 'equal_interval' },
          { label: 'Equal count (same # of points per slice)', value: 'equal_count' },
          { label: 'Fixed duration (anchored, e.g. daily)', value: 'fixed_duration' }
        ],
        group: 'Time slicing'
      },
      {
        key: 'nTimeSlices',
        type: 'number',
        label: 'Number of Time Slices',
        description: 'How many slices to divide the time range into (the vertical / Z stack).',
        defaultValue: 10,
        min: 1,
        step: 1,
        visibleWhen: { key: 'timeSliceMethod', oneOf: ['equal_interval', 'equal_count'] },
        group: 'Time slicing'
      },
      {
        key: 'sliceDurationHours',
        type: 'number',
        label: 'Slice Duration (hours)',
        description: 'Length of each slice in hours — e.g. 24 = one slice per day, 6 = four per day. The number of slices follows from the data\'s time span (capped at 240).',
        defaultValue: 24,
        min: 0,
        step: 'any',
        visibleWhen: { key: 'timeSliceMethod', oneOf: ['fixed_duration'] },
        group: 'Time slicing'
      },
      {
        key: 'sliceAnchor',
        type: 'datetime',
        label: 'Align Slices To (anchor time)',
        description: 'Slice boundaries line up with this date/time — e.g. pick any midnight to make slices follow calendar days. Leave empty to start slices at the first data point. Ignored when "Align User Start Times" is enabled.',
        defaultValue: '',
        visibleWhen: { key: 'timeSliceMethod', oneOf: ['fixed_duration'] },
        group: 'Time slicing'
      },
      {
        key: 'showAxes',
        type: 'boolean',
        label: 'Show 3D Coordinate Axes',
        description: 'Draw the X/Y/Z reference axes and bounding box around the density cube to help orient the view in space and time.',
        defaultValue: true,
        group: 'Display'
      },
      {
        key: 'timeBreaks',
        type: 'select',
        label: 'Z-Axis Time Labels Interval',
        description: 'How often to label the vertical time (Z) axis. "Auto" shows only the start and end times; the fixed intervals add evenly spaced tick labels.',
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
        key: 'groundProjection',
        type: 'boolean',
        label: 'Show 2D Ground Projection',
        description: 'Also draw a plain 2D kernel density of all points (time ignored) on the map plane (Z=0), colored with a continuous low-to-high density gradient.',
        defaultValue: false,
        group: 'Display'
      },
      {
        key: 'showTrajectory',
        type: 'boolean',
        label: 'Overlay 3D Trajectory',
        description: 'Also draw the input points as a 3D space-time path on the same time (Z) axis as the density cube, so the movement track is visible inside the hotspot volume.',
        defaultValue: false,
        group: 'Trajectory & time alignment'
      },
      {
        key: 'userIdField',
        type: 'field',
        label: 'User ID Column',
        note: 'Only for multi-user trajectory data',
        description: 'Optional. Column identifying each user. Required to enable "Align User Start Times".',
        defaultValue: '',
        group: 'Trajectory & time alignment'
      },
      {
        key: 'alignUserTime',
        type: 'boolean',
        label: 'Align User Start Times (Normalize Time)',
        note: 'Only for multi-user trajectory data',
        requires: 'userIdField',
        description: 'When a User ID column is set and multiple users exist, measure each event as time elapsed from that user\'s own first observation, so users tracked over different date ranges are overlaid on a shared elapsed-time (Day 1…Day n) Z-axis.',
        defaultValue: false,
        group: 'Trajectory & time alignment'
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

      const userIdField = (options.userIdField as string || '').trim();
      const alignUserTime = options.alignUserTime === true;

      // Grid cell size: the user enters meters; the grid works in lon/lat
      // degrees (N-S), so convert. A positive value overrides auto-detection;
      // 0/blank (the default) falls back to the data-extent estimate inside
      // createSTKDE.
      const cellSizeMetersOpt = Number(options.cellSizeMeters);
      const cellSize = Number.isFinite(cellSizeMetersOpt) && cellSizeMetersOpt > 0
        ? cellSizeMetersOpt / METERS_PER_DEGREE_LAT
        : undefined;

      // Call createSTKDE which handles computation, classification, and GeoJSON conversion
      const { features: results } = await createSTKDE(
        data as GeoJSON.FeatureCollection<GeoJSON.Point>,
        timeField,
        undefined, // spatial_bandwidth - auto-determined
        undefined, // temporal_bandwidth - auto-determined
        cellSize,  // cell_size - auto-determined when undefined
        10,        // n_time_slices
        { userField: userIdField, align: alignUserTime }
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

      // Optional 2D ground projection: flatten each confidence level onto the
      // map plane (Z=0). The 3D output stacks every time slice, so the same
      // (x,y) cell recurs once per slice; we keep one flat polygon per unique
      // cell footprint to render the combined hotspot area without overlapping
      // coplanar duplicates.
      // NOTE: this browser path is currently disabled (tool is backend_only).
      // The backend instead computes a true 2D spatial KDE of all points —
      // port that here before re-enabling frontend execution.
      const outputs: FeatureCollection[] = [...enrichedResults];

      if (options.groundProjection === true) {
        const groundResults: FeatureCollection[] = enrichedResults.map((collection, index) => {
          const { confidence, color, opacity } = STKDE_CONFIDENCE_LEVELS[index] ?? STKDE_CONFIDENCE_LEVELS[0];
          const dataId = `stkde-ground-${index + 1}`;
          const layerConfig = create2DStkdeLayerConfig(dataId, confidence, color, opacity);

          const seen = new Set<string>();
          const features: GeoJSONFeature[] = [];
          for (const feature of collection.features) {
            const ring = ((feature.geometry as GeoJSON.Polygon).coordinates?.[0] ?? []) as number[][];
            if (ring.length === 0) continue;
            const [x0, y0] = ring[0];
            const key = `${x0.toFixed(6)},${y0.toFixed(6)}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const flatGeometry: GeoJSON.Polygon = {
              type: 'Polygon',
              coordinates: [ring.map(([x, y]) => [x, y, 0])],
            };

            features.push({
              ...feature,
              geometry: flatGeometry,
              properties: {
                ...(feature.properties ?? {}),
                _dataset_type: dataId,
                _confidence: confidence,
                _layer_config: layerConfig,
                _geojson: JSON.stringify(flatGeometry),
                [STKDE_Z_AXIS_FIELD]: 0,
                z: 0,
                [PROCESSED_HEIGHT_FIELD]: 0,
              },
            });
          }
          return { ...collection, features };
        });

        outputs.push(...groundResults);
      }

      // Optional 3D trajectory overlay: reuse the Time Geography tool to draw
      // the input points as a space-time path. Both tools map time onto the
      // same optimal Z-axis height (calculateOptimalZAxisHeight over the data
      // bounds), so the path lines up with the density cube vertically.
      if (options.showTrajectory === true) {
        const trajectoryOutputs = await this._buildTrajectoryOverlay(data, options, attributes);
        outputs.push(...trajectoryOutputs);
      }

      progress.report(100, 'Complete');
      return outputs;

    } catch (error) {
      console.error('STKDE analysis error:', error);
      return [ToolUtils.emptyResult()];
    }
  }

  /**
   * Build a 3D space-time trajectory overlay from the same input points,
   * delegating to the Time Geography tool so the path styling, per-user
   * coloring and time→Z mapping match a standalone trajectory run. Only the
   * 3D path is produced — no 2D ground path, stay points or axes (STKDE owns
   * the axes), and the shared User ID / alignment options are passed through.
   */
  private async _buildTrajectoryOverlay(
    data: FeatureCollection,
    options: Record<string, unknown>,
    attributes?: AttributeMapping,
  ): Promise<FeatureCollection[]> {
    const trajectoryTool = new TimeGeographyTool();
    const outputs = await trajectoryTool.analyze(
      data,
      {
        userIdField: options.userIdField,
        alignUserTime: options.alignUserTime,
        heightScale: options.heightScale,
        show2D: false,
        visualizeStay: false,
        showAxes: false,
      },
      attributes,
    );
    return outputs.filter(fc => fc.features.length > 0);
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

const create2DStkdeLayerConfig = (
  dataId: string,
  confidence: number,
  color: number[],
  opacity: number
) => ({
  type: 'geojson',
  config: {
    dataId,
    columnMode: 'geojson',
    label: `STKDE ${confidence}% (Ground)`,
    columns: { geojson: '_geojson' },
    isVisible: true,
    color,
    visConfig: {
      opacity,
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
    colorField: null,
    colorScale: 'quantile',
    strokeColorField: null,
    strokeColorScale: 'quantile',
    sizeField: null,
  }
});

