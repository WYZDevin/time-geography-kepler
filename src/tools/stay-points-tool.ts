import { AbstractBaseTool } from './base-tool';
import { AnalysisContext, AnalysisResult, DatasetResult, ProgressCallback, ToolOption } from '../interfaces/tool-interfaces';
import { FeatureCollection } from '../interfaces/data-interfaces';
import { preprocessGeojsonData } from '../data-processors/data-preprocessing';
import * as turf from '@turf/turf';

export class StayPointsTool extends AbstractBaseTool {
    readonly id = 'stay-points';
    readonly name = 'Stay Points Detection';
    readonly description = 'Detect and visualize stay points in trajectory data';
    readonly icon = '⏸️';
    readonly category = 'analysis' as const;
    readonly version = '1.0.0';
    readonly author = 'GISPark Team';

    readonly requiredFields = ['latitude', 'longitude', 'time'];
    readonly optionalFields = ['altitude', 'accuracy'];

    readonly options: ToolOption[] = [
        {
            key: 'spatialThreshold',
            label: 'Spatial Threshold (meters)',
            type: 'number',
            defaultValue: 50,
            min: 10,
            max: 500,
            step: 10,
            description: 'Maximum distance between points to be considered as same location'
        },
        {
            key: 'timeThreshold',
            label: 'Time Threshold (minutes)',
            type: 'number',
            defaultValue: 30,
            min: 5,
            max: 180,
            step: 5,
            description: 'Minimum time spent at location to be considered a stay point'
        },
        {
            key: 'minStayDuration',
            label: 'Minimum Stay Duration (minutes)',
            type: 'number',
            defaultValue: 10,
            min: 1,
            max: 120,
            step: 1,
            description: 'Minimum duration for a valid stay point'
        },
        {
            key: 'createActivitySpaces',
            label: 'Create Activity Spaces',
            type: 'boolean',
            defaultValue: false,
            description: 'Generate convex hull activity spaces around stay points'
        },
        {
            key: 'visualizeConnections',
            label: 'Show Connections',
            type: 'boolean',
            defaultValue: true,
            description: 'Show movement paths between stay points'
        }
    ];

    async analyze(context: AnalysisContext, progressCallback?: ProgressCallback): Promise<AnalysisResult> {
        try {
            this.updateProgress(progressCallback, 10, 'Preprocessing trajectory data...');

            const { data, fieldMapping, options } = context;

            // Apply standard preprocessing pipeline
            this.updateProgress(progressCallback, 30, 'Detecting stay points...');
            const preprocessedData = preprocessGeojsonData(data);

            // Validate preprocessing results
            const validation = this._validatePreprocessedData(preprocessedData);
            if (!validation.valid) {
                return this.createErrorResult(`Preprocessing failed: ${validation.errors.join(', ')}`);
            }

            this.updateProgress(progressCallback, 60, 'Analyzing stay patterns...');

            // Detect stay points
            const stayPointsResult = this._detectStayPoints(preprocessedData, fieldMapping, options);

            if (stayPointsResult.stayPoints.length === 0) {
                return this.createErrorResult('No stay points detected with current parameters');
            }

            this.updateProgress(progressCallback, 80, 'Creating visualization datasets...');

            // Create datasets
            const datasets = await this._createVisualizationDatasets(
                preprocessedData,
                stayPointsResult,
                fieldMapping,
                options
            );

            this.updateProgress(progressCallback, 100, 'Stay points analysis complete');

            return this.createMultiDatasetResult(datasets, {
                totalStayPoints: stayPointsResult.stayPoints.length,
                totalMovementTime: stayPointsResult.totalMovementTime,
                totalStayTime: stayPointsResult.totalStayTime,
                averageStayDuration: stayPointsResult.averageStayDuration
            });

        } catch (error) {
            console.error('Stay Points analysis error:', error);
            return this.createErrorResult(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private _detectStayPoints(
        preprocessedData: FeatureCollection,
        fieldMapping: any,
        options: Record<string, any>
    ): {
        stayPoints: any[];
        connections: any[];
        totalStayTime: number;
        totalMovementTime: number;
        averageStayDuration: number;
    } {
        const features = preprocessedData.features;
        const spatialThreshold = options.spatialThreshold || 50; // meters
        const timeThreshold = options.timeThreshold || 30; // minutes
        const minStayDuration = options.minStayDuration || 10; // minutes

        const stayPoints: any[] = [];
        const connections: any[] = [];
        let totalStayTime = 0;
        let totalMovementTime = 0;

        // Sort features by time
        const sortedFeatures = [...features].sort((a, b) => {
            const timeA = new Date(this.getMappedValue(a, fieldMapping, 'time')).getTime();
            const timeB = new Date(this.getMappedValue(b, fieldMapping, 'time')).getTime();
            return timeA - timeB;
        });

        let currentCluster: any[] = [];
        let clusterStartTime: number | null = null;

        for (let i = 0; i < sortedFeatures.length; i++) {
            const currentFeature = sortedFeatures[i];
            const currentCoords = currentFeature.geometry.coordinates;
            const currentTime = new Date(this.getMappedValue(currentFeature, fieldMapping, 'time')).getTime();

            if (currentCluster.length === 0) {
                // Start new cluster
                currentCluster = [currentFeature];
                clusterStartTime = currentTime;
            } else {
                // Check if current point belongs to existing cluster
                const clusterCenter = this._calculateClusterCenter(currentCluster);
                const distance = turf.distance(
                    turf.point(currentCoords),
                    turf.point(clusterCenter),
                    { units: 'meters' }
                );

                if (distance <= spatialThreshold) {
                    // Add to current cluster
                    currentCluster.push(currentFeature);
                } else {
                    // Process current cluster and start new one
                    const clusterDuration = (currentTime - (clusterStartTime || currentTime)) / (1000 * 60); // minutes
                    
                    if (clusterDuration >= minStayDuration) {
                        const stayPoint = this._createStayPoint(currentCluster, clusterDuration, stayPoints.length);
                        stayPoints.push(stayPoint);
                        totalStayTime += clusterDuration;
                    }

                    // Start new cluster
                    currentCluster = [currentFeature];
                    clusterStartTime = currentTime;
                }
            }

            // Add movement time between clusters
            if (i > 0 && stayPoints.length > 0) {
                const prevFeature = sortedFeatures[i - 1];
                const prevTime = new Date(this.getMappedValue(prevFeature, fieldMapping, 'time')).getTime();
                const movementTime = (currentTime - prevTime) / (1000 * 60);
                totalMovementTime += movementTime;
            }
        }

        // Process final cluster
        if (currentCluster.length > 0 && clusterStartTime) {
            const finalTime = new Date(this.getMappedValue(currentCluster[currentCluster.length - 1], fieldMapping, 'time')).getTime();
            const clusterDuration = (finalTime - clusterStartTime) / (1000 * 60);
            
            if (clusterDuration >= minStayDuration) {
                const stayPoint = this._createStayPoint(currentCluster, clusterDuration, stayPoints.length);
                stayPoints.push(stayPoint);
                totalStayTime += clusterDuration;
            }
        }

        // Create connections between stay points
        for (let i = 0; i < stayPoints.length - 1; i++) {
            const from = stayPoints[i];
            const to = stayPoints[i + 1];
            
            connections.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        from.geometry.coordinates,
                        to.geometry.coordinates
                    ]
                },
                properties: {
                    connection_id: i,
                    from_stay_id: from.properties.stay_id,
                    to_stay_id: to.properties.stay_id,
                    duration_between: this._calculateTimeBetween(from, to),
                    distance: turf.distance(
                        turf.point(from.geometry.coordinates),
                        turf.point(to.geometry.coordinates),
                        { units: 'meters' }
                    )
                }
            });
        }

