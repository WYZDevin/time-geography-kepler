import { SimpleTool, ToolOptionSchema } from '@/interfaces/simple-tool';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { ToolUtils } from './tool-utils';
import * as turf from '@turf/turf';

export class IntersectionTool implements SimpleTool {
  id = 'intersection-analysis';
  name = 'Intersection Analysis';
  description = 'Find overlapping areas between polygons';
  icon = '∩';
  category = 'analysis' as const;
  version = '1.0.0';
  capabilities = {
    executionPolicy: 'frontend_only' as const,
    recommendations: {
      frontendMaxFeatures: 100,
      notes: ['Pairwise O(N^2) comparison; capped at 100 polygons in browser'],
    },
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
    if (!ToolUtils.isValidGeoJSON(data)) {
      console.error('Invalid GeoJSON data provided');
      return [ToolUtils.emptyResult()];
    }

    try {
      // Filter for polygon features only
      const polygonFeatures = data.features.filter(feature =>
        feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
      );

      if (polygonFeatures.length < 2) {
        console.error('At least two polygon features are required for intersection analysis');
        return [ToolUtils.emptyResult()];
      }

      // Guard against O(N^2) blow-up on large feature sets
      const MAX_POLYGON_COUNT = 100;
      if (polygonFeatures.length > MAX_POLYGON_COUNT) {
        console.error(
          `Too many polygons for pairwise intersection (${polygonFeatures.length}). ` +
          `Maximum is ${MAX_POLYGON_COUNT} to avoid excessive computation. ` +
          `Consider filtering your data first.`
        );
        return [ToolUtils.emptyResult()];
      }

      const intersections: GeoJSON.Feature[] = [];
      const preserveProperties = options.preserveProperties !== false;

      // Find all pairwise intersections
      for (let i = 0; i < polygonFeatures.length - 1; i++) {
        for (let j = i + 1; j < polygonFeatures.length; j++) {
          try {
            const intersection = turf.intersect(turf.featureCollection([polygonFeatures[i] as any, polygonFeatures[j] as any]));
            if (intersection) {
              const properties: any = {
                _intersection_operation: true,
                _feature_pair: [i, j],
                _operation_timestamp: new Date().toISOString()
              };

              if (preserveProperties) {
                properties.feature_a_props = polygonFeatures[i].properties;
                properties.feature_b_props = polygonFeatures[j].properties;
              }

              intersection.properties = {
                ...intersection.properties,
                ...properties
              };

              intersections.push(intersection);
            }
          } catch (error) {
            console.warn(`Failed to compute intersection between features ${i} and ${j}:`, error);
          }
        }
      }

      if (intersections.length === 0) {
        console.error('No intersections found between the polygon features');
        return [ToolUtils.emptyResult()];
      }

      return [{
        type: 'FeatureCollection',
        features: intersections as any[]
      }];

    } catch (error) {
      console.error('Intersection analysis error:', error);
      return [ToolUtils.emptyResult()];
    }
  }
}
