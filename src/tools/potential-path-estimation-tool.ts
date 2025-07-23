import { AbstractBaseTool } from './base-tool';
import { AnalysisContext, AnalysisResult, DatasetResult, ProgressCallback, ToolOption } from '../interfaces/tool-interfaces';
import { FeatureCollection } from '../interfaces/data-interfaces';
import { preprocessGeojsonData } from '../data-processors/data-preprocessing';
import { StayPointsTool } from './stay-points-tool';
import { TimeGeographyTool } from './time-geography-tool';
import { PROCESSED_HEIGHT_FIELD } from '../utils/constants';
import { selectHeightScale } from '../stores/metadata-slice';
import store, { RootState } from '../stores/store';
import * as turf from '@turf/turf';

export class PotentialPathEstimationTool extends AbstractBaseTool {
    readonly id = 'potential-path-estimation';
    readonly name = 'Potential Path Estimation (PPE)';
    readonly description = 'Estimate potential movement paths between major stay points using 3D polygon visualization';
    readonly icon = '🛤️';
    readonly category = 'analysis' as const;
    readonly version = '1.0.0';
    readonly author = 'GISPark Team';

    readonly requiredFields = ['latitude', 'longitude', 'time'];
    readonly optionalFields = ['altitude', 'accuracy'];

    private stayPointsTool: StayPointsTool;
    private timeGeographyTool: TimeGeographyTool;

    constructor() {
        super();
        this.stayPointsTool = new StayPointsTool();
        this.timeGeographyTool = new TimeGeographyTool();
    }

    /**
     * Get height scale from Redux store using typed selector
     */
    private _getHeightScale(): number {
        const state: RootState = store.getState();
        return selectHeightScale(state);
    }

    readonly options: ToolOption[] = [
        {
            key: 'spatialThreshold',
            label: 'Stay Point Spatial Threshold (meters)',
            type: 'number',
            defaultValue: 100,
            min: 20,
            max: 500,
            step: 10,
            description: 'Maximum distance between points to be considered as same stay location'
        },
        {
            key: 'timeThreshold',
            label: 'Stay Point Time Threshold (minutes)',
            type: 'number',
            defaultValue: 60,
            min: 10,
            max: 300,
            step: 10,
            description: 'Minimum time spent at location to be considered a major stay point'
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
            key: 'minMovingPoints',
            label: 'Minimum Moving Points',
            type: 'number',
            defaultValue: 3,
            min: 2,
            max: 20,
            step: 1,
            description: 'Minimum number of points required between stay points for path estimation'
        },
        {
            key: 'pathHeightScale',
            label: 'Path Height Scale',
            type: 'number',
            defaultValue: 500,
            min: 100,
            max: 2000,
            step: 100,
            description: 'Scale factor for 3D polygon height visualization'
        },
        {
            key: 'pathOpacity',
            label: 'Path Polygon Opacity',
            type: 'number',
            defaultValue: 0.6,
            min: 0.1,
            max: 1.0,
            step: 0.1,
            description: 'Opacity of potential path polygons'
        },
        {
            key: 'includeTimeVariation',
            label: 'Include Time-Based Height Variation',
            type: 'boolean',
            defaultValue: true,
            description: 'Vary polygon height based on time spent in movement'
        }
    ];

