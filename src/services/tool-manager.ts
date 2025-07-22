import { BaseTool, AnalysisContext, AnalysisResult } from '../interfaces/tool-interfaces';
import { FeatureCollection, ColumnMapping } from '../interfaces/data-interfaces';
import { DataService } from './data-service';
import { AppDispatch } from '../stores/store';
import { progressService } from '../components/custom-components/progress-bar';

export interface ToolExecutionContext {
  toolId: string;
  inputDataIds: string[];
  fieldMapping: ColumnMapping;
  options: Record<string, any>;
  dataService: DataService;
}

export interface ToolExecutionResult {
  success: boolean;
  outputDataIds: string[];
  error?: string;
  metadata?: Record<string, any>;
}

export class ToolManager {
  private tools: Map<string, BaseTool> = new Map();
  private dataService: DataService;

  constructor(dataService: DataService) {
    this.dataService = dataService;
  }

  /**
   * Register a tool with the manager
   */
  registerTool(tool: BaseTool): void {
    this.tools.set(tool.id, tool);
    console.log(`Registered tool: ${tool.name} (${tool.id})`);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolId: string): void {
    if (this.tools.delete(toolId)) {
      console.log(`Unregistered tool: ${toolId}`);
    }
  }

  /**
   * Get a specific tool
   */
  getTool(toolId: string): BaseTool | undefined {
    return this.tools.get(toolId);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): BaseTool[] {
    return this.getAllTools().filter(tool => tool.category === category);
  }

  /**
   * Execute a tool with comprehensive data management
   */
  async executeTool(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { toolId, inputDataIds, fieldMapping, options } = context;
    
    const tool = this.getTool(toolId);
    if (!tool) {
      return {
        success: false,
        outputDataIds: [],
        error: `Tool not found: ${toolId}`,
      };
    }

    try {
      // Show progress
      progressService.show('Preparing analysis...', 0);

      // Get input data from data service
      const inputData = await this.getInputData(inputDataIds);
      if (!inputData) {
        return {
          success: false,
          outputDataIds: [],
          error: 'Failed to retrieve input data',
        };
      }

      // Validate inputs
      const validation = this.validateToolInputs(tool, inputData, fieldMapping, options);
      if (!validation.valid) {
        return {
          success: false,
          outputDataIds: [],
          error: `Validation failed: ${validation.errors.join(', ')}`,
        };
      }

      progressService.update(10, 'Validation complete, starting analysis...');

      // Create analysis context
      const analysisContext: AnalysisContext = {
        data: inputData,
        fieldMapping,
        options,
        toolId,
      };

      // Execute tool with progress tracking
      const result = await tool.analyze(analysisContext, (progress, message) => {
        progressService.update(10 + (progress * 0.8), message);
      });

      if (!result.success) {
        progressService.hide();
        return {
          success: false,
          outputDataIds: [],
          error: result.error || 'Analysis failed',
        };
      }

      progressService.update(95, 'Processing results...');

      // Process results and create data sources
      const outputDataIds = await this.dataService.processDataWithTool(
        toolId,
        tool.name,
        inputDataIds,
        fieldMapping,
        options,
        async () => ({
          datasets: result.datasets || [],
          metadata: result.metadata,
        })
      );

      progressService.update(100, 'Analysis complete!');
      setTimeout(() => progressService.hide(), 1000);

      return {
        success: true,
        outputDataIds,
        metadata: result.metadata,
      };

    } catch (error) {
      progressService.hide();
      console.error('Tool execution error:', error);
      
      return {
        success: false,
        outputDataIds: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Validate tool inputs comprehensively
   */
  private validateToolInputs(
    tool: BaseTool,
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
      errors,
    };
  }

  /**
   * Get input data from data service
   */
  private async getInputData(inputDataIds: string[]): Promise<FeatureCollection | null> {
    if (inputDataIds.length === 0) {
      return null;
    }

    // For now, we'll use the first data source
    // In the future, this could merge multiple data sources
    const firstDataId = inputDataIds[0];
    
    // This would need to be implemented to get data from the Redux store
    // For now, return null to indicate we need to implement this
    return null;
  }

  /**
   * Get tool documentation
   */
  getToolDocumentation(toolId: string): string | null {
    const tool = this.getTool(toolId);
    return tool?.getDocumentation?.() || null;
  }

  /**
   * Get example data for a tool
   */
  getToolExampleData(toolId: string): FeatureCollection | null {
    const tool = this.getTool(toolId);
    return tool?.getExampleData?.() || null;
  }

  /**
   * Check if a tool can process given data
   */
  canToolProcessData(toolId: string, data: FeatureCollection): boolean {
    const tool = this.getTool(toolId);
    if (!tool) return false;

    const validation = tool.validateData(data);
    return validation.valid;
  }

  /**
   * Get recommended tools for given data
   */
  getRecommendedTools(data: FeatureCollection): BaseTool[] {
    return this.getAllTools().filter(tool => this.canToolProcessData(tool.id, data));
  }

  /**
   * Get tool statistics
   */
  getToolStatistics(): {
    totalTools: number;
    toolsByCategory: Record<string, number>;
    recentlyUsed: string[];
  } {
    const tools = this.getAllTools();
    const toolsByCategory = tools.reduce((acc, tool) => {
      acc[tool.category] = (acc[tool.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalTools: tools.length,
      toolsByCategory,
      recentlyUsed: [], // This would track recently used tools
    };
  }
}

// Singleton instance
let toolManagerInstance: ToolManager | null = null;

export const createToolManager = (dataService: DataService): ToolManager => {
  if (!toolManagerInstance) {
    toolManagerInstance = new ToolManager(dataService);
  }
  return toolManagerInstance;
};

export const getToolManager = (): ToolManager => {
  if (!toolManagerInstance) {
    throw new Error('ToolManager not initialized. Call createToolManager first.');
  }
  return toolManagerInstance;
};