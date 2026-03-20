import { AbstractBaseTool } from './base-tool';
import { AnalysisContext, AnalysisResult, DatasetResult, ProgressCallback, ToolOption } from '../interfaces/tool-interfaces';
import { FeatureCollection } from '../interfaces/data-interfaces';
import { preprocessGeojsonData } from '../data-processors/data-preprocessing';
import { PROCESSED_TIME_FIELD, PROCESSED_NEIGHBORS_FIELD, PROCESSED_HEIGHT_FIELD, COLORS } from '../utils/constants';
import store from '../stores/store';
import { selectSideLength } from '../stores/metadata-slice';
import { createSTKDE } from '../data-processors/stkde';
import { createCustomConfigSTKDE } from "../utils/config";
import { selectHeightScale } from "@/stores/metadata-slice";
export class TimeGeographyTool extends AbstractBaseTool {
    readonly id = 'time-geography';
    readonly name = 'Time Geography';
    readonly description = 'Analyze movement patterns and space-time paths';
    readonly icon = '🕐';
    readonly category = 'analysis' as const;
    readonly version = '1.0.0';
    readonly author = 'GISPark Team';

    readonly requiredFields = ['latitude', 'longitude', 'time'];
    readonly optionalFields = ['altitude'];

    readonly options: ToolOption[] = [
        {
            key: 'visualizeStay',
            label: 'Visualize Stay Points',
            type: 'boolean',
            defaultValue: false,
            description: 'Identify and highlight stay points in the trajectory'
        },
        {
            key: 'visualizeSTKDE',
            label: 'Visualize Space-Time KDE',
            type: 'boolean',
            defaultValue: false,
            description: 'Generate kernel density estimation in space and time'
        },
        {
            key: 'visualizeAxis',
            label: 'Show 3D Axis',
            type: 'boolean',
            defaultValue: false,
            description: 'Display 3D coordinate axes for time dimension'
        },
        {
            key: 'timeWindow',
            label: 'Time Window (hours)',
            type: 'number',
            defaultValue: 24,
            min: 1,
            max: 168,
            description: 'Time window for analysis in hours'
        }
    ];