    async analyze(context: AnalysisContext, progressCallback?: ProgressCallback): Promise<AnalysisResult> {
        try {
            this.updateProgress(progressCallback, 2, 'Preprocessing data to set base state...');

            const { data, fieldMapping, options } = context;

            // Always call preprocessing to set the base state (side length, heightScale)
            const basePreprocessedData = preprocessGeojsonData(data);
            console.log('PPE Tool: Base data preprocessing complete');

            this.updateProgress(progressCallback, 5, 'Running Time Geography analysis for 3D trajectory...');

            // First run Time Geography tool to get 3D trajectory with altitude processing
            const timeGeographyContext = {
                data: basePreprocessedData,
                fieldMapping,
                options: {
                    visualizeStay: false,     // We'll do our own stay point detection
                    visualizeSTKDE: false,    // Not needed for PPE
                    visualizeAxis: false,     // Not needed for PPE
                    timeWindow: 24
                },
                toolId: this.timeGeographyTool.id
            };

            const timeGeographyResult = await this.timeGeographyTool.analyze(timeGeographyContext);
            
            if (!timeGeographyResult.success || !timeGeographyResult.datasets) {
                return this.createErrorResult(`Time Geography analysis failed: ${timeGeographyResult.error || 'Unknown error'}`);
            }

            // Extract the 3D trajectory dataset
            const trajectoryDataset = timeGeographyResult.datasets.find(ds => ds.id === 'time-geography-trajectory');
            if (!trajectoryDataset) {
                return this.createErrorResult('3D trajectory dataset not found in Time Geography result');
            }

            const preprocessedData = trajectoryDataset.data;
            console.log('PPE Tool: Using 3D trajectory data with', preprocessedData.features.length, 'features');

            this.updateProgress(progressCallback, 15, 'Validating 3D trajectory data...');

            // Validate preprocessing results
            const validation = this._validatePreprocessedData(preprocessedData);
            if (!validation.valid) {
                return this.createErrorResult(`3D trajectory validation failed: ${validation.errors.join(', ')}`);
            }

            this.updateProgress(progressCallback, 30, 'Detecting major stay points...');

            // Detect stay point clusters with point indices tracking
            console.log('PPE Tool: Detecting stay point clusters with trajectory point tracking');
            console.log('PPE Tool: Input preprocessed data features:', preprocessedData.features.length);
            
            const clusteringResult = this._detectStayPointClustersWithIndices(
                preprocessedData,
                fieldMapping,
                {
                    spatialThreshold: options.spatialThreshold || 100,
                    timeThreshold: options.timeThreshold || 60,
                    minStayDuration: options.minStayDuration || 10
                }
            );
            
            console.log('PPE Tool: Clustering result:', {
                stayClusters: clusteringResult.stayClusters.length,
                totalPoints: preprocessedData.features.length,
                stayPointIndices: clusteringResult.stayClusters.map(c => `[${c.startIndex}-${c.endIndex}]`).join(', ')
            });
            
            const stayPoints = clusteringResult.stayClusters.map(cluster => cluster.stayPoint);
            console.log(`PPE Tool: Detected ${stayPoints.length} stay point clusters. Total features: ${preprocessedData.features.length}`);
            
            if (stayPoints.length < 2) {
                return this.createErrorResult('At least 2 major stay points are required for path estimation');
            }

            this.updateProgress(progressCallback, 50, 'Extracting movement paths...');

            // Extract movement paths between stay clusters using the clustering result and 3D trajectory data
            const movementPaths = this._extractMovementPathsFromClusters(
                preprocessedData, 
                clusteringResult.stayClusters, 
                fieldMapping, 
                options
            );

            if (movementPaths.length === 0) {
                return this.createErrorResult('No valid movement paths found between stay points');
            }

            this.updateProgress(progressCallback, 70, 'Computing potential path estimations...');

            // Compute potential path estimations for each movement path
            const potentialPaths = this._computePotentialPathEstimations(movementPaths, options);

            this.updateProgress(progressCallback, 90, 'Creating visualization datasets...');

            // Create visualization datasets
            // Note: 3D trajectory will be preserved from original Time Geography tool run
            const datasets = await this._createVisualizationDatasets(
                potentialPaths,
                stayPoints,
                movementPaths,
                options
            );

            this.updateProgress(progressCallback, 100, 'Potential path estimation complete');

            return this.createMultiDatasetResult(datasets, {
                totalStayPoints: stayPoints.length,
                totalMovementPaths: movementPaths.length,
                totalPotentialPaths: potentialPaths.length,
                averagePathWidth: this._calculateAveragePathWidth(potentialPaths),
                averagePathLength: this._calculateAveragePathLength(potentialPaths),
                // Include clustering metadata
                totalTrajectoryPoints: preprocessedData.features.length,
                stayPointClusters: clusteringResult.stayClusters.map(c => ({
                    indices: `${c.startIndex}-${c.endIndex}`,
                    pointCount: c.endIndex - c.startIndex + 1
                }))
            });

        } catch (error) {
            console.error('Potential Path Estimation analysis error:', error);
            return this.createErrorResult(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private _detectStayPointClustersWithIndices(
        preprocessedData: FeatureCollection,
        fieldMapping: any,
        options: Record<string, any>
    ): {
        stayClusters: Array<{
            stayPoint: any;
            startIndex: number;
            endIndex: number;
            points: any[];
        }>;
    } {
        const features = preprocessedData.features;
        const spatialThreshold = options.spatialThreshold || 100; // meters
        const timeThreshold = options.timeThreshold || 60; // minutes
        const minStayDuration = options.minStayDuration || 10; // minutes

        const stayClusters: Array<{
            stayPoint: any;
            startIndex: number;
            endIndex: number;
            points: any[];
        }> = [];

        // Sort features by time and keep track of original indices
        const indexedFeatures = features.map((feature, index) => ({ feature, originalIndex: index }));
        indexedFeatures.sort((a, b) => {
            const timeA = new Date(this.getMappedValue(a.feature, fieldMapping, 'time')).getTime();
            const timeB = new Date(this.getMappedValue(b.feature, fieldMapping, 'time')).getTime();
            return timeA - timeB;
        });

        let currentCluster: typeof indexedFeatures = [];
        let clusterStartTime: number | null = null;

        for (let i = 0; i < indexedFeatures.length; i++) {
            const current = indexedFeatures[i];
            const currentFeature = current.feature;
            const currentCoords = currentFeature.geometry.coordinates;
            const currentTime = new Date(this.getMappedValue(currentFeature, fieldMapping, 'time')).getTime();

            if (currentCluster.length === 0) {
                // Start new cluster
                currentCluster = [current];
                clusterStartTime = currentTime;
            } else {
                // Check if current point belongs to existing cluster
                const clusterCenter = this._calculateClusterCenter(currentCluster.map(c => c.feature));
                const distance = turf.distance(
                    turf.point(currentCoords),
                    turf.point(clusterCenter),
                    { units: 'meters' }
                );

                if (distance <= spatialThreshold) {
                    // Add to current cluster
                    currentCluster.push(current);
                } else {
                    // Process current cluster and start new one
                    const clusterDuration = (currentTime - (clusterStartTime || currentTime)) / (1000 * 60); // minutes
                    
                    if (clusterDuration >= minStayDuration && currentCluster.length > 0) {
                        const stayPoint = this._createStayPointFromCluster(
                            currentCluster.map(c => c.feature), 
                            clusterDuration, 
                            stayClusters.length
                        );
                        
                        // Get the min and max original indices
                        const originalIndices = currentCluster.map(c => c.originalIndex);
                        const startIndex = Math.min(...originalIndices);
                        const endIndex = Math.max(...originalIndices);
                        
                        stayClusters.push({
                            stayPoint,
                            startIndex,
                            endIndex,
                            points: currentCluster.map(c => c.feature)
                        });
                    }

                    // Start new cluster
                    currentCluster = [current];
                    clusterStartTime = currentTime;
                }
            }
        }

        // Process final cluster
        if (currentCluster.length > 0 && clusterStartTime) {
            const lastTime = new Date(
                this.getMappedValue(currentCluster[currentCluster.length - 1].feature, fieldMapping, 'time')
            ).getTime();
            const clusterDuration = (lastTime - clusterStartTime) / (1000 * 60);
            
            if (clusterDuration >= minStayDuration) {
                const stayPoint = this._createStayPointFromCluster(
                    currentCluster.map(c => c.feature), 
                    clusterDuration, 
                    stayClusters.length
                );
                
                const originalIndices = currentCluster.map(c => c.originalIndex);
                const startIndex = Math.min(...originalIndices);
                const endIndex = Math.max(...originalIndices);
                
                stayClusters.push({
                    stayPoint,
                    startIndex,
                    endIndex,
                    points: currentCluster.map(c => c.feature)
                });
            }
        }

        return { stayClusters };
    }

    private _getAltitudeFromFeature(feature: any): number | null {
        if (!feature) return null;
        
        // Try to get altitude from 3D coordinates first
        if (feature.geometry?.coordinates?.length >= 3) {
            const altitude = feature.geometry.coordinates[2];
            if (typeof altitude === 'number' && !isNaN(altitude)) {
                return altitude;
            }
        }
        
        // Try to get altitude from properties
        const properties = feature.properties || {};
        
        // Check various altitude property names
        const altitudeKeys = ['altitude', 'alt', 'elevation', 'elev', 'height', '_height'];
        for (const key of altitudeKeys) {
            if (key in properties) {
                const altitude = properties[key];
                if (typeof altitude === 'number' && !isNaN(altitude)) {
                    return altitude;
                }
            }
        }
        
        return null;
    }

    private _calculateClusterCenter(cluster: any[]): [number, number] {
        const sumLng = cluster.reduce((sum, f) => sum + f.geometry.coordinates[0], 0);
        const sumLat = cluster.reduce((sum, f) => sum + f.geometry.coordinates[1], 0);
        return [sumLng / cluster.length, sumLat / cluster.length];
    }

    private _createStayPointFromCluster(cluster: any[], duration: number, id: number) {
        const center = this._calculateClusterCenter(cluster);
        const startTime = cluster[0].properties?.time || cluster[0].properties?.timestamp;
        const endTime = cluster[cluster.length - 1].properties?.time || cluster[cluster.length - 1].properties?.timestamp;

        // Get the global height scale from Redux store factory to match trajectory visualization
        const globalHeightScale = this._getHeightScale();

        // Try to get actual altitude from the cluster points
        let rawStayElevation = 50; // Default elevation for stay points
        
        // Calculate average altitude from cluster points if available
        const altitudes = cluster
            .map(f => this._getAltitudeFromFeature(f))
            .filter(alt => alt !== null) as number[];
            
        if (altitudes.length > 0) {
            rawStayElevation = altitudes.reduce((sum, alt) => sum + alt, 0) / altitudes.length;
            console.log(`PPE Tool: Stay point ${id} - Using actual average altitude: ${rawStayElevation}m from ${altitudes.length} points`);
        } else {
            console.log(`PPE Tool: Stay point ${id} - No altitude data found, using default: ${rawStayElevation}m`);
        }

        // Apply height scale to match trajectory visualization
        const scaledStayElevation = rawStayElevation * globalHeightScale;
        console.log(`PPE Tool: Stay point ${id} - Scaled altitude: ${scaledStayElevation}m (raw: ${rawStayElevation}m × scale: ${globalHeightScale})`);

        const center3D = [center[0], center[1], scaledStayElevation];

        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: center3D // Use 3D coordinates with scaled altitude
            },
            properties: {
                stay_id: id,
                stay_duration_minutes: duration,
                stay_start_time: startTime,
                stay_end_time: endTime,
                cluster_size: cluster.length,
                stay_type: this._classifyStayPoint(duration),
                actual_altitude: rawStayElevation,
                scaled_altitude: scaledStayElevation,
                [PROCESSED_HEIGHT_FIELD]: Math.max(scaledStayElevation - 50, 10) // Relative height for visualization
            }
        };
    }

    private _classifyStayPoint(duration: number): string {
        if (duration < 30) return 'brief_stop';
        if (duration < 120) return 'short_stay';
        if (duration < 480) return 'medium_stay';
        return 'long_stay';
    }

    private _extractMovementPathsFromClusters(
        preprocessedData: FeatureCollection,
        stayClusters: Array<{
            stayPoint: any;
            startIndex: number;
            endIndex: number;
            points: any[];
        }>,
        fieldMapping: any,
        options: Record<string, any>
    ): any[] {
        const features = preprocessedData.features;
        const minMovingPoints = options.minMovingPoints || 3;
        const movementPaths: any[] = [];

        console.log('PPE Tool: Extracting movement paths from clusters');

        // For each pair of consecutive stay clusters
        for (let i = 0; i < stayClusters.length - 1; i++) {
            const fromCluster = stayClusters[i];
            const toCluster = stayClusters[i + 1];

            console.log(`PPE Tool: Checking path between cluster ${i} [${fromCluster.startIndex}-${fromCluster.endIndex}] and cluster ${i+1} [${toCluster.startIndex}-${toCluster.endIndex}]`);

            // Find movement points between clusters
            // Movement points are those with indices between the end of first cluster and start of next cluster
            const movementFeatures: any[] = [];
            
            // Collect all indices between clusters
            for (let idx = 0; idx < features.length; idx++) {
                // Check if this index is between the two clusters
                const isAfterFirstCluster = idx > fromCluster.endIndex;
                const isBeforeSecondCluster = idx < toCluster.startIndex;
                
                if (isAfterFirstCluster && isBeforeSecondCluster) {
                    movementFeatures.push(features[idx]);
                }
            }

            console.log(`PPE Tool: Found ${movementFeatures.length} movement points between clusters ${i} and ${i+1}`);

            if (movementFeatures.length >= minMovingPoints) {
                const fromStay = fromCluster.stayPoint;
                const toStay = toCluster.stayPoint;
                
                movementPaths.push({
                    path_id: i,
                    from_stay_id: fromStay.properties.stay_id,
                    to_stay_id: toStay.properties.stay_id,
                    from_stay_point: fromStay,
                    to_stay_point: toStay,
                    movement_features: movementFeatures,
                    start_time: new Date(fromStay.properties.stay_end_time).getTime(),
                    end_time: new Date(toStay.properties.stay_start_time).getTime(),
                    duration_minutes: (new Date(toStay.properties.stay_start_time).getTime() - 
                                     new Date(fromStay.properties.stay_end_time).getTime()) / (1000 * 60),
                    from_cluster_indices: `${fromCluster.startIndex}-${fromCluster.endIndex}`,
                    to_cluster_indices: `${toCluster.startIndex}-${toCluster.endIndex}`,
                    movement_indices: movementFeatures.map((_, idx) => fromCluster.endIndex + 1 + idx).join(',')
                });
            }
        }

        console.log(`PPE Tool: Total movement paths found: ${movementPaths.length}`);
        return movementPaths;
    }


    private _computePotentialPathEstimations(movementPaths: any[], options: Record<string, any>): any[] {
        const potentialPaths: any[] = [];
        const pathHeightScale = options.pathHeightScale || 500;
        const includeTimeVariation = options.includeTimeVariation !== false;

        for (const movementPath of movementPaths) {
            const pathFeatures = movementPath.movement_features;
            const pathDuration = movementPath.duration_minutes;

            // Calculate bounding box of all points in the movement path
            const coordinates = pathFeatures.map((f: any) => f.geometry.coordinates);
            coordinates.push(movementPath.from_stay_point.geometry.coordinates);
            coordinates.push(movementPath.to_stay_point.geometry.coordinates);

            const bbox = this._calculateBoundingBox(coordinates);
            
            // Create 3D polygon with height variation
            const polygonCoordinates = this._createPolygonFromBoundingBox(bbox);
            const polygon3D = this._create3DPolygon(
                polygonCoordinates,
                pathDuration,
                pathHeightScale,
                includeTimeVariation,
                movementPath
            );

            potentialPaths.push({
                path_id: movementPath.path_id,
                from_stay_id: movementPath.from_stay_id,
                to_stay_id: movementPath.to_stay_id,
                polygon: polygon3D,
                bbox: bbox,
                movement_duration_minutes: pathDuration,
                point_count: pathFeatures.length,
                estimated_area_km2: this._calculatePolygonArea(polygonCoordinates),
                max_width_km: this._calculateMaxWidth(bbox),
                max_length_km: this._calculateMaxLength(bbox)
            });
        }

        return potentialPaths;
    }

    private _calculateBoundingBox(coordinates: [number, number][]): {
        minLng: number;
        maxLng: number;
        minLat: number;
        maxLat: number;
    } {
        let minLng = Infinity, maxLng = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;

        coordinates.forEach(([lng, lat]) => {
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
        });

        return { minLng, maxLng, minLat, maxLat };
    }

    private _createPolygonFromBoundingBox(bbox: {
        minLng: number;
        maxLng: number;
        minLat: number;
        maxLat: number;
    }): [number, number][] {
        return [
            [bbox.minLng, bbox.minLat], // Bottom-left
            [bbox.maxLng, bbox.minLat], // Bottom-right
            [bbox.maxLng, bbox.maxLat], // Top-right
            [bbox.minLng, bbox.maxLat], // Top-left
            [bbox.minLng, bbox.minLat]  // Close polygon
        ];
    }

    private _create3DPolygon(
        polygonCoordinates: [number, number][],
        pathDuration: number,
        heightScale: number,
        includeTimeVariation: boolean,
        movementPath: any
    ) {
        // Get the global height scale from Redux store factory to match trajectory visualization
        const globalHeightScale = this._getHeightScale();
        
        // Extract altitude information from actual trajectory points in the movement path
        const movementFeatures = movementPath.movement_features || [];
        let baseAltitude = 0;
        let heightDifference = heightScale; // Default fallback
        
        if (movementFeatures.length > 0) {
            // Get altitude from first and last points in the movement path
            const firstPoint = movementFeatures[0];
            const lastPoint = movementFeatures[movementFeatures.length - 1];
            
            // Try to get altitude from coordinates (3D) or properties
            const firstAltitude = this._getAltitudeFromFeature(firstPoint);
            const lastAltitude = this._getAltitudeFromFeature(lastPoint);
            
            if (firstAltitude !== null && lastAltitude !== null) {
                // Apply global height scale to match trajectory visualization
                baseAltitude = firstAltitude * globalHeightScale;
                heightDifference = Math.abs(lastAltitude - firstAltitude) * globalHeightScale;
                
                // Ensure minimum height for visibility
                if (heightDifference < 10) {
                    heightDifference = Math.max(heightScale * 0.1, 50);
                }
                
                console.log(`PPE Tool: Path ${movementPath.path_id} - First altitude: ${firstAltitude}m (scaled: ${baseAltitude}m), Last altitude: ${lastAltitude}m, Height difference: ${heightDifference}m, Height scale: ${globalHeightScale}`);
            } else {
                // Fallback to stay point altitudes if movement points don't have altitude
                const fromStayAltitude = this._getAltitudeFromFeature(movementPath.from_stay_point);
                const toStayAltitude = this._getAltitudeFromFeature(movementPath.to_stay_point);
                
                if (fromStayAltitude !== null) {
                    baseAltitude = fromStayAltitude * globalHeightScale;
                    if (toStayAltitude !== null) {
                        heightDifference = Math.abs(toStayAltitude - fromStayAltitude) * globalHeightScale;
                        if (heightDifference < 10) {
                            heightDifference = heightScale * 0.2;
                        }
                    }
                }
                
                console.log(`PPE Tool: Path ${movementPath.path_id} - Using stay point altitudes. Base: ${baseAltitude}m, Height: ${heightDifference}m, Height scale: ${globalHeightScale}`);
            }
        }

        // Apply time variation if enabled
        let finalHeight = heightDifference;
        if (includeTimeVariation && pathDuration > 0) {
            // Longer paths get more height variation
            const timeVariationFactor = Math.min(pathDuration / 60, 2.0); // Max 2x variation for 1+ hour paths
            finalHeight *= (1 + timeVariationFactor * 0.3); // Up to 30% increase
        }

        // Create 3D polygon coordinates with actual altitude
        const topAltitude = baseAltitude + finalHeight;
        const coordinates3D = polygonCoordinates.map(([lng, lat]) => [lng, lat, topAltitude]);

        // Also create a GeoJSON string representation for Kepler.gl compatibility
        const geojsonString = JSON.stringify({
            type: 'Polygon',
            coordinates: [coordinates3D]
        });

        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates3D] // Use 3D coordinates with real altitude
            },
            properties: {
                path_id: movementPath.path_id,
                from_stay_id: movementPath.from_stay_id,
                to_stay_id: movementPath.to_stay_id,
                base_altitude: baseAltitude,
                height_difference: heightDifference,
                final_height: finalHeight,
                top_altitude: topAltitude,
                duration_minutes: pathDuration,
                path_type: 'potential_path_estimation',
                point_count: movementFeatures.length,
                // Add elevation field for Kepler.gl
                [PROCESSED_HEIGHT_FIELD]: finalHeight,
                _geojson: geojsonString
            }
        };
    }

    private _calculatePolygonArea(coordinates: [number, number][]): number {
        const polygon = turf.polygon([coordinates]);
        const area = turf.area(polygon);
        return area / 1000000; // Convert to km²
    }

    private _calculateMaxWidth(bbox: {
        minLng: number;
        maxLng: number;
        minLat: number;
        maxLat: number;
    }): number {
        const width = turf.distance(
            turf.point([bbox.minLng, (bbox.minLat + bbox.maxLat) / 2]),
            turf.point([bbox.maxLng, (bbox.minLat + bbox.maxLat) / 2]),
            { units: 'kilometers' }
        );
        return width;
    }

    private _calculateMaxLength(bbox: {
        minLng: number;
        maxLng: number;
        minLat: number;
        maxLat: number;
    }): number {
        const length = turf.distance(
            turf.point([(bbox.minLng + bbox.maxLng) / 2, bbox.minLat]),
            turf.point([(bbox.minLng + bbox.maxLng) / 2, bbox.maxLat]),
            { units: 'kilometers' }
        );
        return length;
    }

    private async _createVisualizationDatasets(
        potentialPaths: any[],
        stayPoints: any[],
        movementPaths: any[],
        options: Record<string, any>
    ): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];

        // Note: We don't include the 3D trajectory here since the original Time Geography
        // tool results are now preserved on the map by the analysis runner.
        // This avoids duplicate trajectory visualizations.

        // 1. Potential Path Polygons Dataset
        const pathPolygons: FeatureCollection = {
            type: 'FeatureCollection',
            features: potentialPaths.map(path => path.polygon)
        };

        const pathPolygonsConfig = this._createPathPolygonsLayerConfig(options);
        datasets.push(this.createDataset(
            'potential-path-polygons',
            'Potential Path Estimation Polygons',
            pathPolygons,
            {
                description: '3D polygons representing estimated potential movement paths',
                visualizationConfig: {
                    config: {
                        visState: {
                            layers: [pathPolygonsConfig]
                        }
                    }
                }
            }
        ));

        // 2. Major Stay Points Dataset
        const majorStayPoints: FeatureCollection = {
            type: 'FeatureCollection',
            features: stayPoints
        };

        const stayPointsConfig = this._createMajorStayPointsLayerConfig();
        datasets.push(this.createDataset(
            'major-stay-points',
            'Major Stay Points',
            majorStayPoints,
            {
                description: 'Major stay points used for path estimation',
                visualizationConfig: {
                    config: {
                        visState: {
                            layers: [stayPointsConfig]
                        }
                    }
                }
            }
        ));

        // 3. Movement Path Centers Dataset
        const pathCenters = this._createPathCentersData(movementPaths);
        const pathCentersConfig = this._createPathCentersLayerConfig();
        
        datasets.push(this.createDataset(
            'movement-path-centers',
            'Movement Path Centers',
            pathCenters,
            {
                description: 'Center points of movement paths with metadata',
                visualizationConfig: {
                    config: {
                        visState: {
                            layers: [pathCentersConfig]
                        }
                    }
                }
            }
        ));

        return datasets;
    }

    private _createPathPolygonsLayerConfig(options: any) {
        const opacity = options.pathOpacity || 0.6;
        const timestamp = Date.now();
        
        return {
            id: `potential-path-polygons-layer-${timestamp}`,
            type: 'geojson',
            config: {
                dataId: 'potential-path-polygons',
                label: 'Potential Path Polygons',
                columnMode: 'geojson',
                columns: { 
                    geojson: '_geojson' 
                },
                color: [51, 153, 255],
                isVisible: true,
                visConfig: {
                    opacity: opacity,
                    strokeOpacity: 0.8,
                    thickness: 2,
                    strokeColor: [0, 102, 204],
                    filled: true,
                    enable3d: true,
                    elevationScale: 1,
                    wireframe: false,
                    fixedHeight: true
                },
                hidden: false,
                heightField: { 
                    name: PROCESSED_HEIGHT_FIELD, 
                    type: 'real' 
                }
            },
            visualChannels: {
                heightScale: 'linear',
                colorField: {
                    name: 'duration_minutes',
                    type: 'real'
                },
                colorScale: 'quantile',
                colorRange: {
                    name: 'Global Warming',
                    type: 'sequential',
                    category: 'Uber',
                    colors: ['#5A1846', '#900C3F', '#C70039', '#E3611C', '#F1920E', '#FFC300']
                }
            }
        };
    }

    private _createMajorStayPointsLayerConfig() {
        const timestamp = Date.now();
        
        return {
            id: `major-stay-points-layer-${timestamp}`,
            type: 'point',
            config: {
                dataId: 'major-stay-points',
                label: 'Major Stay Points',
                color: [255, 51, 51],
                isVisible: true,
                visConfig: {
                    opacity: 0.9,
                    radius: 30,
                    radiusRange: [20, 60],
                    strokeColor: [255, 255, 255],
                    strokeWidth: 2,
                    filled: true,
                    enable3d: true,
                    elevationScale: 1
                },
                heightField: { 
                    name: PROCESSED_HEIGHT_FIELD, 
                    type: 'real' 
                }
            },
            visualChannels: {
                colorField: {
                    name: 'stay_duration_minutes',
                    type: 'real'
                },
                colorScale: 'quantile',
                radiusField: {
                    name: 'cluster_size',
                    type: 'integer'
                },
                radiusScale: 'sqrt',
                colorRange: {
                    name: 'ColorBrewer RdYlBu-6',
                    type: 'diverging',
                    category: 'ColorBrewer',
                    colors: ['#d73027', '#f46d43', '#fdae61', '#abd9e9', '#74add1', '#4575b4']
                }
            }
        };
    }

    private _createPathCentersData(movementPaths: any[]): FeatureCollection {
        // Get the global height scale from Redux store factory to match trajectory visualization
        const globalHeightScale = this._getHeightScale();
        
        const features = movementPaths.map(path => {
            // Calculate center of the movement path
            const allCoords = path.movement_features.map((f: any) => f.geometry.coordinates);
            const rawPathCenterElevation = 25; // Base elevation for path center points
            const pathCenterElevation = rawPathCenterElevation * globalHeightScale; // Apply height scale
            
            if (allCoords.length === 0) {
                // If no movement features, use midpoint between stay points
                const fromCoords = path.from_stay_point.geometry.coordinates;
                const toCoords = path.to_stay_point.geometry.coordinates;
                const centerLng = (fromCoords[0] + toCoords[0]) / 2;
                const centerLat = (fromCoords[1] + toCoords[1]) / 2;
                
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [centerLng, centerLat, pathCenterElevation]
                    },
                    properties: {
                        path_id: path.path_id,
                        from_stay_id: path.from_stay_id,
                        to_stay_id: path.to_stay_id,
                        duration_minutes: path.duration_minutes,
                        point_count: 0,
                        path_center_type: 'direct_connection',
                        from_cluster: path.from_cluster_indices,
                        to_cluster: path.to_cluster_indices,
                        [PROCESSED_HEIGHT_FIELD]: pathCenterElevation
                    }
                };
            }
            
            const centerLng = allCoords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / allCoords.length;
            const centerLat = allCoords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / allCoords.length;

            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [centerLng, centerLat, pathCenterElevation]
                },
                properties: {
                    path_id: path.path_id,
                    from_stay_id: path.from_stay_id,
                    to_stay_id: path.to_stay_id,
                    duration_minutes: path.duration_minutes,
                    point_count: path.movement_features.length,
                    path_center_type: 'movement_path',
                    from_cluster: path.from_cluster_indices,
                    to_cluster: path.to_cluster_indices,
                    movement_indices: path.movement_indices,
                    [PROCESSED_HEIGHT_FIELD]: pathCenterElevation
                }
            };
        });

        return {
            type: 'FeatureCollection',
            features
        };
    }

    private _createPathCentersLayerConfig() {
        const timestamp = Date.now();
        
        return {
            id: `movement-path-centers-layer-${timestamp}`,
            type: 'point',
            config: {
                dataId: 'movement-path-centers',
                label: 'Movement Path Centers',
                color: [255, 165, 0],
                isVisible: true,
                visConfig: {
                    opacity: 0.7,
                    radius: 15,
                    radiusRange: [10, 30],
                    strokeColor: [255, 140, 0],
                    strokeWidth: 1,
                    filled: true,
                    enable3d: true,
                    elevationScale: 1
                },
                heightField: { 
                    name: PROCESSED_HEIGHT_FIELD, 
                    type: 'real' 
                }
            },
            visualChannels: {
                colorField: {
                    name: 'point_count',
                    type: 'integer'
                },
                colorScale: 'quantile',
                radiusField: {
                    name: 'duration_minutes',
                    type: 'real'
                },
                radiusScale: 'sqrt',
                colorRange: {
                    name: 'Uber Pool',
                    type: 'sequential',
                    category: 'Uber',
                    colors: ['#213E9F', '#2D5BA8', '#3F7BB2', '#52A0BD', '#66C5C8', '#7BEBD3']
                }
            }
        };
    }

    private _calculateAveragePathWidth(potentialPaths: any[]): string {
        if (potentialPaths.length === 0) return '0 km';
        
        const totalWidth = potentialPaths.reduce((sum, path) => sum + path.max_width_km, 0);
        const avgWidth = totalWidth / potentialPaths.length;
        return `${avgWidth.toFixed(3)} km`;
    }

    private _calculateAveragePathLength(potentialPaths: any[]): string {
        if (potentialPaths.length === 0) return '0 km';
        
        const totalLength = potentialPaths.reduce((sum, path) => sum + path.max_length_km, 0);
        const avgLength = totalLength / potentialPaths.length;
        return `${avgLength.toFixed(3)} km`;
    }

    private _validatePreprocessedData(data: FeatureCollection): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!data.features || data.features.length === 0) {
            errors.push('No features found in dataset');
        }
        
        if (data.features.length < 10) {
            errors.push('At least 10 points recommended for meaningful path estimation');
        }
        
        return { valid: errors.length === 0, errors };
    }
}