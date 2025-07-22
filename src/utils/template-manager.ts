import { ColumnMapping } from '../interfaces/data-interfaces';
import { 
    createCustomLineLayer,
    createCustomConfigPoints,
    createCustomConfigActivitySpace,
    createCustomConfigAquarim,
    createCustomConfigSTKDE,
    createCustomConfigAxisLine,
    createCustomConfigAxisLabel
} from './config';
import { PROCESSED_NEIGHBORS_FIELD, PROCESSED_TIME_FIELD, PROCESSED_HEIGHT_FIELD } from './constants';

// Layer configuration interface
export interface LayerConfig {
    id: string;
    type: string;
    config: any;
    visualChannels?: any;
}

// Template configuration for each tool
export interface ToolTemplate {
    templateId: string;
    name: string;
    description: string;
    createLayers: (dataId: string, fieldMapping: ColumnMapping, options?: Record<string, any>) => LayerConfig[];
    fieldMappings: {
        [layerId: string]: {
            requiredFields: string[];
            optionalFields?: string[];
        };
    };
}

// Dataset visualization configuration
export interface DatasetVisualization {
    dataId: string;
    layers: LayerConfig[];
    metadata?: Record<string, any>;
}

// Complete map configuration
export interface MapConfiguration {
    datasets: DatasetVisualization[];
    mapState?: any;
    mapStyle?: any;
    interactionConfig?: any;
}

// Template factory functions - now return arrays of layers
const createTimeGeographyLayers = (
    dataId: string, 
    fieldMapping: ColumnMapping, 
    options: Record<string, any> = {}
): LayerConfig[] => {
    const layers: LayerConfig[] = [];
    
    // Main trajectory layer
    const trajectoryLayer = createCustomLineLayer(
        fieldMapping.latitude || 'latitude', 
        fieldMapping.longitude || 'longitude'
    );
    trajectoryLayer.config.dataId = dataId;
    trajectoryLayer.config.label = 'Space-Time Trajectory';
    
    layers.push({
        id: `${dataId}-trajectory`,
        type: trajectoryLayer.type,
        config: trajectoryLayer.config
    });

    // Add stay points layer if enabled
    if (options.visualizeStay) {
        layers.push({
            id: `${dataId}-stay-points`,
            type: 'point',
            config: {
                dataId: dataId,
                columnMode: 'points',
                label: 'Stay Points',
                color: [231, 76, 60],
                columns: {
                    lat: fieldMapping.latitude || 'latitude',
                    lng: fieldMapping.longitude || 'longitude'
                },
                isVisible: true,
                visConfig: {
                    opacity: 0.8,
                    radius: 15,
                    filled: true,
                    stroked: true,
                    thickness: 3,
                    elevationScale: options.timeWindow ? Math.max(1, options.timeWindow / 24 * 10) : 10
                }
            },
            visualChannels: {
                colorField: { name: '_is_stay_point', type: 'boolean' },
                colorScale: 'quantile'
            }
        });
    }

    return layers;
};

const createBasicPointsLayers = (
    dataId: string, 
    fieldMapping: ColumnMapping, 
    options: Record<string, any> = {}
): LayerConfig[] => {
    const pointsConfig = createCustomConfigPoints(
        fieldMapping.latitude || 'latitude', 
        fieldMapping.longitude || 'longitude', 
        fieldMapping.time || 'time'
    );
    
    // Extract the layer from the nested structure
    const pointLayer = pointsConfig.visState.layers[0];
    pointLayer.config.dataId = dataId;
    
    return [{
        id: `${dataId}-points`,
        type: pointLayer.type,
        config: pointLayer.config
    }];
};

const createSTKDELayers = (
    dataId: string, 
    fieldMapping: ColumnMapping, 
    options: Record<string, any> = {}
): LayerConfig[] => {
    const stkdeLayer = createCustomConfigSTKDE(
        dataId, 
        false, 
        "Space-Time KDE", 
        options.percent || 99, 
        options.opacity || 0.8
    );
    
    return [{
        id: `${dataId}-stkde`,
        type: stkdeLayer.type,
        config: stkdeLayer.config,
        visualChannels: stkdeLayer.visualChannels
    }];
};

