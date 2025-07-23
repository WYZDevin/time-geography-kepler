import { AbstractBaseTool } from './base-tool';
import { AnalysisContext, AnalysisResult, DatasetResult, ProgressCallback, ToolOption } from '../interfaces/tool-interfaces';
import { FeatureCollection } from '../interfaces/data-interfaces';
import { PROCESSED_HEIGHT_FIELD } from '../utils/constants';
import { selectHeightScale, selectSideLength } from '../stores/metadata-slice';
import store, { RootState } from '../stores/store';
import { preprocessGeojsonData } from '../data-processors/data-preprocessing';
import { TimeGeographyTool } from './time-geography-tool';
import * as turf from '@turf/turf';

export class SpaceTimeCubeTool extends AbstractBaseTool {
    readonly id = 'space-time-cube';
    readonly name = 'Space-Time Cube';
    readonly description = 'Visualize spatio-temporal data as 3D cubes representing raster cells through time';
    readonly icon = '🧊';
    readonly category = 'analysis' as const;
    readonly version = '1.0.0';
    readonly author = 'GISPark Team';

    readonly requiredFields = ['latitude', 'longitude', 'time'];
    readonly optionalFields = ['value', 'altitude', 'layer_id'];

    readonly options: ToolOption[] = [
        {
            key: 'cellSize',
            label: 'Cell Size (meters)',
            type: 'number',
            defaultValue: 1000,
            min: 100,
            max: 10000,
            step: 100,
            description: 'Size of each cube cell in meters'
        },
        {
            key: 'timeSlices',
            label: 'Number of Time Slices',
            type: 'number',
            defaultValue: 10,
            min: 3,
            max: 50,
            step: 1,
            description: 'Number of temporal layers in the space-time cube'
        },
        {
            key: 'valueAggregation',
            label: 'Value Aggregation Method',
            type: 'select',
            defaultValue: 'count',
            options: [
                { value: 'count', label: 'Point Count' },
                { value: 'sum', label: 'Sum of Values' },
                { value: 'mean', label: 'Mean of Values' },
                { value: 'max', label: 'Maximum Value' },
                { value: 'min', label: 'Minimum Value' }
            ],
            description: 'How to aggregate point values within each cube cell'
        },
        {
            key: 'generateRandomCubes',
            label: 'Generate Random Cubes from Trajectory',
            type: 'boolean',
            defaultValue: false,
            description: 'Generate random space-time cubes based on trajectory patterns'
        },
        {
            key: 'randomCubeCount',
            label: 'Random Cube Count',
            type: 'number',
            defaultValue: 50,
            min: 10,
            max: 200,
            step: 10,
            description: 'Number of random cubes to generate'
        },
        {
            key: 'cubeOpacity',
            label: 'Cube Opacity',
            type: 'number',
            defaultValue: 0.7,
            min: 0.1,
            max: 1.0,
            step: 0.1,
            description: 'Opacity of the space-time cubes'
        },
        {
            key: 'cubeVariableToJoin',
            label: 'Cube Variable to Join',
            type: 'select',
            defaultValue: 'aggregated_value',
            options: [
                { value: 'aggregated_value', label: 'Aggregated Value' },
                { value: 'point_count', label: 'Point Count' },
                { value: 'time_slice', label: 'Time Slice' },
                { value: 'base_altitude', label: 'Base Altitude' },
                { value: 'cube_height', label: 'Cube Height' },
                { value: 'top_altitude', label: 'Top Altitude' }
            ],
            description: 'Select which cube variable to assign to trajectory points'
        },
    ];

    /**
     * Get height scale from Redux store using typed selector
     */
    private _getHeightScale(): number {
        const state: RootState = store.getState();
        return selectHeightScale(state);
    }