        const averageStayDuration = stayPoints.length > 0 ? totalStayTime / stayPoints.length : 0;

        return {
            stayPoints,
            connections,
            totalStayTime,
            totalMovementTime,
            averageStayDuration
        };
    }

    private _calculateClusterCenter(cluster: any[]): [number, number] {
        const sumLng = cluster.reduce((sum, f) => sum + f.geometry.coordinates[0], 0);
        const sumLat = cluster.reduce((sum, f) => sum + f.geometry.coordinates[1], 0);
        return [sumLng / cluster.length, sumLat / cluster.length];
    }

    private _createStayPoint(cluster: any[], duration: number, id: number) {
        const center = this._calculateClusterCenter(cluster);
        const startTime = cluster[0].properties.time || cluster[0].properties.timestamp;
        const endTime = cluster[cluster.length - 1].properties.time || cluster[cluster.length - 1].properties.timestamp;

        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: center
            },
            properties: {
                stay_id: id,
                stay_duration_minutes: duration,
                stay_start_time: startTime,
                stay_end_time: endTime,
                cluster_size: cluster.length,
                stay_type: this._classifyStayPoint(duration),
                activity_level: this._calculateActivityLevel(cluster)
            }
        };
    }

    private _classifyStayPoint(duration: number): string {
        if (duration < 30) return 'brief_stop';
        if (duration < 120) return 'short_stay';
        if (duration < 480) return 'medium_stay';
        return 'long_stay';
    }

    private _calculateActivityLevel(cluster: any[]): string {
        // Simple heuristic based on cluster density
        if (cluster.length < 3) return 'low';
        if (cluster.length < 10) return 'medium';
        return 'high';
    }

    private _calculateTimeBetween(from: any, to: any): number {
        const fromTime = new Date(from.properties.stay_end_time).getTime();
        const toTime = new Date(to.properties.stay_start_time).getTime();
        return (toTime - fromTime) / (1000 * 60); // minutes
    }

    private async _createVisualizationDatasets(
        originalData: FeatureCollection,
        stayPointsResult: any,
        fieldMapping: any,
        options: Record<string, any>
    ): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];

        // 1. Stay points dataset
        const stayPointsData: FeatureCollection = {
            type: 'FeatureCollection',
            features: stayPointsResult.stayPoints
        };

        const stayPointsConfig = this._createStayPointsLayerConfig();
        datasets.push(this.createDataset(
            'detected-stay-points',
            'Detected Stay Points',
            stayPointsData,
            {
                description: 'Stay points detected from trajectory analysis',
                visualizationConfig: {
                    config: {
                        visState: {
                            layers: [stayPointsConfig]
                        }
                    }
                }
            }
        ));

        // 2. Connections dataset if enabled
        if (options.visualizeConnections && stayPointsResult.connections.length > 0) {
            const connectionsData: FeatureCollection = {
                type: 'FeatureCollection',
                features: stayPointsResult.connections
            };

            const connectionsConfig = this._createConnectionsLayerConfig();
            datasets.push(this.createDataset(
                'stay-point-connections',
                'Stay Point Connections',
                connectionsData,
                {
                    description: 'Movement paths between stay points',
                    visualizationConfig: {
                        config: {
                            visState: {
                                layers: [connectionsConfig]
                            }
                        }
                    }
                }
            ));
        }

        // 3. Activity spaces if enabled
        if (options.createActivitySpaces) {
            const activitySpaces = this._createActivitySpaces(stayPointsResult.stayPoints);
            if (activitySpaces.length > 0) {
                const activitySpacesData: FeatureCollection = {
                    type: 'FeatureCollection',
                    features: activitySpaces
                };

                const activitySpacesConfig = this._createActivitySpacesLayerConfig();
                datasets.push(this.createDataset(
                    'activity-spaces',
                    'Activity Spaces',
                    activitySpacesData,
                    {
                        description: 'Convex hull activity spaces around stay points',
                        visualizationConfig: {
                            config: {
                                visState: {
                                    layers: [activitySpacesConfig]
                                }
                            }
                        }
                    }
                ));
            }
        }

        return datasets;
    }

    private _createStayPointsLayerConfig() {
        return {
            id: 'stay-points-layer',
            type: 'point',
            config: {
                dataId: 'detected-stay-points',
                label: 'Stay Points',
                color: [255, 178, 102],
                isVisible: true,
                visConfig: {
                    opacity: 0.8,
                    radius: 20,
                    colorRange: {
                        name: 'ColorBrewer Set3-12',
                        type: 'qualitative',
                        category: 'ColorBrewer',
                        colors: ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462']
                    },
                    radiusRange: [10, 50],
                    strokeColor: [255, 255, 255],
                    strokeColorRange: {
                        name: 'Global Warming',
                        type: 'sequential',
                        category: 'Uber',
                        colors: ['#5A1846', '#900C3F', '#C70039', '#E3611C', '#F1920E', '#FFC300']
                    },
                    colorField: {
                        name: 'stay_type',
                        type: 'string'
                    },
                    radiusField: {
                        name: 'stay_duration_minutes',
                        type: 'real'
                    }
                }
            }
        };
    }

    private _createConnectionsLayerConfig() {
        return {
            id: 'connections-layer',
            type: 'line',
            config: {
                dataId: 'stay-point-connections',
                label: 'Movement Paths',
                color: [128, 128, 128],
                isVisible: true,
                visConfig: {
                    opacity: 0.6,
                    thickness: 2,
                    colorRange: {
                        name: 'Uber Pool',
                        type: 'sequential',
                        category: 'Uber',
                        colors: ['#213E9F', '#2D5BA8', '#3F7BB2', '#52A0BD', '#66C5C8', '#7BEBD3']
                    },
                    strokeColorField: {
                        name: 'distance',
                        type: 'real'
                    }
                }
            }
        };
    }

    private _createActivitySpaces(stayPoints: any[]) {
        const activitySpaces = [];

        for (const stayPoint of stayPoints) {
            // Create a simple buffer around each stay point as activity space
            const buffer = turf.buffer(stayPoint, 0.1, { units: 'kilometers' });
            
            activitySpaces.push({
                ...buffer,
                properties: {
                    ...buffer.properties,
                    stay_id: stayPoint.properties.stay_id,
                    activity_space_type: 'buffer',
                    radius_km: 0.1
                }
            });
        }

        return activitySpaces;
    }

    private _createActivitySpacesLayerConfig() {
        return {
            id: 'activity-spaces-layer',
            type: 'geojson',
            config: {
                dataId: 'activity-spaces',
                label: 'Activity Spaces',
                color: [255, 204, 102],
                isVisible: true,
                visConfig: {
                    opacity: 0.3,
                    strokeOpacity: 0.8,
                    thickness: 2,
                    strokeColor: [255, 178, 102],
                    filled: true
                }
            }
        };
    }

    private _validatePreprocessedData(data: FeatureCollection): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!data.features || data.features.length === 0) {
            errors.push('No features found in dataset');
        }
        
        if (data.features.length < 3) {
            errors.push('At least 3 points required for stay point detection');
        }
        
        return { valid: errors.length === 0, errors };
    }
}