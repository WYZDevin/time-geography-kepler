import { 
    BaseTool, 
    AnalysisContext, 
    AnalysisResult, 
    DatasetResult,
    ProgressCallback,
    ToolOption 
} from '../interfaces/tool-interfaces';
import { FeatureCollection, ColumnMapping } from '../interfaces/data-interfaces';
import { validateGeoJSON } from '../utils/data-utils';

export abstract class AbstractBaseTool implements BaseTool {
    // Tool metadata - must be implemented by subclasses
    abstract readonly id: string;
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly icon: string;
    abstract readonly category: 'visualization' | 'analysis' | 'processing';
    abstract readonly version: string;
    abstract readonly requiredFields: string[];
    
    // Optional metadata with defaults
    readonly author?: string = 'Unknown';
    readonly optionalFields?: string[] = [];
    
    // Tool options - must be implemented by subclasses
    abstract readonly options: ToolOption[];
    
    // Abstract analysis method - must be implemented by subclasses
    abstract analyze(context: AnalysisContext, progressCallback?: ProgressCallback): Promise<AnalysisResult>;

    // Default data validation
    validateData(data: FeatureCollection): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!validateGeoJSON(data)) {
            errors.push('Invalid GeoJSON structure');
        }
        
        if (data.features.length === 0) {
            errors.push('Dataset contains no features');
        }

        // Check if features have properties (needed for field mapping)
        const hasProperties = data.features.some(feature => 
            feature.properties && Object.keys(feature.properties).length > 0
        );
        
        if (!hasProperties) {
            errors.push('No feature properties found for field mapping');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Default field mapping validation
    validateFieldMapping(mapping: ColumnMapping): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        // Check required fields are mapped
        for (const requiredField of this.requiredFields) {
            const mappedValue = mapping[requiredField as keyof ColumnMapping];
            if (!mappedValue || mappedValue.trim() === '') {
                errors.push(`Required field "${requiredField}" must be mapped`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Default options validation
    validateOptions(options: Record<string, any>): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        // Validate each option according to its definition
        for (const option of this.options) {
            const value = options[option.key];
            
            // Check required options
            if (option.required && (value === undefined || value === null)) {
                errors.push(`Required option "${option.label}" is missing`);
                continue;
            }
            
            // Skip validation if value is not provided and not required
            if (value === undefined || value === null) {
                continue;
            }
            
            // Type-specific validation
            switch (option.type) {
                case 'number':
                    if (typeof value !== 'number' || isNaN(value)) {
                        errors.push(`Option "${option.label}" must be a valid number`);
                    } else {
                        const numOption = option as any;
                        if (numOption.min !== undefined && value < numOption.min) {
                            errors.push(`Option "${option.label}" must be at least ${numOption.min}`);
                        }
                        if (numOption.max !== undefined && value > numOption.max) {
                            errors.push(`Option "${option.label}" must be at most ${numOption.max}`);
                        }
                    }
                    break;
                
                case 'boolean':
                    if (typeof value !== 'boolean') {
                        errors.push(`Option "${option.label}" must be a boolean value`);
                    }
                    break;
                
                case 'string':
                    if (typeof value !== 'string') {
                        errors.push(`Option "${option.label}" must be a string`);
                    }
                    break;
                
                case 'select': {
                    const selectOption = option as any;
                    const validValues = selectOption.options.map((opt: any) => opt.value);
                    if (!validValues.includes(value)) {
                        errors.push(`Option "${option.label}" must be one of: ${validValues.join(', ')}`);
                    }
                    break;
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Utility method to create success result with multiple datasets
    protected createMultiDatasetResult(
        datasets: DatasetResult[],
        metadata?: Record<string, any>
    ): AnalysisResult {
        const totalFeatures = datasets.reduce((sum, ds) => sum + ds.data.features.length, 0);
        const templatesUsed = datasets
            .map(ds => ds.templateId)
            .filter(Boolean) as string[];

        return {
            success: true,
            datasets,
            metadata: {
                processedFeatures: totalFeatures,
                processingTime: 0, // Will be filled by UnifiedAnalysisService
                totalDatasets: datasets.length,
                templatesUsed,
                ...metadata
            }
        };
    }

    // Helper method to create a dataset result
    protected createDataset(
        id: string,
        name: string,
        data: FeatureCollection,
        options?: {
            description?: string;
            templateId?: string;
            visualizationConfig?: any;
            layers?: any[];
            metadata?: Record<string, any>;
        }
    ): DatasetResult {
        return {
            id,
            name,
            data,
            description: options?.description,
            templateId: options?.templateId,
            visualizationConfig: options?.visualizationConfig,
            layers: options?.layers,
            metadata: options?.metadata
        };
    }

    // Utility method to create error result
    protected createErrorResult(error: string): AnalysisResult {
        return {
            success: false,
            error
        };
    }

    // Helper method to get mapped field value from feature
    protected getMappedValue(feature: any, fieldMapping: ColumnMapping, fieldName: keyof ColumnMapping): any {
        const mappedFieldName = fieldMapping[fieldName];
        if (!mappedFieldName) return undefined;
        
        // Handle virtual fields for Point geometries
        if (mappedFieldName.startsWith('_') && feature.geometry?.type === 'Point') {
            switch (mappedFieldName) {
                case '_longitude':
                    return feature.geometry.coordinates[0];
                case '_latitude':
                    return feature.geometry.coordinates[1];
                case '_altitude':
                    return feature.geometry.coordinates[2];
            }
        }
        
        return feature.properties?.[mappedFieldName];
    }

    // Helper method to update progress safely
    protected updateProgress(callback: ProgressCallback | undefined, progress: number, message?: string): void {
        if (callback) {
            callback(Math.min(100, Math.max(0, progress)), message);
        }
    }
} 