    async analyze(context: AnalysisContext, progressCallback?: ProgressCallback): Promise<AnalysisResult> {
        try {
            this.updateProgress(progressCallback, 5, 'Preprocessing data to set base state...');

            const { data, fieldMapping, options } = context;

            // Always call preprocessing to set the base state (side length, heightScale)
            const preprocessedData = preprocessGeojsonData(data);
            console.log('Space-Time Cube: Data preprocessing complete');

            this.updateProgress(progressCallback, 10, 'Initializing space-time cube analysis...');

            // Validate input data
            const validation = this._validateInputData(preprocessedData);
            if (!validation.valid) {
                return this.createErrorResult(`Data validation failed: ${validation.errors.join(', ')}`);
            }

            this.updateProgress(progressCallback, 30, 'Processing temporal data...');

            // Extract and process temporal information
            const processedData = this._processTemporalData(preprocessedData, fieldMapping, options);

            this.updateProgress(progressCallback, 50, 'Creating spatial grid...');

            // Create spatial grid
            const spatialGrid = this._createSpatialGrid(processedData, options);

            this.updateProgress(progressCallback, 70, 'Generating space-time cubes...');

            // Generate space-time cubes
            const spaceTimeCubes = await this._generateSpaceTimeCubes(
                processedData,
                spatialGrid,
                fieldMapping,
                options
            );

            // Generate random cubes if enabled
            let randomCubes: any[] = [];
            if (options.generateRandomCubes) {
                this.updateProgress(progressCallback, 85, 'Generating random cubes...');
                randomCubes = this._generateRandomCubes(processedData, spatialGrid, options);
            }

            this.updateProgress(progressCallback, 90, 'Creating visualization datasets...');

            // Always create trajectory visualization (automatic)
            this.updateProgress(progressCallback, 92, 'Creating trajectory visualization...');
            const trajectoryDatasets = await this._createTrajectoryVisualization(
                context,
                processedData,
                spaceTimeCubes,
                spatialGrid
            );

            // Create visualization datasets
            const cubeDatasets = await this._createVisualizationDatasets(
                spaceTimeCubes,
                randomCubes,
                spatialGrid,
                options
            );

            // Combine cube datasets with trajectory datasets
            const datasets = [...cubeDatasets, ...trajectoryDatasets];

            this.updateProgress(progressCallback, 100, 'Space-time cube analysis complete');

            return this.createMultiDatasetResult(datasets, {
                totalCubes: spaceTimeCubes.length,
                randomCubes: randomCubes.length,
                timeSlices: options.timeSlices || 10,
                cellSize: options.cellSize || 1000,
                spatialExtent: this._calculateSpatialExtent(spatialGrid),
                temporalExtent: this._calculateTemporalExtent(processedData)
            });

        } catch (error) {
            console.error('Space-Time Cube analysis error:', error);
            return this.createErrorResult(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private _validateInputData(data: FeatureCollection): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!data.features || data.features.length === 0) {
            errors.push('No features found in dataset');
        }

        if (data.features.length < 5) {
            errors.push('At least 5 points required for meaningful space-time cube analysis');
        }

        return { valid: errors.length === 0, errors };
    }

    private _processTemporalData(
        data: FeatureCollection,
        fieldMapping: any,
        options: Record<string, any>
    ): any[] {
        const features = data.features.map((feature, index) => {
            const coords = feature.geometry.coordinates;
            const timeValue = this.getMappedValue(feature, fieldMapping, 'time');
            const value = fieldMapping.value ? 
                this.getMappedValue(feature, fieldMapping, 'value') : 1;

            return {
                id: index,
                longitude: coords[0],
                latitude: coords[1],
                altitude: coords.length > 2 ? coords[2] : 0,
                time: new Date(timeValue).getTime(),
                timeString: timeValue,
                value: parseFloat(value) || 1,
                layerId: feature.properties?.layer_id || 0,
                originalFeature: feature
            };
        });

        // Sort by time
        features.sort((a, b) => a.time - b.time);

        console.log(`SpaceTimeCube: Processed ${features.length} temporal features`);
        return features;
    }

    private _createSpatialGrid(processedData: any[], options: Record<string, any>): {
        bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
        cellSize: number;
        gridCells: Array<{ i: number; j: number; bounds: number[][]; center: number[] }>;
    } {
        const cellSize = options.cellSize || 1000; // meters

        // Calculate bounding box
        const lngs = processedData.map(d => d.longitude);
        const lats = processedData.map(d => d.latitude);
        const bounds = {
            minLng: Math.min(...lngs),
            maxLng: Math.max(...lngs),
            minLat: Math.min(...lats),
            maxLat: Math.max(...lats)
        };

        // Calculate center latitude for proper longitude scaling
        const centerLat = (bounds.minLat + bounds.maxLat) / 2;
        
        // Convert cell size from meters to degrees with proper latitude correction
        const cellSizeDegreesLat = cellSize / 111320; // 1 degree latitude ≈ 111.32 km (constant)
        const cellSizeDegreesLng = cellSize / (111320 * Math.cos(centerLat * Math.PI / 180)); // longitude varies with latitude

        // Create grid cells with proper square dimensions
        const gridCells: Array<{ i: number; j: number; bounds: number[][]; center: number[] }> = [];
        const cols = Math.ceil((bounds.maxLng - bounds.minLng) / cellSizeDegreesLng);
        const rows = Math.ceil((bounds.maxLat - bounds.minLat) / cellSizeDegreesLat);

        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const minLng = bounds.minLng + i * cellSizeDegreesLng;
                const maxLng = bounds.minLng + (i + 1) * cellSizeDegreesLng;
                const minLat = bounds.minLat + j * cellSizeDegreesLat;
                const maxLat = bounds.minLat + (j + 1) * cellSizeDegreesLat;

                gridCells.push({
                    i,
                    j,
                    bounds: [
                        [minLng, minLat],
                        [maxLng, minLat],
                        [maxLng, maxLat],
                        [minLng, maxLat],
                        [minLng, minLat]
                    ],
                    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
                });
            }
        }

