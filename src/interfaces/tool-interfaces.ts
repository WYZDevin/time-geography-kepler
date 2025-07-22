import { FeatureCollection, ColumnMapping } from './data-interfaces';

// Base option types for tool configurations
export interface BaseToolOption {
    key: string;
    label: string;
    type: 'boolean' | 'number' | 'string' | 'select';
    defaultValue: any;
    required?: boolean;
    description?: string;
}

export interface NumberToolOption extends BaseToolOption {
    type: 'number';
    min?: number;
    max?: number;
    step?: number;
}

export interface SelectToolOption extends BaseToolOption {
    type: 'select';
    options: { value: string; label: string }[];
}

export interface BooleanToolOption extends BaseToolOption {
    type: 'boolean';
}

export interface StringToolOption extends BaseToolOption {
    type: 'string';
    placeholder?: string;
}

export type ToolOption = NumberToolOption | SelectToolOption | BooleanToolOption | StringToolOption;

// Analysis context and results
export interface AnalysisContext {
    data: FeatureCollection;
    fieldMapping: ColumnMapping;
    options: Record<string, any>;
    toolId: string;
}

export interface DatasetResult {
    id: string;
    name: string;
    description?: string;
    data: FeatureCollection;
    templateId?: string;
    visualizationConfig?: any;
    layers?: any[];
    metadata?: {
        [key: string]: any;
    };
}

export interface AnalysisResult {
    success: boolean;
    datasets?: DatasetResult[];
    error?: string;
    metadata?: {
        processedFeatures: number;
        processingTime: number;
        totalDatasets: number;
        templatesUsed: string[];
        [key: string]: any;
    };
}

// Progress callback for long-running analyses
export type ProgressCallback = (progress: number, message?: string) => void;

// Base tool interface that all tools must implement
export interface BaseTool {
    // Tool metadata
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly icon: string;
    readonly category: 'visualization' | 'analysis' | 'processing';
    readonly version: string;
    readonly author?: string;
    
    // Field requirements
    readonly requiredFields: string[];
    readonly optionalFields?: string[];
    
    // Tool options configuration
    readonly options: ToolOption[];
    
    // Visualization template support
    readonly templateId?: string;
    readonly supportsCustomVisualization?: boolean;
    
    // Validation methods
    validateData(data: FeatureCollection): { valid: boolean; errors: string[] };
    validateFieldMapping(mapping: ColumnMapping): { valid: boolean; errors: string[] };
    validateOptions(options: Record<string, any>): { valid: boolean; errors: string[] };
    
    // Main analysis function
    analyze(context: AnalysisContext, progressCallback?: ProgressCallback): Promise<AnalysisResult>;
    
    // Template and visualization methods
    getVisualizationConfig?(fieldMapping: ColumnMapping, options: Record<string, any>): any;
    createCustomLayers?(data: FeatureCollection, fieldMapping: ColumnMapping, options: Record<string, any>): any[];
    createDatasets?(data: FeatureCollection, fieldMapping: ColumnMapping, options: Record<string, any>): DatasetResult[];
    
    // Optional lifecycle methods
    onBeforeAnalysis?(context: AnalysisContext): Promise<void>;
    onAfterAnalysis?(result: AnalysisResult): Promise<void>;
    
    // Help and documentation
    getDocumentation?(): string;
    getExampleData?(): FeatureCollection;
}

// Tool registry interface
export interface ToolRegistry {
    register(tool: BaseTool): void;
    unregister(toolId: string): void;
    getTool(toolId: string): BaseTool | undefined;
    getAllTools(): BaseTool[];
    getToolsByCategory(category: string): BaseTool[];
}

// Factory for creating tool instances
export interface ToolFactory {
    createTool(toolId: string): BaseTool | undefined;
} 