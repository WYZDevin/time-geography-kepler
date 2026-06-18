import { SimpleTool, ToolOptionSchema } from '@/interfaces/simple-tool';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { AttributeMapping } from '@/interfaces/attribute-mapping';

/**
 * Space-Time Cube Tool - Backend-only
 *
 * Visualizes spatio-temporal data as 3D cubes (raster cells through time).
 * All computation happens on the backend; this stub provides the tool
 * definition so the UI can show it in the tool picker and route execution.
 */
export class SpaceTimeCubeTool implements SimpleTool {
  id = 'space-time-cube';
  name = 'Space-Time Cube';
  description = 'Visualize spatio-temporal data as 3D cubes representing raster cells through time';
  icon = '🧊';
  category = 'analysis' as const;
  version = '1.0.0';
  capabilities = {
    executionPolicy: 'backend_only' as const,
  };

  attributeMapping: AttributeMapping = {
    time: 'timestamp',
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
        group: 'Grid',
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
          { label: 'Fixed duration (anchored, e.g. daily)', value: 'fixed_duration' },
        ],
        group: 'Time slicing',
      },
      {
        key: 'timeSlices',
        type: 'number',
        label: 'Number of Time Slices',
        description: 'How many slices to stack the cubes into along the time (Z) axis.',
        defaultValue: 10,
        min: 1,
        step: 1,
        visibleWhen: { key: 'timeSliceMethod', oneOf: ['equal_interval', 'equal_count'] },
        group: 'Time slicing',
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
        group: 'Time slicing',
      },
      {
        key: 'sliceAnchor',
        type: 'datetime',
        label: 'Align Slices To (anchor time)',
        description: 'Slice boundaries line up with this date/time — e.g. pick any midnight to make slices follow calendar days. Leave empty to start slices at the first data point. Ignored when "Align Start Times" is enabled.',
        defaultValue: '',
        visibleWhen: { key: 'timeSliceMethod', oneOf: ['fixed_duration'] },
        group: 'Time slicing',
      },
      {
        key: 'showAxes',
        type: 'boolean',
        label: 'Show 3D Coordinate Axes',
        description: 'Draw the X/Y/Z reference axes and bounding box around the cube stack to help orient the view in space and time.',
        defaultValue: true,
        group: 'Display',
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
          { label: 'Every 24 Hours', value: '24h' },
        ],
        group: 'Display',
      },
      {
        key: 'groundProjection',
        type: 'boolean',
        label: 'Show 2D Ground Projection',
        description: 'Also draw a flat grid on the map plane (Z=0) aggregating the cube stack over time — total point count (or mean exposure) per cell, seen from above.',
        defaultValue: false,
        group: 'Display',
      },
      {
        key: 'userIdField',
        type: 'field',
        label: 'Trajectory ID Column',
        description: 'Optional. Column identifying each trajectory/user. Required to enable "Align Start Times".',
        defaultValue: '',
        group: 'Trajectory & time alignment',
      },
      {
        key: 'alignUserTime',
        type: 'boolean',
        label: 'Align Start Times (Normalize Time)',
        requires: 'userIdField',
        description: 'When a Trajectory ID column is set and multiple trajectories exist, measure each point as time elapsed from that trajectory\'s own first observation, so trajectories tracked over different date ranges overlay on a shared elapsed-time (Day 1…Day n) Z-axis.',
        defaultValue: false,
        group: 'Trajectory & time alignment',
      },
      {
        key: 'envDataset',
        type: 'dataset',
        label: 'Environment Dataset',
        description: 'Optional: gridded environmental data (e.g. noise, PM2.5). Each feature must have an hourly timestamp and an indicator column.',
        required: false,
        defaultValue: null,
        group: 'Environmental exposure',
      },
      {
        key: 'envField',
        type: 'field',
        label: 'Environmental Indicator',
        description: 'Column in the environment dataset to use as the exposure value (e.g. noise_db)',
        sourceDatasetOptionKey: 'envDataset',
        defaultValue: '',
        group: 'Environmental exposure',
      },
    ];
  }

  async analyze(): Promise<FeatureCollection[]> {
    throw new Error('This tool requires backend execution');
  }
}
