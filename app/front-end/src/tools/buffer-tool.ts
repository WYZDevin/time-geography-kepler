import { SimpleTool, ToolOptionSchema } from '@/interfaces/simple-tool';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { ToolUtils, ProgressReporter } from './tool-utils';
import * as turf from '@turf/turf';

export class BufferTool implements SimpleTool {
  id = 'buffer-analysis';
  name = 'Buffer Analysis';
  description = 'Create buffer zones around spatial features (points, lines, or polygons)';
  icon = '⭕';
  category = 'analysis' as const;
  version = '1.0.0';
  capabilities = {
    executionPolicy: 'frontend_only' as const,
    recommendations: {
      frontendMaxFeatures: 10000,
      notes: ['Dissolve operation is O(N) sequential unions'],
    },
  };

  getOptionSchema(): ToolOptionSchema[] {
    return [
      {
        key: 'bufferDistance',
        label: 'Buffer Distance',
        type: 'number',
        defaultValue: 100,
        min: 1,
        max: 10000,
        required: true
      },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        defaultValue: 'meters',
        options: [
          { value: 'meters', label: 'Meters' },
          { value: 'kilometers', label: 'Kilometers' },
          { value: 'miles', label: 'Miles' },
          { value: 'feet', label: 'Feet' }
        ]
      },
      {
        key: 'dissolve',
        label: 'Dissolve Overlapping Buffers',
        type: 'boolean',
        defaultValue: false
      },
      {
        key: 'steps',
        label: 'Buffer Smoothness',
        type: 'number',
        defaultValue: 64,
        min: 8,
        max: 128
      }
    ];
  }

  async analyze(data: FeatureCollection, options: Record<string, unknown>): Promise<FeatureCollection[]> {
    // Use composition instead of inheritance
    const progress = new ProgressReporter(options.onProgress as ((progress: number, message?: string) => void) | undefined);
    
    // Validate input using utility
    if (!ToolUtils.isValidGeoJSON(data)) {
      console.error('Invalid GeoJSON data');
      return [ToolUtils.emptyResult()];
    }
    
    progress.report(10, 'Creating buffers...');
    
    const distance = (options.bufferDistance as number) ?? 100;
    const units = (options.units as string) ?? 'meters';
    const dissolve = (options.dissolve as boolean) ?? false;
    const steps = (options.steps as number) ?? 64;
    
    try {
      // Process features with progress reporting
      const total = data.features.length;
      const buffers = data.features.map((feature, i) => {
        progress.report(10 + (i / total) * 80, `Processing feature ${i + 1}/${total}`);
        try {
          const buffered = turf.buffer(feature, distance, { units: units as turf.Units, steps });
          if (buffered) {
            buffered.properties = {
              ...feature.properties,
              _buffer_distance: distance,
              _buffer_units: units,
              _original_feature_id: feature.properties?.id || i
            };
            return buffered;
          }
          return null;
        } catch (error) {
          console.warn(`Failed to create buffer for feature ${i}:`, error);
          return null;
        }
      }).filter(Boolean) as GeoJSON.Feature[];

      if (buffers.length === 0) {
        console.error('No valid buffers could be created');
        return [ToolUtils.emptyResult()];
      }

      let resultFeatures = buffers;
      if (dissolve && buffers.length > 1) {
        try {
          let dissolvedFeature: GeoJSON.Feature = buffers[0];
          for (let i = 1; i < buffers.length; i++) {
            const union = turf.union(turf.featureCollection([dissolvedFeature as any, buffers[i] as any]));
            if (union) {
              dissolvedFeature = union;
            }
          }
          
          dissolvedFeature.properties = {
            _buffer_distance: distance,
            _buffer_units: units,
            _dissolved: true,
            _original_feature_count: buffers.length
          };
          
          resultFeatures = [dissolvedFeature];
        } catch (error) {
          console.warn('Error during dissolve operation:', error);
        }
      }

      progress.report(100, 'Complete');
      
      return [{
        type: 'FeatureCollection',
        features: resultFeatures as any[]
      }];
      
    } catch (error) {
      console.error('Buffer analysis error:', error);
      return [ToolUtils.emptyResult()];
    }
  }
}
