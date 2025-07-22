import { BaseTool, AnalysisContext, AnalysisResult } from '../interfaces/tool-interfaces';
import { FeatureCollection, ColumnMapping } from '../interfaces/data-interfaces';
import { DataService } from './data-service';
import { ToolManager } from './tool-manager';
import { AppDispatch } from '../stores/store';
import { progressService } from '../components/custom-components/progress-bar';

export interface AnalysisRequest {
  toolId: string;
  inputDataIds: string[];
  fieldMapping: ColumnMapping;
  options: Record<string, any>;
  sessionName?: string;
}

export interface AnalysisResponse {
  success: boolean;
  outputDataIds: string[];
  sessionId: string;
  error?: string;
  metadata?: Record<string, any>;
  executionTime: number;
}

export class AnalysisRunner {
  private dataService: DataService;
  private toolManager: ToolManager;
  private dispatch: AppDispatch;

  constructor(dataService: DataService, toolManager: ToolManager, dispatch: AppDispatch) {
    this.dataService = dataService;
    this.toolManager = toolManager;
    this.dispatch = dispatch;
  }

  /**
   * Execute a complete analysis workflow
   */
  async runAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
    const startTime = Date.now();
    
    try {
      // Get the tool
      const tool = this.toolManager.getTool(request.toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${request.toolId}`);
      }

      // Get input data
      const inputData = await this.getInputData(request.inputDataIds);
      if (!inputData) {
        throw new Error('Failed to retrieve input data');
      }

      // Validate the analysis request
      await this.validateAnalysisRequest(tool, inputData, request.fieldMapping, request.options);

      // Show progress
      progressService.show('Starting analysis...', 0);

      // Execute the tool using the tool manager
      const result = await this.toolManager.executeTool({
        toolId: request.toolId,
        inputDataIds: request.inputDataIds,
        fieldMapping: request.fieldMapping,
        options: request.options,
        dataService: this.dataService,
      });

      const executionTime = Date.now() - startTime;

      if (!result.success) {
        return {
          success: false,
          outputDataIds: [],
          sessionId: '',
          error: result.error,
          executionTime,
        };
      }

      return {
        success: true,
        outputDataIds: result.outputDataIds,
        sessionId: '', // This would be set by the tool manager
        metadata: result.metadata,
        executionTime,
      };

    } catch (error) {
      progressService.hide();
      const executionTime = Date.now() - startTime;
      
      return {
        success: false,
        outputDataIds: [],
        sessionId: '',
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime,
      };
    }
  }

  /**
   * Run multiple analyses in sequence
   */
  async runAnalysisChain(requests: AnalysisRequest[]): Promise<AnalysisResponse[]> {
    const results: AnalysisResponse[] = [];
    
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      
      // Update input data IDs to use outputs from previous analyses
      if (i > 0 && results[i - 1].success) {
        request.inputDataIds = results[i - 1].outputDataIds;
      }
      
      const result = await this.runAnalysis(request);
      results.push(result);
      
      // Stop chain if any analysis fails
      if (!result.success) {
        break;
      }
    }
    
    return results;
  }

  /**
   * Run multiple analyses in parallel
   */
  async runParallelAnalyses(requests: AnalysisRequest[]): Promise<AnalysisResponse[]> {
    const promises = requests.map(request => this.runAnalysis(request));
    return Promise.all(promises);
  }

  /**
   * Get analysis recommendations based on data
   */
  async getAnalysisRecommendations(dataIds: string[]): Promise<{
    recommended: BaseTool[];
    compatible: BaseTool[];
    reasons: Record<string, string>;
  }> {
    const inputData = await this.getInputData(dataIds);
    if (!inputData) {
      return { recommended: [], compatible: [], reasons: {} };
    }

    const allTools = this.toolManager.getAllTools();
    const recommended: BaseTool[] = [];
    const compatible: BaseTool[] = [];
    const reasons: Record<string, string> = {};

    for (const tool of allTools) {
      const canProcess = this.toolManager.canToolProcessData(tool.id, inputData);
      
      if (canProcess) {
        // Simple heuristics for recommendations
        const isRecommended = this.isToolRecommended(tool, inputData);
        
        if (isRecommended) {
          recommended.push(tool);
          reasons[tool.id] = this.getRecommendationReason(tool, inputData);
        } else {
          compatible.push(tool);
        }
      }
    }

    return { recommended, compatible, reasons };
  }

  /**
   * Validate analysis request
   */
  private async validateAnalysisRequest(
    tool: BaseTool,
    data: FeatureCollection,
    fieldMapping: ColumnMapping,
    options: Record<string, any>
  ): Promise<void> {
    // Validate data
    const dataValidation = tool.validateData(data);
    if (!dataValidation.valid) {
      throw new Error(`Data validation failed: ${dataValidation.errors.join(', ')}`);
    }

    // Validate field mapping
    const mappingValidation = tool.validateFieldMapping(fieldMapping);
    if (!mappingValidation.valid) {
      throw new Error(`Field mapping validation failed: ${mappingValidation.errors.join(', ')}`);
    }

    // Validate options
    const optionsValidation = tool.validateOptions(options);
    if (!optionsValidation.valid) {
      throw new Error(`Options validation failed: ${optionsValidation.errors.join(', ')}`);
    }
  }

  /**
   * Get input data from data service
   */
  private async getInputData(dataIds: string[]): Promise<FeatureCollection | null> {
    if (dataIds.length === 0) {
      return null;
    }

    // For now, we'll use the first data source
    // In a full implementation, this would merge multiple data sources
    // This needs to be implemented to get data from the Redux store
    return null;
  }

  /**
   * Simple heuristics to determine if a tool is recommended
   */
  private isToolRecommended(tool: BaseTool, data: FeatureCollection): boolean {
    const features = data.features;
    if (features.length === 0) return false;

    const firstFeature = features[0];
    const properties = firstFeature.properties || {};
    
    // Check for time-related fields for time geography tools
    if (tool.id === 'time-geography') {
      const hasTimeField = Object.keys(properties).some(key => 
        key.toLowerCase().includes('time') || 
        key.toLowerCase().includes('date') ||
        key.toLowerCase().includes('timestamp')
      );
      return hasTimeField && features.length > 10;
    }

    // Add more heuristics for other tools
    return false;
  }

  /**
   * Get recommendation reason
   */
  private getRecommendationReason(tool: BaseTool, data: FeatureCollection): string {
    if (tool.id === 'time-geography') {
      return `Detected ${data.features.length} trajectory points with temporal data`;
    }
    
    return `Compatible with your data structure`;
  }

  /**
   * Get analysis history
   */
  getAnalysisHistory(): any[] {
    // This would return analysis history from the data store
    return [];
  }

  /**
   * Cancel running analysis
   */
  async cancelAnalysis(sessionId: string): Promise<boolean> {
    // This would implement analysis cancellation
    progressService.hide();
    return true;
  }
}

// Singleton instance
let analysisRunnerInstance: AnalysisRunner | null = null;

export const createAnalysisRunner = (
  dataService: DataService, 
  toolManager: ToolManager, 
  dispatch: AppDispatch
): AnalysisRunner => {
  if (!analysisRunnerInstance) {
    analysisRunnerInstance = new AnalysisRunner(dataService, toolManager, dispatch);
  }
  return analysisRunnerInstance;
};

export const getAnalysisRunner = (): AnalysisRunner => {
  if (!analysisRunnerInstance) {
    throw new Error('AnalysisRunner not initialized. Call createAnalysisRunner first.');
  }
  return analysisRunnerInstance;
};