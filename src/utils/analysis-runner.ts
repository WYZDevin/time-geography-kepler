import { AnalysisContext, AnalysisResult, DatasetResult, ProgressCallback } from '../interfaces/tool-interfaces';
import { toolRegistry } from './tool-registry';
import { addDataToMap } from '@kepler.gl/actions';
import { processGeojson } from '@kepler.gl/processors';
import store from "@/stores/store";
import { updateMap } from '@kepler.gl/actions';

export class AnalysisRunner {
    /**
     * Execute a tool analysis
     */
    static async executeAnalysis(
        context: AnalysisContext, 
        progressCallback?: ProgressCallback
    ): Promise<AnalysisResult> {
        const tool = toolRegistry.getTool(context.toolId);
        
        if (!tool) {
            return {
                success: false,
                error: `Tool with id "${context.toolId}" not found`
            };
        }

        try {
            // Validate data
            const dataValidation = tool.validateData(context.data);
            if (!dataValidation.valid) {
                return {
                    success: false,
                    error: `Data validation failed: ${dataValidation.errors.join(', ')}`
                };
            }

            // Validate field mapping
            const fieldValidation = tool.validateFieldMapping(context.fieldMapping);
            if (!fieldValidation.valid) {
                return {
                    success: false,
                    error: `Field mapping validation failed: ${fieldValidation.errors.join(', ')}`
                };
            }

            // Validate options
            const optionsValidation = tool.validateOptions(context.options);
            if (!optionsValidation.valid) {
                return {
                    success: false,
                    error: `Options validation failed: ${optionsValidation.errors.join(', ')}`
                };
            }

            // Execute pre-analysis hook
            if (tool.onBeforeAnalysis) {
                await tool.onBeforeAnalysis(context);
            }

            // Execute the analysis
            const startTime = Date.now();
            
            progressCallback?.(0, `Starting ${tool.name} analysis...`);
            
            const result = await tool.analyze(context, progressCallback);
            
            // Simplified visualization processing - tools now create their own configs
            if (result.success && result.datasets) {
                progressCallback?.(90, 'Processing visualization configuration...');
                
                // Count total layers across all datasets
                const totalLayers = result.datasets.reduce((count, dataset) => {
                    const layerCount = dataset.visualizationConfig?.config?.visState?.layers?.length || 0;
                    return count + layerCount;
                }, 0);

                // Update metadata
                if (result.metadata) {
                    result.metadata.totalLayers = totalLayers;
                    result.metadata.totalDatasets = result.datasets.length;
                }

                console.log(`Analysis complete with ${result.datasets.length} datasets and ${totalLayers} layers`);
            }
            
            // Add processing metadata
            const endTime = Date.now();
            if (result.success && result.metadata) {
                result.metadata.processingTime = endTime - startTime;
            }

            // Execute post-analysis hook
            if (tool.onAfterAnalysis) {
                await tool.onAfterAnalysis(result);
            }

            progressCallback?.(100, 'Analysis complete');
            
            return result;

        } catch (error) {
            console.error('Analysis execution error:', error);
            return {
                success: false,
                error: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Create Kepler.gl actions for adding analysis results to map
     * Preserves existing datasets and layers when adding new ones
     */
    static createKeplerActions(result: AnalysisResult, toolName: string) {
        if (!result.success || !result.datasets || result.datasets.length === 0) {
            return [];
        }

        // Get current Kepler.gl state to check if we have existing data
        const state = store.getState();
        const keplerGlState = state.keplerGl?.map;
        const existingDatasets = keplerGlState?.visState?.datasets || {};
        const hasExistingData = Object.keys(existingDatasets).length > 0;

        console.log(`Current map has ${Object.keys(existingDatasets).length} existing datasets`);

        // Process new datasets for Kepler.gl
        const newDatasets = result.datasets.map(dataset => ({
            info: {
                label: dataset.name,
                id: dataset.id
            },
            data: processGeojson(dataset.data) as any
        }));

        // Create layers from new datasets
        const newLayers: any[] = [];
        result.datasets.forEach(dataset => {
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
            store.dispatch(updateMap({
                pitch: 45,
                bearing: 0,
                dragRotate: true
            }));
        }

        return [action];
    }

    /**
     * Legacy method for backward compatibility - uses first dataset
     */
    static createKeplerAction(result: AnalysisResult, toolName: string) {
        const actions = this.createKeplerActions(result, toolName);
        return actions.length > 0 ? actions[0] : null;
    }

    /**
     * Validate if a tool can be executed with given context
     */
    static validateExecution(context: AnalysisContext): { valid: boolean; errors: string[] } {
        const tool = toolRegistry.getTool(context.toolId);
        const errors: string[] = [];

        if (!tool) {
            errors.push(`Tool "${context.toolId}" not found`);
            return { valid: false, errors };
        }

        // Check required fields are mapped
        for (const requiredField of tool.requiredFields) {
            const mappedField = context.fieldMapping[requiredField as keyof typeof context.fieldMapping];
            if (!mappedField) {
                errors.push(`Required field "${requiredField}" is not mapped`);
            }
        }

        // Validate with tool-specific validators
        const dataValidation = tool.validateData(context.data);
        const fieldValidation = tool.validateFieldMapping(context.fieldMapping);
        const optionsValidation = tool.validateOptions(context.options);

        errors.push(...dataValidation.errors);
        errors.push(...fieldValidation.errors);
        errors.push(...optionsValidation.errors);

        return {
            valid: errors.length === 0,
            errors
        };
    }
} 