const createActivitySpaceLayers = (
    dataId: string, 
    fieldMapping: ColumnMapping, 
    options: Record<string, any> = {}
): LayerConfig[] => {
    const activityLayer = createCustomConfigActivitySpace(dataId, false, "Activity Space");
    
    return [{
        id: `${dataId}-activity-space`,
        type: activityLayer.type,
        config: activityLayer.config,
        visualChannels: activityLayer.visualChannels
    }];
};

const createStayPointsLayers = (
    dataId: string, 
    fieldMapping: ColumnMapping, 
    options: Record<string, any> = {}
): LayerConfig[] => {
    return [{
        id: `${dataId}-stay-detection`,
        type: 'point',
        config: {
            dataId: dataId,
            columnMode: 'points',
            label: 'Stay Points',
            color: [231, 76, 60],
            columns: {
                lat: fieldMapping.latitude || 'latitude',
                lng: fieldMapping.longitude || 'longitude'
            },
            isVisible: true,
            visConfig: {
                opacity: 0.8,
                radius: 20,
                radiusRange: [5, 50],
                filled: true,
                stroked: true,
                strokeColor: [255, 255, 255],
                thickness: 2
            }
        },
        visualChannels: {
            sizeField: { name: '_stay_duration', type: 'real' },
            sizeScale: 'linear',
            colorField: { name: '_stay_id', type: 'integer' },
            colorScale: 'quantile'
        }
    }];
};

const createAxisLayers = (
    dataId: string, 
    fieldMapping: ColumnMapping, 
    options: Record<string, any> = {}
): LayerConfig[] => {
    const axisLineLayer = createCustomConfigAxisLine(dataId, false, "Coordinate Axes");
    const axisLabelLayer = createCustomConfigAxisLabel(dataId, false, "Axis Labels");
    
    return [
        {
            id: `${dataId}-axis-lines`,
            type: axisLineLayer.type,
            config: axisLineLayer.config,
            visualChannels: axisLineLayer.visualChannels
        },
        {
            id: `${dataId}-axis-labels`,
            type: axisLabelLayer.type,
            config: axisLabelLayer.config
        }
    ];
};

const createAquariumLayers = (
    dataId: string, 
    fieldMapping: ColumnMapping, 
    options: Record<string, any> = {}
): LayerConfig[] => {
    const aquariumLayer = createCustomConfigAquarim(dataId, false, "Aquarium");
    
    return [{
        id: `${dataId}-aquarium`,
        type: aquariumLayer.type,
        config: aquariumLayer.config,
        visualChannels: aquariumLayer.visualChannels
    }];
};

