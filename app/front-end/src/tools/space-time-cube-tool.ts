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
        key: 'showAxes',
        type: 'boolean',
        label: 'Show 3D Coordinate Axes',
        defaultValue: true,
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
          { label: 'Every 24 Hours', value: '24h' },
        ],
      },
    ];
  }

  async analyze(
    _data: FeatureCollection,
    _options: Record<string, unknown>,
    _attributes?: AttributeMapping,
  ): Promise<FeatureCollection[]> {
    throw new Error('This tool requires backend execution');
  }
}