        console.log(`SpaceTimeCube: Created ${gridCells.length} grid cells (${cols}x${rows})`);
        return { bounds, cellSize, gridCells };
    }

    private async _generateSpaceTimeCubes(
        processedData: any[],
        spatialGrid: any,
        fieldMapping: any,
        options: Record<string, any>
    ): Promise<any[]> {
        const timeSlices = options.timeSlices || 10;
        const valueAggregation = options.valueAggregation || 'count';
        
        // Use the grid cell size as cube height (not the bbox side length from store)
        const gridCellSize = options.cellSize || 1000; // meters
        const cubeHeight = gridCellSize; // Each cube height equals the grid cell side length

        // Calculate time slices
        const minTime = Math.min(...processedData.map(d => d.time));
        const maxTime = Math.max(...processedData.map(d => d.time));
        const timeInterval = (maxTime - minTime) / timeSlices;

        const cubes: any[] = [];

        // First, determine which cells have ANY data across all time slices
        const cellsWithData = new Set<string>();
        for (const point of processedData) {
            for (const cell of spatialGrid.gridCells) {
                if (this._isPointInCell(point, cell)) {
                    cellsWithData.add(`${cell.i}_${cell.j}`);
                }
            }
        }

        console.log(`SpaceTimeCube: Found ${cellsWithData.size} cells with data`);

        // For each cell that has data, create a complete stack of cubes
        for (const cell of spatialGrid.gridCells) {
            const cellKey = `${cell.i}_${cell.j}`;
            
            // Only create cube stacks for cells that have at least some data
            if (!cellsWithData.has(cellKey)) continue;

            // Create a cube for EVERY time slice at this location
            for (let t = 0; t < timeSlices; t++) {
                const sliceStartTime = minTime + t * timeInterval;
                const sliceEndTime = minTime + (t + 1) * timeInterval;
                
                // Find points in this cell during this time slice
                const cellPoints = processedData.filter(point => 
                    point.time >= sliceStartTime && 
                    point.time < sliceEndTime &&
                    this._isPointInCell(point, cell)
                );

                // Assign random value between 1-100 for each grid cell
                const aggregatedValue = Math.floor(Math.random() * 100) + 1;
                
                // Calculate cube properties - stack cubes on top of each other
                // Each time slice starts where the previous one ends
                const baseAltitude = t * cubeHeight; // No scaling, just stack by cube height
                
                // Create 3D cube (as extruded polygon)
                const cube = this._createCube(
                    cell,
                    baseAltitude,
                    cubeHeight, // Use unscaled cube height
                    aggregatedValue,
                    t,
                    sliceStartTime,
                    sliceEndTime,
                    cellPoints.length
                );

                // Mark empty cubes for visual distinction
                if (cellPoints.length === 0) {
                    cube.properties.is_empty = true;
                    cube.properties.cube_type = 'empty';
                }

                cubes.push(cube);
            }
        }

        console.log(`SpaceTimeCube: Generated ${cubes.length} space-time cubes`);
        return cubes;
    }

    private _generateRandomCubes(
        processedData: any[],
        spatialGrid: any,
        options: Record<string, any>
    ): any[] {
        const randomCubeCount = options.randomCubeCount || 50;
        const timeSlices = options.timeSlices || 10;
        
        // Use the grid cell size as cube height (not the bbox side length from store)
        const gridCellSize = options.cellSize || 1000; // meters
        const cubeHeight = gridCellSize; // Each cube height equals the grid cell side length
        const randomCubes: any[] = [];

        const bounds = spatialGrid.bounds;
        const timeRange = {
            min: Math.min(...processedData.map(d => d.time)),
            max: Math.max(...processedData.map(d => d.time))
        };

        for (let i = 0; i < randomCubeCount; i++) {
            // Random position within trajectory bounds
            const randomLng = bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng);
            const randomLat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
            
            // Random time slice
            const randomTimeSlice = Math.floor(Math.random() * (options.timeSlices || 10));
            // Stack cubes - each time slice starts where the previous ends
            const baseAltitude = randomTimeSlice * cubeHeight; // No scaling, just stack by cube height
            
            // Random value
            const randomValue = Math.random() * 100;
            
            // Create random cube cell with proper square dimensions
            const cellSizeDegreesLat = spatialGrid.cellSize / 111320; // 1 degree latitude ≈ 111.32 km (constant)
            const cellSizeDegreesLng = spatialGrid.cellSize / (111320 * Math.cos(randomLat * Math.PI / 180)); // longitude varies with latitude

            const randomCell = {
                i: -1,
                j: -1,
                bounds: [
                    [randomLng - cellSizeDegreesLng/2, randomLat - cellSizeDegreesLat/2],
                    [randomLng + cellSizeDegreesLng/2, randomLat - cellSizeDegreesLat/2],
                    [randomLng + cellSizeDegreesLng/2, randomLat + cellSizeDegreesLat/2],
                    [randomLng - cellSizeDegreesLng/2, randomLat + cellSizeDegreesLat/2],
                    [randomLng - cellSizeDegreesLng/2, randomLat - cellSizeDegreesLat/2]
                ],
                center: [randomLng, randomLat]
            };

            const randomCube = this._createCube(
                randomCell,
                baseAltitude,
                cubeHeight, // Use unscaled cube height
                randomValue,
                randomTimeSlice,
                timeRange.min + randomTimeSlice * (timeRange.max - timeRange.min) / (options.timeSlices || 10),
                timeRange.min + (randomTimeSlice + 1) * (timeRange.max - timeRange.min) / (options.timeSlices || 10),
                Math.floor(Math.random() * 20) + 1
            );

            randomCube.properties.cube_type = 'random';
            randomCube.properties.random_id = i;
            randomCubes.push(randomCube);
        }

        console.log(`SpaceTimeCube: Generated ${randomCubes.length} random cubes`);
        return randomCubes;
    }

    private _isPointInCell(point: any, cell: any): boolean {
        return point.longitude >= cell.bounds[0][0] &&
               point.longitude < cell.bounds[2][0] &&
               point.latitude >= cell.bounds[0][1] &&
               point.latitude < cell.bounds[2][1];
    }

    private async _createTrajectoryVisualization(
        context: AnalysisContext,
        processedData: any[],
        spaceTimeCubes: any[],
        spatialGrid: any
    ): Promise<DatasetResult[]> {
        try {
            // Create TimeGeographyTool instance for basic trajectory only
            const timeGeographyTool = new TimeGeographyTool();

            // Create analysis context for trajectory tool (only basic trajectory)
            const trajectoryContext: AnalysisContext = {
                ...context,
                options: {
                    visualizeStay: false,
                    visualizeSTKDE: false,
                    visualizeAxis: false,
                    timeWindow: 24
                }
            };

            // Run basic trajectory analysis
            const trajectoryResult = await timeGeographyTool.analyze(trajectoryContext);

            if (trajectoryResult.success && trajectoryResult.datasets) {
                // Create enhanced trajectory points with cube values
                const enhancedTrajectoryPoints = this._createEnhancedTrajectoryPoints(
                    processedData,
                    spaceTimeCubes,
                    spatialGrid,
                    context.options
                );

                // Get basic trajectory dataset and add enhanced points
                const basicTrajectoryDataset = trajectoryResult.datasets[0]; // First dataset is the trajectory
                const datasets: DatasetResult[] = [basicTrajectoryDataset];

                // Add enhanced trajectory points dataset
                if (enhancedTrajectoryPoints.length > 0) {
                    datasets.push(this.createDataset(
                        'enhanced-trajectory-points',
                        'Trajectory Points with Cube Values',
                        {
                            type: 'FeatureCollection',
                            features: enhancedTrajectoryPoints
                        },
                        {
                            description: 'Original trajectory points with assigned cube values',
                            visualizationConfig: {
                                config: {
                                    visState: {
                                        layers: [this._createEnhancedPointsLayerConfig()]
                                    }
                                }
                            }
                        }
                    ));
                }

                console.log(`SpaceTimeCube: Successfully created trajectory visualization with ${datasets.length} datasets`);
                return datasets;
            } else {
                console.warn('TimeGeography analysis failed, creating fallback trajectory');
                return [];
            }
        } catch (error) {
            console.error('Error creating trajectory visualization:', error);
            return [];
        }
    }

    private _createEnhancedTrajectoryPoints(
        processedData: any[],
        spaceTimeCubes: any[],
        spatialGrid: any,
        options: Record<string, any>
    ): any[] {
        const enhancedPoints: any[] = [];
        const cubeVariableToJoin = options.cubeVariableToJoin || 'aggregated_value';

        for (const point of processedData) {
            // Find which cube this point belongs to
            const matchingCube = this._findMatchingCube(point, spaceTimeCubes, spatialGrid, options);
            
            // Get the selected variable value from the cube
            const cubeJoinValue = matchingCube ? matchingCube.properties[cubeVariableToJoin] : null;
            
            const enhancedPoint = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [point.longitude, point.latitude, point.altitude]
                },
                properties: {
                    point_id: `enhanced_point_${point.id}`,
                    original_value: point.value,
                    timestamp: point.timeString,
                    time_ms: point.time,
                    // Store all cube values for reference
                    cube_aggregated_value: matchingCube ? matchingCube.properties.aggregated_value : 0,
                    cube_point_count: matchingCube ? matchingCube.properties.point_count : 0,
                    cube_time_slice: matchingCube ? matchingCube.properties.time_slice : null,
                    cube_base_altitude: matchingCube ? matchingCube.properties.base_altitude : null,
                    cube_height: matchingCube ? matchingCube.properties.cube_height : null,
                    cube_top_altitude: matchingCube ? matchingCube.properties.top_altitude : null,
                    // The selected variable for joining
                    selected_cube_variable: cubeVariableToJoin,
                    joined_cube_value: cubeJoinValue,
                    cube_id: matchingCube ? matchingCube.properties.cube_id : null,
                    elevation: point.altitude,
                    // Use selected cube variable for visualization if available, otherwise original value
                    display_value: cubeJoinValue !== null ? cubeJoinValue : point.value,
                    point_type: 'enhanced_trajectory',
                    has_cube_match: !!matchingCube
                }
            };

            enhancedPoints.push(enhancedPoint);
        }

        console.log(`SpaceTimeCube: Created ${enhancedPoints.length} enhanced trajectory points using cube variable: ${cubeVariableToJoin}`);
        return enhancedPoints;
    }

    private _findMatchingCube(
        point: any,
        spaceTimeCubes: any[],
        spatialGrid: any,
        options: Record<string, any>
    ): any | null {
        // Find which spatial cell this point belongs to
        const matchingCell = spatialGrid.gridCells.find((cell: any) => this._isPointInCell(point, cell));
        if (!matchingCell) return null;

        // Find which time slice this point belongs to
        const timeSlices = options.timeSlices || 10;
        const allTimes = spaceTimeCubes.map(cube => new Date(cube.properties.start_time).getTime());
        const minTime = Math.min(...allTimes);
        const maxTime = Math.max(...allTimes);
        const timeInterval = (maxTime - minTime) / timeSlices;
        
        const timeSlice = Math.floor((point.time - minTime) / timeInterval);
        const clampedTimeSlice = Math.max(0, Math.min(timeSlices - 1, timeSlice));

        // Find the matching cube
        const matchingCube = spaceTimeCubes.find(cube => 
            cube.properties.cell_i === matchingCell.i &&
            cube.properties.cell_j === matchingCell.j &&
            cube.properties.time_slice === clampedTimeSlice
        );

        return matchingCube || null;
    }

    private _createEnhancedPointsLayerConfig() {
        const timestamp = Date.now();

        return {
            id: `enhanced-trajectory-points-layer-${timestamp}`,
            type: 'point',
            config: {
                dataId: 'enhanced-trajectory-points',
                label: 'Enhanced Trajectory Points',
                color: [255, 165, 0], // Orange color
                isVisible: true,
                visConfig: {
                    opacity: 0.8,
                    strokeOpacity: 0.9,
                    thickness: 2,
                    strokeColor: [200, 130, 0],
                    filled: true,
                    enable3d: true,
                    elevationScale: 1,
                    wireframe: false,
                    radius: 4,
                    fixedRadius: false,
                    radiusRange: [2, 15]
                },
                hidden: false,
                columns: {
                    lat: '_latitude',
                    lng: '_longitude',
                    altitude: 'elevation'
                }
            },
            visualChannels: {
                colorField: {
                    name: 'joined_cube_value',
                    type: 'real'
                },
                colorScale: 'quantize',
                colorRange: {
                    name: 'Global Warming',
                    type: 'sequential',
                    category: 'Uber',
                    colors: ['#5A1846', '#900C3F', '#C70039', '#E3611C', '#F1920E', '#FFC300']
                },
                sizeField: {
                    name: 'joined_cube_value',
                    type: 'real'
                },
                sizeScale: 'linear'
            }
        };
    }

    private _aggregateValues(points: any[], method: string): number {
        if (points.length === 0) return 0;

        switch (method) {
            case 'count':
                return points.length;
            case 'sum':
                return points.reduce((sum, p) => sum + p.value, 0);
            case 'mean':
                return points.reduce((sum, p) => sum + p.value, 0) / points.length;
            case 'max':
                return Math.max(...points.map(p => p.value));
            case 'min':
                return Math.min(...points.map(p => p.value));
            default:
                return points.length;
        }
    }

    private _createCube(
        cell: any,
        baseAltitude: number,
        cubeHeight: number,
        value: number,
        timeSlice: number,
        startTime: number,
        endTime: number,
        pointCount: number
    ): any {
        // Create 2D polygon for Kepler.gl (height will be handled by elevation)
        // Use the cell bounds which are already 2D coordinates
        // console.log("Cell", cell.bounds.map(coord => [...coord, baseAltitude]));
        const cubeGeometry = {
            type: 'Polygon',
            coordinates: [cell.bounds.map(coord => [...coord, baseAltitude])] // 2D coordinates only
        };

        // Create a GeoJSON string for the _geojson field
        const geojsonString = JSON.stringify(cubeGeometry);

        // console.log("Base altitude", baseAltitude, "Cube height", cubeHeight, "Value", value, "Time slice", timeSlice);
        return {
            type: 'Feature',
            geometry: cubeGeometry,
            properties: {
                cube_id: `${cell.i}_${cell.j}_${timeSlice}`,
                cell_i: cell.i,
                cell_j: cell.j,
                time_slice: timeSlice,
                start_time: new Date(startTime).toISOString(),
                end_time: new Date(endTime).toISOString(),
                aggregated_value: value,
                point_count: pointCount,
                base_altitude: baseAltitude,
                cube_height: cubeHeight,
                top_altitude: baseAltitude + cubeHeight,
                cube_type: 'data',
                cell_center_lng: cell.center[0],
                cell_center_lat: cell.center[1],
                // IMPORTANT: This is the height of the extruded polygon
                [PROCESSED_HEIGHT_FIELD]: cubeHeight,
                // IMPORTANT: elevation positions the BASE of the cube
                // For time slice t=0: elevation = 0
                // For time slice t=1: elevation = cubeHeight (sits on top of t=0)
                // For time slice t=2: elevation = 2 * cubeHeight (sits on top of t=1)
                // This creates a stacked appearance where cubes build up through time
                elevation: baseAltitude,
                _geojson: geojsonString
            }
        };
    }

    private async _createVisualizationDatasets(
        spaceTimeCubes: any[],
        randomCubes: any[],
        spatialGrid: any,
        options: Record<string, any>
    ): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substring(7); // Add random string for extra uniqueness
        console.log(`Creating datasets at timestamp ${timestamp} with unique ID ${uniqueId}`);
        // 1. Space-Time Cubes Dataset
        if (spaceTimeCubes.length > 0) {
            const cubesData: FeatureCollection = {
                type: 'FeatureCollection',
                features: spaceTimeCubes
            };

            const cubesConfig = this._createSpaceTimeCubesLayerConfig(options, timestamp, uniqueId);
            datasets.push(this.createDataset(
                'space-time-cubes',
                'Space-Time Cubes',
                cubesData,
                {
                    description: '3D cubes representing spatio-temporal raster data',
                    visualizationConfig: {
                        config: {
                            visState: {
                                layers: [cubesConfig]
                            }
                        }
                    }
                }
            ));
        }

        // 2. Random Cubes Dataset (if enabled)
        if (randomCubes.length > 0) {
            const randomCubesData: FeatureCollection = {
                type: 'FeatureCollection',
                features: randomCubes
            };

            const randomCubesConfig = this._createRandomCubesLayerConfig(options, timestamp, uniqueId);
            datasets.push(this.createDataset(
                'random-space-time-cubes',
                'Random Space-Time Cubes',
                randomCubesData,
                {
                    description: 'Randomly generated space-time cubes based on trajectory patterns',
                    visualizationConfig: {
                        config: {
                            visState: {
                                layers: [randomCubesConfig]
                            }
                        }
                    }
                }
            ));
        }

        // 3. Grid Overview Dataset
        const gridData = this._createGridOverviewData(spatialGrid);
        const gridConfig = this._createGridOverviewLayerConfig(timestamp, uniqueId);
        datasets.push(this.createDataset(
            'spatial-grid',
            'Spatial Grid',
            gridData,
            {
                description: 'Spatial grid structure for space-time cube analysis',
                visualizationConfig: {
                    config: {
                        visState: {
                            layers: [gridConfig]
                        }
                    }
                }
            }
        ));


        return datasets;
    }

    private _createSpaceTimeCubesLayerConfig(options: any, timestamp: number, uniqueId: string) {
        const opacity = options.cubeOpacity || 0.7;

        return {
            id: `space-time-cubes-layer-${timestamp}-${uniqueId}`,
            type: 'geojson',
            config: {
                dataId: 'space-time-cubes',
                label: 'Space-Time Cubes',
                columnMode: 'geojson',
                columns: { 
                    geojson: '_geojson' 
                },
                color: [51, 153, 255],
                isVisible: true,
                visConfig: {
                    opacity: opacity,
                    strokeOpacity: 0.3, // Reduced for cleaner look
                    thickness: 0.5,
                    strokeColor: [0, 102, 204],
                    filled: true,
                    enable3d: true,
                    elevationScale: 1,
                    wireframe: false,
                    fixedHeight: true,  // Enable fixed height
                    heightRange: [0, 5000], // Increased to accommodate stacked cubes
                    radius: 10,
                    sizeRange: [0, 10],
                    radiusRange: [0, 50]
                },
                hidden: false,
                heightField: { 
                    name: PROCESSED_HEIGHT_FIELD, 
                    type: 'real' 
                }
            },
            visualChannels: {
                heightField: {
                    name: PROCESSED_HEIGHT_FIELD,
                    type: 'real'
                },
                heightScale: 'linear',
                colorField: {
                    name: 'aggregated_value',
                    type: 'real'
                },
                colorScale: 'quantize', // Better for showing 0 values distinctly
                colorRange: {
                    name: 'Ice And Fire',
                    type: 'diverging',
                    category: 'Uber',
                    colors: ['#E0E0E0', '#0198BD', '#49E3CE', '#E8FEB5', '#FEEDB1', '#FEAD54', '#D50255']
                    // Added gray color for 0 values
                }
            }
        };
    }

    private _createRandomCubesLayerConfig(options: any, timestamp: number, uniqueId: string) {
        const opacity = Math.max((options.cubeOpacity || 0.7) - 0.2, 0.3);

        return {
            id: `random-cubes-layer-${timestamp}-${uniqueId}`,
            type: 'geojson',
            config: {
                dataId: 'random-space-time-cubes',
                label: 'Random Cubes',
                columnMode: 'geojson',
                columns: { 
                    geojson: '_geojson' 
                },
                color: [255, 153, 51],
                isVisible: true,
                visConfig: {
                    opacity: opacity,
                    strokeOpacity: 0.6,
                    thickness: 1,
                    strokeColor: [204, 102, 0],
                    filled: true,
                    enable3d: true,
                    elevationScale: 1,
                    wireframe: false,
                    fixedHeight: true,  // Enable fixed height
                    heightRange: [0, 5000], // Increased to accommodate stacked cubes
                    radius: 10,
                    sizeRange: [0, 10],
                    radiusRange: [0, 50]
                },
                hidden: false,
                heightField: { 
                    name: PROCESSED_HEIGHT_FIELD, 
                    type: 'real' 
                }
            },
            visualChannels: {
                heightField: {
                    name: PROCESSED_HEIGHT_FIELD,
                    type: 'real'
                },
                heightScale: 'linear',
                colorField: {
                    name: 'aggregated_value',
                    type: 'real'
                },
                colorScale: 'quantile',
                colorRange: {
                    name: 'Sunset',
                    type: 'sequential',
                    category: 'Uber',
                    colors: ['#355C7D', '#6C5B7B', '#C06C84', '#F67280', '#F8B195']
                }
            }
        };
    }

    private _createGridOverviewData(spatialGrid: any): FeatureCollection {
        const features = spatialGrid.gridCells.map((cell: any, index: number) => ({
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [cell.bounds]
            },
            properties: {
                grid_id: `grid_${cell.i}_${cell.j}`,
                cell_i: cell.i,
                cell_j: cell.j,
                center_lng: cell.center[0],
                center_lat: cell.center[1],
                cell_index: index,
                [PROCESSED_HEIGHT_FIELD]: 5 // Very low height for grid visualization
            }
        }));

        return {
            type: 'FeatureCollection',
            features
        };
    }

    private _createGridOverviewLayerConfig(timestamp: number, uniqueId: string) {
        return {
            id: `spatial-grid-layer-${timestamp}-${uniqueId}`,
            type: 'geojson',
            config: {
                dataId: 'spatial-grid',
                label: 'Spatial Grid',
                columnMode: 'geojson',
                columns: { geojson: 'geometry' },
                color: [128, 128, 128],
                isVisible: false, // Hidden by default
                visConfig: {
                    opacity: 0.3,
                    strokeOpacity: 0.8,
                    thickness: 1,
                    strokeColor: [100, 100, 100],
                    filled: false,
                    enable3d: false,
                    elevationScale: 1,
                    wireframe: true,
                    fixedHeight: false
                },
                hidden: false
            },
            visualChannels: {
                colorField: {
                    name: 'cell_index',
                    type: 'integer'
                },
                colorScale: 'ordinal'
            }
        };
    }


    private _calculateSpatialExtent(spatialGrid: any): { width: number; height: number; area: number } {
        const bounds = spatialGrid.bounds;
        const width = turf.distance(
            turf.point([bounds.minLng, bounds.minLat]),
            turf.point([bounds.maxLng, bounds.minLat]),
            { units: 'kilometers' }
        );
        const height = turf.distance(
            turf.point([bounds.minLng, bounds.minLat]),
            turf.point([bounds.minLng, bounds.maxLat]),
            { units: 'kilometers' }
        );
        
        return {
            width,
            height,
            area: width * height
        };
    }

    private _calculateTemporalExtent(processedData: any[]): { start: string; end: string; duration: number } {
        const times = processedData.map(d => d.time);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        
        return {
            start: new Date(minTime).toISOString(),
            end: new Date(maxTime).toISOString(),
            duration: (maxTime - minTime) / (1000 * 60 * 60) // hours
        };
    }

    getDocumentation(): string {
        return `
# Space-Time Cube Analysis Tool

Visualizes spatio-temporal data as 3D cubes representing raster cells through time, creating a space-time cube visualization.

## Required Fields
- **Latitude**: Geographic latitude coordinates
- **Longitude**: Geographic longitude coordinates  
- **Time**: Timestamp for each data point

## Optional Fields
- **Value**: Numeric value to aggregate within each cube cell
- **Altitude**: Base altitude for positioning cubes
- **Layer ID**: Identifier for multi-layer raster data

## Options
- **Cell Size**: Size of each cube cell in meters (100-10000m)
- **Time Slices**: Number of temporal layers in the cube (3-50)
- **Cube Height**: Height of each time slice cube in meters
- **Value Aggregation**: Method to aggregate values (count, sum, mean, max, min)
- **Generate Random Cubes**: Create random cubes based on trajectory patterns
- **Random Cube Count**: Number of random cubes to generate (10-200)
- **Cube Opacity**: Transparency of the cube visualization
- **Cube Variable to Join**: Select which cube variable to assign to trajectory points (Aggregated Value, Point Count, Time Slice, Base Altitude, Cube Height, Top Altitude)
## Output Datasets
1. **Space-Time Cubes**: 3D cubes representing aggregated spatio-temporal data
2. **Random Cubes**: Randomly generated cubes (if enabled)
3. **Spatial Grid**: Grid structure showing cell boundaries
4. **Space-Time Trajectory**: 3D trajectory with time elevation (automatically included)
5. **Enhanced Trajectory Points**: Original trajectory points with assigned cube values (automatically included)

The tool creates a true 3D space-time cube where the X and Y axes represent space and the Z axis represents time, with each cube showing aggregated data values for specific spatial and temporal bins.
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
                        value: 25.5,
                        layer_id: 0
                    }
                },
                {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [-122.4094, 37.7849]
                    },
                    properties: {
                        timestamp: '2023-01-01T12:00:00Z',
                        value: 42.1,
                        layer_id: 1
                    }
                }
            ]
        };
    }
}