    async analyze(context: AnalysisContext, progressCallback?: ProgressCallback): Promise<AnalysisResult> {
        try {
            this.updateProgress(progressCallback, 10, 'Preprocessing trajectory data...');

            const { data, fieldMapping, options } = context;

            // Apply standard preprocessing pipeline
            this.updateProgress(progressCallback, 30, 'Applying standard preprocessing...');

            // Detec the boundary and sort the data by time. A new column will be added to the data representing the time order.
            const preprocessedData = preprocessGeojsonData(data);

            // Validate preprocessing results
            const validation = this._validatePreprocessedData(preprocessedData);
            if (!validation.valid) {
                return this.createErrorResult(`Preprocessing failed: ${validation.errors.join(', ')}`);
            }

            this.updateProgress(progressCallback, 60, 'Analyzing movement patterns...');

            // Process features for analysis-specific enhancements
            const enhancedFeatures = this._enhanceFeatures(preprocessedData, fieldMapping, options);

            this.updateProgress(progressCallback, 80, 'Creating visualization datasets...');

            // Create datasets with full templates
            const datasets = await this._createVisualizationDatasets(
                preprocessedData,
                enhancedFeatures,
                fieldMapping,
                options
            );

            this.updateProgress(progressCallback, 100, 'Analysis complete');

            return this.createMultiDatasetResult(datasets, {
                totalFeatures: preprocessedData.features.length,
                timeRange: this._extractTimeRange(enhancedFeatures),
                stayPointsDetected: options.visualizeStay ?
                    enhancedFeatures.filter(f => f.properties._is_stay_point).length : 0
            });

        } catch (error) {
            console.error('Time Geography analysis error:', error);
            return this.createErrorResult(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private _enhanceFeatures(
        preprocessedData: FeatureCollection,
        fieldMapping: any,
        options: Record<string, any>
    ): any[] {
        return preprocessedData.features.map((feature, index) => {
            const [lng, lat] = feature.geometry.coordinates;
            const time = this.getMappedValue(feature, fieldMapping, 'time');

            const enhancedFeature = {
                ...feature,
                properties: {
                    ...feature.properties,
                    _analysis_sequence: index,
                    _analysis_timestamp: new Date(time).toISOString(),
                    _analysis_lat: lat,
                    _analysis_lng: lng,
                    _is_stay_point: false
                }
            };

            // Add stay point analysis if enabled
            if (options.visualizeStay) {
                enhancedFeature.properties._is_stay_point = this._detectStayPoint(
                    preprocessedData.features, index, fieldMapping, options.timeWindow || 24
                );
            }

            return enhancedFeature;
        });
    }

    private async _createVisualizationDatasets(
        preprocessedData: FeatureCollection,
        enhancedFeatures: any[],
        fieldMapping: any,
        options: Record<string, any>
    ): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];

        // 1. Main trajectory dataset with direct Kepler.gl configuration
        const trajectoryConfig = this._createTrajectoryLayerConfig(fieldMapping);
        datasets.push(this.createDataset(
            'time-geography-trajectory',
            'Space-Time Trajectory',
            preprocessedData,
            {
                description: 'Main trajectory visualization with 3D time elevation',
                visualizationConfig: {
                    config: {
                        visState: {
                            layers: [trajectoryConfig]
                        }
                    }
                }
            }
        ));

        // 2. Stay points dataset if enabled
        if (options.visualizeStay) {
            const stayPoints = enhancedFeatures.filter(f => f.properties._is_stay_point);
            if (stayPoints.length > 0) {
                const stayPointsData = this._createStayPointsData(stayPoints);
                const stayPointsConfig = this._createStayPointsLayerConfig();

                datasets.push(this.createDataset(
                    'stay-points',
                    'Stay Points',
                    stayPointsData,
                    {
                        description: 'Detected stay points from trajectory analysis',
                        visualizationConfig: {
                            config: {
                                visState: {
                                    layers: [stayPointsConfig]
                                }
                            }
                        }
                    }
                ));
            }
        }

        // 3. STKDE datasets if enabled
        if (options.visualizeSTKDE) {
            try {
                const stkdeData = await this._createSTKDEData(preprocessedData, fieldMapping);
                if (stkdeData && stkdeData.length > 0) {
                    stkdeData.forEach((data, index) => {
                        const confidence = index === 0 ? 90 : index === 1 ? 95 : 99;
                        const datasetId = `stkde-density-${index + 1}`;
                        const stkdeConfig = this._createSTKDELayerConfig(datasetId, confidence);

                        datasets.push(this.createDataset(
                            datasetId,
                            `STKDE ${confidence}%`,
                            data,
                            {
                                description: `Space-time kernel density estimation ${confidence}% confidence`,
                                visualizationConfig: {
                                    config: {
                                        visState: {
                                            layers: [stkdeConfig]
                                        }
                                    }
                                }
                            }
                        ));
                    });
                }
            } catch (error) {
                console.error('STKDE processing error:', error);
            }
        }

        // 4. Coordinate axes dataset if enabled
        if (options.visualizeAxis) {
            const axesData = this._create3DAxesData(enhancedFeatures);
            if (axesData) {
                const axesConfig = this._createAxesLayerConfig();

                datasets.push(this.createDataset(
                    'coordinate-axes',
                    '3D Coordinate Axes',
                    axesData,
                    {
                        description: '3D coordinate axes for time dimension visualization',
                        visualizationConfig: {
                            config: {
                                visState: {
                                    layers: [axesConfig]
                                }
                            }
                        }
                    }
                ));
            }
        }

        return datasets;
    }

    // Fixed trajectory layer configuration to match working format
    private _createTrajectoryLayerConfig(fieldMapping: any) {
        const timestamp = Date.now();
        const heightScale = selectHeightScale(store.getState());
        return {
            id: `time-geography-trajectory-layer-${timestamp}`,
            type: 'line',
            config: {
                dataId: 'time-geography-trajectory',
                label: 'Custom Line',
                columnMode: 'neighbors',  // This is crucial!
                color: COLORS.LINE,
                columns: {
                    lat: fieldMapping.latitude || 'latitude',
                    lng: fieldMapping.longitude || 'longitude',
                    neighbors: PROCESSED_NEIGHBORS_FIELD,  // This is required for line layers
                    alt: PROCESSED_TIME_FIELD  // Use time field for elevation
                },
                isVisible: true,
                visConfig: {
                    opacity: 0.8,
                    strokeOpacity: 0.8,
                    thickness: 3.2,
                    radius: 10,
                    sizeRange: [0, 10],
                    radiusRange: [0, 50],
                    elevationScale: heightScale,
                    stroked: true,
                    filled: true,
                    enable3d: true,
                    wireframe: false,
                    fixedHeight: false
                }
            }
        };
    }

    private _createStayPointsLayerConfig() {
        const timestamp = Date.now();
        return {
            id: `stay-points-layer-${timestamp}`,
            type: 'point',
            config: {
                dataId: 'stay-points',
                label: 'Stay Points',
                color: COLORS.ACTIVITY_SPACE,
                columns: {
                    lat: 'latitude',
                    lng: 'longitude'
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
        };
    }

    private _createSTKDELayerConfig(dataId: string, confidence: number) {
        const color = confidence === 99 ? COLORS.STKDE_99 :
            confidence === 95 ? COLORS.STKDE_95 : COLORS.STKDE_90;
        const opacity = confidence === 99 ? 0.3 :
            confidence === 95 ? 0.8 : 0.6;

        // Create layer config that matches the working format exactly
        return {
            type: "geojson",
            config: {
                dataId: dataId,
                columnMode: "geojson",
                label: `STKDE ${confidence}%`,
                columns: { geojson: "_geojson" },
                isVisible: true,
                color: color,
                visConfig: {
                    opacity: opacity,
                    strokeOpacity: 0.8,
                    thickness: 0.5,
                    radius: 10,
                    sizeRange: [0, 10],
                    radiusRange: [0, 50],
                    heightRange: [0, 500],
                    elevationScale: 1,
                    stroked: true,
                    filled: true,
                    enable3d: true,
                    wireframe: false,
                    fixedHeight: true
                },
                hidden: false,
                heightField: { name: PROCESSED_HEIGHT_FIELD, type: "float" }
            },
            visualChannels: {
                heightScale: "linear",
                colorField: null,
                colorScale: "quantile",
                strokeColorField: null,
                strokeColorScale: "quantile",
                sizeField: null,
                sizeScale: "linear"
            }
        };
    }

    private _createAxesLayerConfig() {
        return {
            type: 'geojson',
            config: {
                dataId: 'coordinate-axes',
                columnMode: 'geojson',
                label: '3D Coordinate Axes',
                columns: { geojson: '_geojson' },
                isVisible: true,
                color: COLORS.DEFAULT,
                visConfig: {
                    opacity: 0.8,
                    strokeOpacity: 1.0,
                    thickness: 3,
                    radius: 10,
                    sizeRange: [0, 10],
                    radiusRange: [0, 50],
                    heightRange: [0, 500],
                    elevationScale: 5,
                    stroked: true,
                    filled: false,
                    enable3d: true,
                    wireframe: false,
                    fixedHeight: true
                },
                hidden: false,
                heightField: { name: PROCESSED_HEIGHT_FIELD, type: 'real' }
            },
            visualChannels: {
                heightScale: 'linear',
                colorField: { name: 'axis_type', type: 'string' },
                colorScale: 'ordinal',
                strokeColorField: null,
                strokeColorScale: 'quantile',
                sizeField: null,
                sizeScale: 'linear'
            }
        };
    }

    private async _createSTKDEData(
        preprocessedData: FeatureCollection,
        fieldMapping: any
    ): Promise<FeatureCollection[]> {
        try {
            // Use the STKDE module to create density data
            const timeField = fieldMapping.time || 'timestamp';
            const stkdeResults = await createSTKDE(
                preprocessedData,
                timeField,
                undefined, // spatial_bandwidth (auto-estimate)
                undefined, // temporal_bandwidth (auto-estimate)
                undefined, // cell_size (auto-estimate)
                25 // n_time_slices
            );

            return stkdeResults as FeatureCollection[];
        } catch (error) {
            console.error('Error creating STKDE data:', error);
            return [];
        }
    }

    private _detectStayPoint(
        features: any[],
        currentIndex: number,
        fieldMapping: any,
        timeWindowHours: number
    ): boolean {
        const currentFeature = features[currentIndex];
        const currentLat = this.getMappedValue(currentFeature, fieldMapping, 'latitude');
        const currentLng = this.getMappedValue(currentFeature, fieldMapping, 'longitude');
        const currentTime = new Date(this.getMappedValue(currentFeature, fieldMapping, 'time')).getTime();

        const distanceThreshold = 100; // meters
        const timeThreshold = timeWindowHours * 60 * 60 * 1000;
        let nearbyCount = 0;

        for (let i = Math.max(0, currentIndex - 10); i < Math.min(features.length, currentIndex + 10); i++) {
            if (i === currentIndex) continue;

            const otherFeature = features[i];
            const otherLat = this.getMappedValue(otherFeature, fieldMapping, 'latitude');
            const otherLng = this.getMappedValue(otherFeature, fieldMapping, 'longitude');
            const otherTime = new Date(this.getMappedValue(otherFeature, fieldMapping, 'time')).getTime();

            if (Math.abs(currentTime - otherTime) > timeThreshold) continue;

            const distance = this._calculateDistance(currentLat, currentLng, otherLat, otherLng);
            if (distance < distanceThreshold) {
                nearbyCount++;
            }
        }

        return nearbyCount >= 3;
    }

    private _calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lng2 - lng1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    private _createStayPointsData(stayPoints: any[]): FeatureCollection {
        return {
            type: 'FeatureCollection',
            features: stayPoints.map((feature, index) => ({
                ...feature,
                properties: {
                    ...feature.properties,
                    _stay_duration: Math.random() * 3600 + 300, // Mock duration (5min-1hr)
                    _stay_id: index,
                    _stay_cluster: Math.floor(index / 3) // Simple clustering
                }
            }))
        };
    }

    private _create3DAxesData(features: any[]): FeatureCollection | null {
        if (features.length === 0) return null;

        const bounds = this._calculateBounds(features);
        const sideLength = selectSideLength(store.getState());
        const axesFeatures: any[] = [];

        // X-axis (longitude)
        axesFeatures.push({
            type: 'Feature' as const,
            geometry: {
                type: 'LineString' as const,
                coordinates: [
                    [bounds.minLng, bounds.minLat, 0],
                    [bounds.maxLng, bounds.minLat, 0]
                ]
            },
            properties: {
                _geojson: JSON.stringify({
                    type: 'LineString',
                    coordinates: [
                        [bounds.minLng, bounds.minLat, 0],
                        [bounds.maxLng, bounds.minLat, 0]
                    ]
                }),
                axis_type: 'x_axis',
                [PROCESSED_HEIGHT_FIELD]: sideLength
            }
        });

        // Y-axis (latitude)
        axesFeatures.push({
            type: 'Feature' as const,
            geometry: {
                type: 'LineString' as const,
                coordinates: [
                    [bounds.minLng, bounds.minLat, 0],
                    [bounds.minLng, bounds.maxLat, 0]
                ]
            },
            properties: {
                _geojson: JSON.stringify({
                    type: 'LineString',
                    coordinates: [
                        [bounds.minLng, bounds.minLat, 0],
                        [bounds.minLng, bounds.maxLat, 0]
                    ]
                }),
                axis_type: 'y_axis',
                [PROCESSED_HEIGHT_FIELD]: sideLength
            }
        });

        // Z-axis (time)
        axesFeatures.push({
            type: 'Feature' as const,
            geometry: {
                type: 'LineString' as const,
                coordinates: [
                    [bounds.minLng, bounds.minLat, 0],
                    [bounds.minLng, bounds.minLat, sideLength]
                ]
            },
            properties: {
                _geojson: JSON.stringify({
                    type: 'LineString',
                    coordinates: [
                        [bounds.minLng, bounds.minLat, 0],
                        [bounds.minLng, bounds.minLat, sideLength]
                    ]
                }),
                axis_type: 'z_axis',
                [PROCESSED_HEIGHT_FIELD]: sideLength
            }
        });

        // Add small square polygon at the top of z-axis
        axesFeatures.push({
            type: 'Feature' as const,
            geometry: {
                type: 'Polygon' as const,
                coordinates: [[
                    [bounds.minLng - 0.00001, bounds.minLat - 0.00001, 0],
                    [bounds.minLng + 0.00001, bounds.minLat - 0.00001, 0],
                    [bounds.minLng + 0.00001, bounds.minLat + 0.00001, 0],
                    [bounds.minLng - 0.00001, bounds.minLat + 0.00001, 0],
                    [bounds.minLng - 0.00001, bounds.minLat - 0.00001, 0]
                ]]
            },
            properties: {
                _geojson: JSON.stringify({
                    type: 'Polygon',
                    coordinates: [[
                        [bounds.minLng - 0.00001, bounds.minLat - 0.00001, 0],
                        [bounds.minLng + 0.00001, bounds.minLat - 0.00001, 0],
                        [bounds.minLng + 0.00001, bounds.minLat + 0.00001, 0],
                        [bounds.minLng - 0.00001, bounds.minLat + 0.00001, 0],
                        [bounds.minLng - 0.00001, bounds.minLat - 0.00001, 0]
                    ]]
                }),
                axis_type: 'z_indicator',
                // The height should be the same as the side length
                [PROCESSED_HEIGHT_FIELD]: sideLength
            }
        });

        // const axesLabels = [];
        // Add labels for each axis
        axesFeatures.push({
            type: 'Feature' as const,
            geometry: {
                type: 'Point' as const,
                coordinates: [
                    bounds.maxLng + 0.001,
                    bounds.minLat,
                    0
                ]
            },
            properties: {
                _geojson: JSON.stringify({
                    type: 'Point',
                    coordinates: [
                        bounds.maxLng + 0.001,
                        bounds.minLat,
                        0
                    ]
                }),
                axis_type: 'x_label',
                Label: 'Longitude'
            }
        });

        axesFeatures.push({
            type: 'Feature' as const,
            geometry: {
                type: 'Point' as const,
                coordinates: [
                    bounds.minLng,
                    bounds.maxLat + 0.001,
                    0
                ]
            },
            properties: {
                _geojson: JSON.stringify({
                    type: 'Point',
                    coordinates: [
                        bounds.minLng,
                        bounds.maxLat + 0.001,
                        0
                    ]
                }),
                axis_type: 'y_label',
                Label: 'Latitude'
            }
        });

        axesFeatures.push({
            type: 'Feature' as const,
            geometry: {
                type: 'Point' as const,
                coordinates: [
                    bounds.minLng - 0.001,
                    bounds.minLat - 0.001,
                    sideLength / 2
                ]
            },
            properties: {
                _geojson: JSON.stringify({
                    type: 'Point',
                    coordinates: [
                        bounds.minLng - 0.001,
                        bounds.minLat - 0.001,
                        sideLength / 2
                    ]
                }),
                axis_type: 'z_label',
                Label: 'Time'
            }
        });
        return {
            type: 'FeatureCollection',
            features: axesFeatures
        };
    }

    private _calculateBounds(features: any[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
        const lats = features.map(f => f.properties._analysis_lat);
        const lngs = features.map(f => f.properties._analysis_lng);

        return {
            minLat: Math.min(...lats),
            maxLat: Math.max(...lats),
            minLng: Math.min(...lngs),
            maxLng: Math.max(...lngs)
        };
    }

    private _extractTimeRange(features: any[]): { start: string; end: string } {
        if (features.length === 0) {
            return { start: '', end: '' };
        }

        return {
            start: features[0]?.properties?._analysis_timestamp || '',
            end: features[features.length - 1]?.properties?._analysis_timestamp || ''
        };
    }

    private _validatePreprocessedData(data: FeatureCollection): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (data.features.length === 0) {
            errors.push('No features found in preprocessed data');
            return { valid: false, errors };
        }

        const firstFeature = data.features[0];
        if (!firstFeature.properties) {
            errors.push('Features missing properties after preprocessing');
        } else {
            if (!(PROCESSED_TIME_FIELD in firstFeature.properties)) {
                errors.push(`Missing ${PROCESSED_TIME_FIELD} field after preprocessing`);
            }
            if (!(PROCESSED_NEIGHBORS_FIELD in firstFeature.properties)) {
                errors.push(`Missing ${PROCESSED_NEIGHBORS_FIELD} field after preprocessing`);
            }
        }

        if (firstFeature.geometry?.coordinates && firstFeature.geometry.coordinates.length < 3) {
            errors.push('Coordinates missing altitude dimension after preprocessing');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    getDocumentation(): string {
        return `
# Time Geography Analysis Tool

Analyzes movement patterns and creates space-time paths from trajectory data with comprehensive visualization options.

## Required Fields
- **Latitude**: Geographic latitude coordinates
- **Longitude**: Geographic longitude coordinates  
- **Time**: Timestamp for each location point

## Options
- **Visualize Stay Points**: Identifies locations where the subject remained for extended periods
- **Visualize Space-Time KDE**: Generates kernel density estimation in space and time using STKDE module
- **Show 3D Axis**: Displays 3D coordinate axes for time dimension
- **Time Window**: Time window for analysis in hours (1-168)

## Output Datasets
1. **Space-Time Trajectory**: Main 3D trajectory with time elevation
2. **Stay Points**: Detected stationary locations (if enabled)
3. **STKDE Density**: Space-time kernel density estimation classes (if enabled)
4. **3D Coordinate Axes**: Reference axes for time dimension (if enabled)

Each dataset includes a complete visualization template optimized for its data type.
        `.trim();
    }

    getExampleData(): FeatureCollection {
        return {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [-122.4194, 37.7749]
                    },
                    properties: {
                        timestamp: '2023-01-01T08:00:00Z',
                        user_id: 'user123'
                    }
                },
                {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [-122.4094, 37.7849]
                    },
                    properties: {
                        timestamp: '2023-01-01T08:30:00Z',
                        user_id: 'user123'
                    }
                }
            ]
        };
    }
} 