// Template definitions for each tool
export const TOOL_TEMPLATES: Record<string, ToolTemplate> = {
    'time-geography': {
        templateId: 'time-geography',
        name: 'Time Geography 3D Line',
        description: 'Visualizes trajectory data as 3D lines with time elevation',
        fieldMappings: {
            'trajectory-layer': {
                requiredFields: ['latitude', 'longitude', PROCESSED_NEIGHBORS_FIELD, PROCESSED_TIME_FIELD],
                optionalFields: ['altitude']
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createTimeGeographyLayers(dataId, fieldMapping, options)
    },
    'space-time-kde': {
        templateId: 'space-time-kde',
        name: 'Space-Time KDE Visualization',
        description: 'Visualizes kernel density estimation with height-based time dimension',
        fieldMappings: {
            'stkde-layer': {
                requiredFields: ['_geojson', PROCESSED_HEIGHT_FIELD]
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createSTKDELayers(dataId, fieldMapping, options)
    },
    'convex-hull': {
        templateId: 'convex-hull',
        name: 'Convex Hull Visualization',
        description: 'Visualizes convex hulls around spatial data',
        fieldMappings: {
            'hull-layer': {
                requiredFields: ['_geojson']
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createActivitySpaceLayers(dataId, fieldMapping, options)
    },
    'trajectory-3d-line': {
        templateId: 'trajectory-3d-line',
        name: '3D Trajectory Line',
        description: 'Visualizes trajectory as 3D line with neighbors',
        fieldMappings: {
            'line-layer': {
                requiredFields: ['latitude', 'longitude', PROCESSED_NEIGHBORS_FIELD, PROCESSED_TIME_FIELD]
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createTimeGeographyLayers(dataId, fieldMapping, options)
    },
    'stay-point-detection': {
        templateId: 'stay-point-detection',
        name: 'Stay Point Detection',
        description: 'Visualizes detected stay points with clustering indicators',
        fieldMappings: {
            'stay-layer': {
                requiredFields: ['latitude', 'longitude', '_stay_duration'],
                optionalFields: ['_stay_id']
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createStayPointsLayers(dataId, fieldMapping, options)
    },
    'spatial-clustering': {
        templateId: 'spatial-clustering',
        name: 'Spatial Clustering',
        description: 'Visualizes spatial clusters with activity space',
        fieldMappings: {
            'cluster-layer': {
                requiredFields: ['_geojson', '_cluster_id']
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createActivitySpaceLayers(dataId, fieldMapping, options)
    },
    'temporal-aggregation': {
        templateId: 'temporal-aggregation',
        name: 'Temporal Aggregation',
        description: 'Visualizes temporal aggregation with time-based styling',
        fieldMappings: {
            'temporal-layer': {
                requiredFields: ['latitude', 'longitude', '_count', '_time_bin']
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createBasicPointsLayers(dataId, fieldMapping, options)
    },
    'trajectory-visualization': {
        templateId: 'trajectory-visualization',
        name: 'Basic Trajectory Visualization',
        description: 'Simple point-based trajectory visualization',
        fieldMappings: {
            'points-layer': {
                requiredFields: ['latitude', 'longitude'],
                optionalFields: ['time', 'altitude']
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createBasicPointsLayers(dataId, fieldMapping, options)
    },
    'coordinate-axes': {
        templateId: 'coordinate-axes',
        name: 'Coordinate Axes Visualization',
        description: 'Displays 3D coordinate axes with labels',
        fieldMappings: {
            'axis-layer': {
                requiredFields: ['_geojson'],
                optionalFields: ['text']
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createAxisLayers(dataId, fieldMapping, options)
    },
    'aquarium': {
        templateId: 'aquarium',
        name: 'Aquarium Visualization',
        description: 'Semi-transparent 3D visualization for space-time aquarium',
        fieldMappings: {
            'aquarium-layer': {
                requiredFields: ['_geojson']
            }
        },
        createLayers: (dataId, fieldMapping, options = {}) => 
            createAquariumLayers(dataId, fieldMapping, options)
    }
};

/**
 * Template manager class for handling multiple datasets and layers
 */
export class TemplateManager {
    /**
     * Get template for a specific tool
     */
    static getTemplate(toolId: string): ToolTemplate | null {
        return TOOL_TEMPLATES[toolId] || null;
    }

    /**
     * Create layers for a single dataset using its template
     */
    static createDatasetLayers(
        toolId: string,
        dataId: string,
        fieldMapping: ColumnMapping,
        options: Record<string, any> = {}
    ): LayerConfig[] {
        const template = this.getTemplate(toolId);
        if (!template) {
            console.warn(`No template found for tool: ${toolId}`);
            return [];
        }

        return template.createLayers(dataId, fieldMapping, options);
    }

    /**
     * Create visualization configuration for multiple datasets
     */
    static createMultiDatasetVisualization(
        datasets: Array<{
            toolId: string;
            dataId: string;
            fieldMapping: ColumnMapping;
            options?: Record<string, any>;
            metadata?: Record<string, any>;
        }>
    ): DatasetVisualization[] {
        return datasets.map(dataset => ({
            dataId: dataset.dataId,
            layers: this.createDatasetLayers(
                dataset.toolId,
                dataset.dataId,
                dataset.fieldMapping,
                dataset.options || {}
            ),
            metadata: dataset.metadata
        }));
    }

    /**
     * Create complete Kepler.gl configuration for all datasets
     */
    static createCompleteMapConfig(
        datasets: Array<{
            toolId: string;
            dataId: string;
            fieldMapping: ColumnMapping;
            options?: Record<string, any>;
            metadata?: Record<string, any>;
        }>,
        mapOptions: {
            mapState?: any;
            mapStyle?: any;
            interactionConfig?: any;
        } = {}
    ): any {
        // Create all layers from all datasets
        const allLayers: LayerConfig[] = [];
        const datasetVisualizations: DatasetVisualization[] = [];

        datasets.forEach(dataset => {
            const layers = this.createDatasetLayers(
                dataset.toolId,
                dataset.dataId,
                dataset.fieldMapping,
                dataset.options || {}
            );

            allLayers.push(...layers);
            datasetVisualizations.push({
                dataId: dataset.dataId,
                layers,
                metadata: dataset.metadata
            });
        });

        // Create tooltip configuration for all datasets
        const tooltipConfig = this.createTooltipConfig(datasets);

        console.log(`Creating map config with ${allLayers.length} layers from ${datasets.length} datasets`);

        return {
            config: {
                visState: {
                    layers: allLayers,
                    interactionConfig: {
                        tooltip: tooltipConfig,
                        brush: { size: 0.5, enabled: false },
                        geocoder: { enabled: false },
                        coordinate: { enabled: false },
                        ...(mapOptions.interactionConfig || {})
                    },
                    // layerBlending: 'normal',
                    // overlayBlending: 'normal'
                },
                mapState: {
                    dragRotate: true,
                    isSplit: false,
                    ...(mapOptions.mapState || {})
                },
                mapStyle: {
                    styleType: 'dark-matter',
                    visibleLayerGroups: {
                        label: true,
                        road: true,
                        border: false,
                        building: true,
                        water: true,
                        land: true,
                        '3d building': false
                    },
                    ...(mapOptions.mapStyle || {})
                }
            },
            datasets: datasetVisualizations
        };
    }

    /**
     * Create tooltip configuration for all datasets
     */
    private static createTooltipConfig(
        datasets: Array<{
            toolId: string;
            dataId: string;
            fieldMapping: ColumnMapping;
            options?: Record<string, any>;
        }>
    ): any {
        const fieldsToShow: Record<string, Array<{ name: string; format: string | null }>> = {};

        datasets.forEach(dataset => {
            const fields = [];

            // Add mapped fields
            if (dataset.fieldMapping.time) {
                fields.push({ name: dataset.fieldMapping.time, format: null });
            }
            if (dataset.fieldMapping.latitude) {
                fields.push({ name: dataset.fieldMapping.latitude, format: null });
            }
            if (dataset.fieldMapping.longitude) {
                fields.push({ name: dataset.fieldMapping.longitude, format: null });
            }

            // Add processed fields if they exist
            fields.push({ name: PROCESSED_TIME_FIELD, format: null });

            // Add tool-specific fields
            switch (dataset.toolId) {
                case 'stay-point-detection':
                    fields.push(
                        { name: '_stay_duration', format: null },
                        { name: '_stay_id', format: null }
                    );
                    break;
                case 'coordinate-axes':
                    fields.push(
                        { name: 'axis_type', format: null },
                        { name: 'text', format: null }
                    );
                    break;
            }

            fieldsToShow[dataset.dataId] = fields;
        });

        return {
            fieldsToShow,
            compareMode: false,
            compareType: 'absolute',
            enabled: true
        };
    }

    /**
     * Get all available templates
     */
    static getAllTemplates(): Record<string, ToolTemplate> {
        return TOOL_TEMPLATES;
    }

    /**
     * Validate template compatibility with tool
     */
    static validateTemplate(toolId: string, fieldMapping: ColumnMapping): {
        valid: boolean;
        errors: string[];
    } {
        const template = this.getTemplate(toolId);
        const errors: string[] = [];

        if (!template) {
            errors.push(`No template found for tool: ${toolId}`);
            return { valid: false, errors };
        }

        // Check if required fields are mapped for each layer
        Object.entries(template.fieldMappings).forEach(([layerId, mapping]) => {
            mapping.requiredFields.forEach(field => {
                if (!fieldMapping[field as keyof ColumnMapping]) {
                    errors.push(`Required field '${field}' is not mapped for layer '${layerId}'`);
                }
            });
        });

        return {
            valid: errors.length === 0,
            errors
        };
    }
} 