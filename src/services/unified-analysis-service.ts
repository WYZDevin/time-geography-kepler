import { AnalysisContext, AnalysisResult, DatasetResult, ProgressCallback } from '../interfaces/tool-interfaces';
import { FeatureCollection, ColumnMapping } from '../interfaces/data-interfaces';
import { DataService, createDataService } from './data-service';
import { toolRegistry } from '../utils/tool-registry';
import { AppDispatch } from '../stores/store';
import { addDataToMap } from '@kepler.gl/actions';
import { processGeojson } from '@kepler.gl/processors';
import { updateMap } from '@kepler.gl/actions';
import store from '../stores/store';

export interface UnifiedAnalysisRequest {
  toolId: string;
  data: FeatureCollection;
  fieldMapping: ColumnMapping;
  options: Record<string, any>;
  sessionName?: string;
}

export interface UnifiedAnalysisResponse {
  success: boolean;
  datasets: DatasetResult[];
  metadata?: Record<string, any>;
  error?: string;
  executionTime: number;
  keplerActions: any[];
}

/**
 * Unified Analysis Service
 * 
 * This service consolidates all analysis functionality and provides a single
 * interface for executing tools with proper data management and visualization.
 */
export class UnifiedAnalysisService {
  private dataService: DataService;
  private dispatch: AppDispatch;

  constructor(dispatch: AppDispatch) {
    this.dispatch = dispatch;
    this.dataService = createDataService(dispatch);
    
    // Use global tool registry instead of creating separate instances
    console.log('UnifiedAnalysisService: Using global tool registry');
  }

