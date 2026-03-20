import { SimpleTool, ToolRunMeta, ExecutionMode } from '@/interfaces/simple-tool';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { AttributeMapping } from '@/interfaces/attribute-mapping';
import { toolRegistry } from '@/utils/tool-registry';
import { backendApiService } from './backend-api-service';
import { normalizeBackendResponse } from './backend-normalizer';
import * as turf from '@turf/turf';

export interface AnalysisRequest {
  toolId: string;
  data: FeatureCollection;
  options: Record<string, any>;
  attributes?: AttributeMapping;
  sourceDatasetIds?: string[];
  mode?: ExecutionMode;
}

export interface AnalysisResult {
  success: boolean;
  toolId: string;
  outputs: FeatureCollection[];
  metadata: {
    executionTime: number;
    featureCount: number;
    timestamp: string;
  };
  runMeta?: ToolRunMeta;
  error?: string;
}

function computeBbox(outputs: FeatureCollection[]): [number, number, number, number] | undefined {
  const allFeatures: GeoJSON.Feature[] = outputs.flatMap(fc => fc.features);
  if (allFeatures.length === 0) return undefined;
  try {
    const combined: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allFeatures };
    const box = turf.bbox(combined);
    return [box[0], box[1], box[2], box[3]];
  } catch {
    return undefined;
  }
}

/**
 * Pure analysis engine - knows nothing about UI
 */
export class AnalysisEngine {
  async execute(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    try {
      // Backend execution path
      if (request.mode === 'backend') {
        const raw = await backendApiService.executeTool(
          request.toolId,
          request.data,
          request.options,
          request.attributes as Record<string, any> | undefined,
          request.sourceDatasetIds,
        );
        if (!raw || !raw.success) {
          return {
            success: false,
            toolId: request.toolId,
            outputs: [],
            error: raw?.error || 'Backend execution failed',
            metadata: {
              executionTime: Date.now() - startTime,
              featureCount: 0,
              timestamp: new Date().toISOString(),
            },
          };
        }
        return normalizeBackendResponse(raw, request.toolId);
      }

      // Frontend execution path
      const tool = toolRegistry.getTool(request.toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${request.toolId}`);
      }

      // Execute analysis
      const outputs = await tool.analyze(
        request.data,
        request.options,
        request.attributes
      );

      // Calculate metadata
      const featureCount = outputs.reduce(
        (sum, fc) => sum + fc.features.length,
        0
      );

      const runMeta: ToolRunMeta = {
        toolName: tool.name,
        toolVersion: tool.version,
        runAt: startTime,
        sourceDatasetIds: request.sourceDatasetIds ?? [],
        params: { ...request.options },
        summary: {
          inputCount: request.data.features.length,
          outputCount: featureCount,
          bbox: computeBbox(outputs),
        },
      };

      return {
        success: true,
        toolId: request.toolId,
        outputs,
        metadata: {
          executionTime: Date.now() - startTime,
          featureCount,
          timestamp: new Date().toISOString()
        },
        runMeta,
      };

    } catch (error) {
      return {
        success: false,
        toolId: request.toolId,
        outputs: [],
        metadata: {
          executionTime: Date.now() - startTime,
          featureCount: 0,
          timestamp: new Date().toISOString()
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get all available tools (for UI)
   */
  getAvailableTools(): SimpleTool[] {
    return toolRegistry.getAllTools();
  }

  /**
   * Check if tool can process given data
   */
  canProcessData(toolId: string, data: FeatureCollection): boolean {
    const tool = toolRegistry.getTool(toolId);
    if (!tool) return false;

    // Basic validation
    return data.type === 'FeatureCollection' &&
           data.features.length > 0;
  }
}

export const createAnalysisEngine = () => new AnalysisEngine();
