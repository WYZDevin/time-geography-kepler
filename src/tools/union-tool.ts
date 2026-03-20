import { SimpleTool, ToolOptionSchema } from '@/interfaces/simple-tool';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { ToolUtils, ProgressReporter } from './tool-utils';
import * as turf from '@turf/turf';

export class UnionTool implements SimpleTool {
  id = 'union-analysis';
  name = 'Union Analysis';
  description = 'Combine overlapping polygons into unified areas';
  icon = '∪';
  category = 'analysis' as const;
  version = '1.0.0';
  capabilities = {
    executionPolicy: 'frontend_only' as const,
  };

  getOptionSchema(): ToolOptionSchema[] {
    return [
      {
        key: 'preserveProperties',
        label: 'Preserve Original Properties',
        type: 'boolean',
        defaultValue: true
      }
    ];
  }

  async analyze(data: FeatureCollection, options: Record<string, unknown>): Promise<FeatureCollection[]> {
    const progress = new ProgressReporter(options.onProgress as ((progress: number, message?: string) => void) | undefined);
    
    if (!ToolUtils.isValidGeoJSON(data)) {
      console.error('Invalid GeoJSON data provided');
      return [ToolUtils.emptyResult()];
    }
    
    progress.report(10, 'Finding polygon features...');

    try {
      // Filter for polygon features only
      const polygonFeatures = data.features.filter(feature => 
        feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
      );

      if (polygonFeatures.length === 0) {
        console.error('No polygon features found for union operation');
        return [ToolUtils.emptyResult()];
      }

      if (polygonFeatures.length === 1) {
        return [{
          type: 'FeatureCollection',
          features: polygonFeatures
        }];
      }

      // Perform union operation
      progress.report(30, 'Performing union...');
      let result = polygonFeatures[0];
      const preserveProperties = options.preserveProperties !== false;

      for (let i = 1; i < polygonFeatures.length; i++) {
        const unionResult = turf.union(result as any, polygonFeatures[i] as any);
        if (unionResult) {
          result = unionResult;
          
          // Optionally preserve properties from all features
          if (preserveProperties && result.properties) {
            result.properties = {
              ...result.properties,
              [`feature_${i}_props`]: polygonFeatures[i].properties
            };
          }
        }
      }

      // Add union metadata
      if (result.properties) {
        result.properties = {
          ...result.properties,
          _union_operation: true,
          _original_feature_count: polygonFeatures.length,
          _operation_timestamp: new Date().toISOString()
        };
      }

      progress.report(100, 'Complete');

      return [{
        type: 'FeatureCollection',
        features: [result as any]
      }];

    } catch (error) {
      console.error('Union analysis error:', error);
      return [ToolUtils.emptyResult()];
    }
  }
}