  /**
   * Execute a complete analysis workflow with visualization
   */
  async executeAnalysis(
    request: UnifiedAnalysisRequest,
    progressCallback?: ProgressCallback
  ): Promise<UnifiedAnalysisResponse> {
    const startTime = Date.now();

    try {
      progressCallback?.(0, 'Initializing analysis...');

      // Create analysis context for direct tool execution
      const analysisContext: AnalysisContext = {
        data: request.data,
        fieldMapping: request.fieldMapping,
        options: request.options,
        toolId: request.toolId
      };

      // Get the tool from global registry
      const tool = toolRegistry.getTool(request.toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${request.toolId}`);
      }

      // Validate inputs
      const validation = this.validateAnalysisRequest(tool, request.data, request.fieldMapping, request.options);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      progressCallback?.(10, 'Starting tool analysis...');

      // Execute the tool directly
      const result = await tool.analyze(analysisContext, (progress, message) => {
        // Map tool progress to 10-90% range
        const mappedProgress = 10 + (progress * 0.8);
        progressCallback?.(mappedProgress, message);
      });

      if (!result.success) {
        throw new Error(result.error || 'Analysis failed');
      }

      progressCallback?.(90, 'Creating visualization...');

      // Create Kepler.gl actions for visualization
      const keplerActions = this.createKeplerActions(result, tool.name);

      progressCallback?.(95, 'Adding to map...');

      // Apply Kepler.gl actions
      keplerActions.forEach(action => {
        if (action) {
          this.dispatch(action);
        }
      });

      const executionTime = Date.now() - startTime;
      progressCallback?.(100, 'Analysis complete');

      return {
        success: true,
        datasets: result.datasets || [],
        metadata: {
          ...result.metadata,
          executionTime,
          toolName: tool.name,
          totalDatasets: result.datasets?.length || 0
        },
        executionTime,
        keplerActions
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      return {
        success: false,
        datasets: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime,
        keplerActions: []
      };
    }
  }

  /**
   * Create Kepler.gl actions for visualization
   */
  private createKeplerActions(result: AnalysisResult, toolName: string): any[] {
    if (!result.success || !result.datasets || result.datasets.length === 0) {
      return [];
    }

    // Get current Kepler.gl state to check if we have existing data
    const state = store.getState();
    const keplerGlState = state.keplerGl?.map;
    const existingDatasets = keplerGlState?.visState?.datasets || {};
    const hasExistingData = Object.keys(existingDatasets).length > 0;
    const existingDatasetIds = new Set(Object.keys(existingDatasets));

    console.log(`Current map has ${Object.keys(existingDatasets).length} existing datasets`);
    console.log("Existing dataset IDs:", Array.from(existingDatasetIds));

    // Filter out datasets that already exist to prevent duplicates
    const filteredDatasets = result.datasets.filter(dataset => {
      const exists = existingDatasetIds.has(dataset.id);
      if (exists) {
        console.log(`Skipping duplicate dataset: ${dataset.id}`);
      }
      return !exists;
    });

    if (filteredDatasets.length === 0) {
      console.log("No new datasets to add - all datasets already exist on map");
      return [];
    }

    // Process new datasets for Kepler.gl
    const newDatasets = filteredDatasets.map(dataset => ({
      info: {
        label: dataset.name,
        id: dataset.id
      },
      data: processGeojson(dataset.data) as any
    }));

    // Create layers from new (filtered) datasets only
    const newLayers: any[] = [];
    filteredDatasets.forEach(dataset => {
      if (dataset.visualizationConfig?.config?.visState?.layers) {
        newLayers.push(...dataset.visualizationConfig.config.visState.layers);
      }
    });

    // Create configuration for new data only
    const config = {
      visState: {
        layers: newLayers
      },
      mapStyle: {
        styleType: 'positron',
        visibleLayerGroups: {
          label: true,
          road: true,
          border: false,
          building: true,
          water: true,
          land: true,
          '3d building': false
        }
      }
    };

    console.log(`Adding ${newDatasets.length} new datasets with ${newLayers.length} new layers`);
    console.log("New datasets:", newDatasets.map(d => d.info.id));
    console.log("New layer IDs:", newLayers.map(l => l.id));

    const action = addDataToMap({
      datasets: newDatasets,
      options: {
        centerMap: !hasExistingData,  // Only center map if no existing data
        readOnly: false,
        keepExistingConfig: true  // Let Kepler.gl handle layer merging
      },
      config
    });

    // Only update map view for first analysis
    if (!hasExistingData) {
      this.dispatch(updateMap({
        pitch: 45,
        bearing: 0,
        dragRotate: true
      }));
    }

    return [action];
  }

  /**
   * Validate analysis request
   */
  private validateAnalysisRequest(
    tool: any,
    data: FeatureCollection,
    fieldMapping: ColumnMapping,
    options: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate data
    const dataValidation = tool.validateData(data);
    if (!dataValidation.valid) {
      errors.push(...dataValidation.errors);
    }

    // Validate field mapping
    const mappingValidation = tool.validateFieldMapping(fieldMapping);
    if (!mappingValidation.valid) {
      errors.push(...mappingValidation.errors);
    }

    // Validate options
    const optionsValidation = tool.validateOptions(options);
    if (!optionsValidation.valid) {
      errors.push(...optionsValidation.errors);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Tools are initialized globally by /src/tools/index.ts - no need for separate initialization

  /**
   * Get all available tools
   */
  getAvailableTools() {
    return toolRegistry.getAllTools();
  }

  /**
   * Get tool by ID
   */
  getTool(toolId: string) {
    return toolRegistry.getTool(toolId);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string) {
    return toolRegistry.getToolsByCategory(category);
  }

  /**
   * Get tool documentation
   */
  getToolDocumentation(toolId: string) {
    const tool = toolRegistry.getTool(toolId);
    return tool?.getDocumentation?.() || null;
  }

  /**
   * Check if a tool can process given data
   */
  canToolProcessData(toolId: string, data: FeatureCollection) {
    const tool = toolRegistry.getTool(toolId);
    if (!tool) return false;
    const validation = tool.validateData(data);
    return validation.valid;
  }

  /**
   * Get recommended tools for data
   */
  getRecommendedTools(data: FeatureCollection) {
    return toolRegistry.getAllTools().filter(tool => this.canToolProcessData(tool.id, data));
  }
}

// Singleton instance
let unifiedAnalysisServiceInstance: UnifiedAnalysisService | null = null;

export const createUnifiedAnalysisService = (dispatch: AppDispatch): UnifiedAnalysisService => {
  if (!unifiedAnalysisServiceInstance) {
    unifiedAnalysisServiceInstance = new UnifiedAnalysisService(dispatch);
  }
  return unifiedAnalysisServiceInstance;
};

export const getUnifiedAnalysisService = (): UnifiedAnalysisService => {
  if (!unifiedAnalysisServiceInstance) {
    throw new Error('UnifiedAnalysisService not initialized. Call createUnifiedAnalysisService first.');
  }
  return unifiedAnalysisServiceInstance;
};