import { AbstractBaseTool } from './base-tool';
import { AnalysisContext, AnalysisResult, DatasetResult, ProgressCallback, ToolOption } from '../interfaces/tool-interfaces';
import { FeatureCollection } from '../interfaces/data-interfaces';
import { preprocessGeojsonData } from '../data-processors/data-preprocessing';
import { createSTKDE } from '../data-processors/stkde';

export class STKDETool extends AbstractBaseTool {
    readonly id = 'stkde';
    readonly name = 'Space-Time Kernel Density Estimation';
    readonly description = 'Generate space-time kernel density estimation for trajectory analysis';
    readonly icon = '🌊';
    readonly category = 'analysis' as const;
    readonly version = '1.0.0';
    readonly author = 'GISPark Team';

    readonly requiredFields = ['latitude', 'longitude', 'time'];
    readonly optionalFields = ['weight'];

    readonly options: ToolOption[] = [
        {
            key: 'spatialBandwidth',
            label: 'Spatial Bandwidth (km)',
            type: 'number',
            defaultValue: 1.0,
            min: 0.1,
            max: 10.0,
            step: 0.1,
            description: 'Spatial bandwidth for kernel density estimation'
        },
        {
            key: 'temporalBandwidth',
            label: 'Temporal Bandwidth (hours)',
            type: 'number',
            defaultValue: 24,
            min: 1,
            max: 168,
            step: 1,
            description: 'Temporal bandwidth for kernel density estimation'
        },
        {
            key: 'cellSize',
            label: 'Cell Size (meters)',
            type: 'number',
            defaultValue: 100,
            min: 50,
            max: 1000,
            step: 50,
            description: 'Grid cell size for density calculation'
        },
        {
            key: 'timeSlices',
            label: 'Number of Time Slices',
            type: 'number',
            defaultValue: 24,
            min: 6,
            max: 48,
            step: 1,
            description: 'Number of time slices for 4D visualization'
        },
        {
            key: 'densityThreshold',
            label: 'Density Threshold',
            type: 'number',
            defaultValue: 0.1,
            min: 0.01,
            max: 1.0,
            step: 0.01,
            description: 'Minimum density threshold for visualization'
        },
        {
            key: 'visualizationMode',
            label: 'Visualization Mode',
            type: 'select',
            defaultValue: 'heatmap',
            options: [
                { label: 'Heatmap', value: 'heatmap' },
                { label: 'Contours', value: 'contours' },
                { label: '3D Surface', value: '3d-surface' },
                { label: 'Time Slices', value: 'time-slices' }
            ],
            description: 'Choose visualization style for density results'
        }
    ];

    async analyze(context: AnalysisContext, progressCallback?: ProgressCallback): Promise<AnalysisResult> {
        try {
            this.updateProgress(progressCallback, 10, 'Preprocessing trajectory data...');

            const { data, fieldMapping, options } = context;

            // Apply standard preprocessing pipeline
            this.updateProgress(progressCallback, 20, 'Validating input data...');
            const preprocessedData = preprocessGeojsonData(data);

            // Validate preprocessing results
            const validation = this._validatePreprocessedData(preprocessedData);
            if (!validation.valid) {
                return this.createErrorResult(`Preprocessing failed: ${validation.errors.join(', ')}`);
            }

            this.updateProgress(progressCallback, 40, 'Computing space-time kernel density...');

            // Compute STKDE
            const stkdeResults = await this._computeSTKDE(preprocessedData, fieldMapping, options, progressCallback);

            this.updateProgress(progressCallback, 80, 'Creating visualization datasets...');

            // Create datasets
            const datasets = await this._createVisualizationDatasets(
                stkdeResults,
                fieldMapping,
                options
            );

            this.updateProgress(progressCallback, 100, 'STKDE analysis complete');

            return this.createMultiDatasetResult(datasets, {
                totalTimeSlices: stkdeResults.length,
                gridResolution: `${options.cellSize || 100}m`,
                spatialBandwidth: `${options.spatialBandwidth || 1.0}km`,
                temporalBandwidth: `${options.temporalBandwidth || 24}h`,
                maxDensityValue: this._getMaxDensity(stkdeResults),
                densityRange: this._getDensityRange(stkdeResults)
            });

        } catch (error) {
            console.error('STKDE analysis error:', error);
            return this.createErrorResult(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _computeSTKDE(
        preprocessedData: FeatureCollection,
        fieldMapping: any,
        options: Record<string, any>,
        progressCallback?: ProgressCallback
    ): Promise<any[]> {
        const spatialBandwidth = options.spatialBandwidth || 1.0; // km
        const temporalBandwidth = options.temporalBandwidth || 24; // hours
        const cellSize = options.cellSize || 100; // meters
        const timeSlices = options.timeSlices || 24;

        try {
            // Call the STKDE computation function
            const stkdeResults = await createSTKDE(
                preprocessedData,
                fieldMapping.time,
                spatialBandwidth,
                temporalBandwidth,
                cellSize,
                timeSlices
            );

            // Update progress during computation
            if (progressCallback) {
                this.updateProgress(progressCallback, 70, 'Processing density results...');
            }

            return Array.isArray(stkdeResults) ? stkdeResults : [stkdeResults];

        } catch (error) {
            console.error('STKDE computation error:', error);
            throw new Error(`STKDE computation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _createVisualizationDatasets(
        stkdeResults: any[],
        fieldMapping: any,
        options: Record<string, any>
    ): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];
        const visualizationMode = options.visualizationMode || 'heatmap';
        const densityThreshold = options.densityThreshold || 0.1;

        // Filter results by density threshold
        const filteredResults = stkdeResults.filter(result => 
            this._getResultMaxDensity(result) >= densityThreshold
        );

        if (filteredResults.length === 0) {
            throw new Error('No density results above threshold. Try lowering the density threshold.');
        }

        switch (visualizationMode) {
            case 'heatmap':
                datasets.push(...await this._createHeatmapDatasets(filteredResults));
                break;
            
            case 'contours':
                datasets.push(...await this._createContourDatasets(filteredResults));
                break;
            
            case '3d-surface':
                datasets.push(...await this._create3DSurfaceDatasets(filteredResults));
                break;
            
            case 'time-slices':
                datasets.push(...await this._createTimeSliceDatasets(filteredResults));
                break;
            
            default:
                datasets.push(...await this._createHeatmapDatasets(filteredResults));
        }

        return datasets;
    }

    private async _createHeatmapDatasets(stkdeResults: any[]): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];

        for (let i = 0; i < stkdeResults.length; i++) {
            const result = stkdeResults[i];
            
            // Convert STKDE result to heatmap format
            const heatmapData = this._convertToHeatmapData(result, i);
            
            const heatmapConfig = this._createHeatmapLayerConfig(i);
            
            datasets.push(this.createDataset(
                `stkde-heatmap-${i}`,
                `STKDE Heatmap - Slice ${i + 1}`,
                heatmapData,
                {
                    description: `Space-time kernel density heatmap for time slice ${i + 1}`,
                    visualizationConfig: {
                        config: {
                            visState: {
                                layers: [heatmapConfig]
                            }
                        }
                    }
                }
            ));
        }

        return datasets;
    }

    private async _createContourDatasets(stkdeResults: any[]): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];

        for (let i = 0; i < stkdeResults.length; i++) {
            const result = stkdeResults[i];
            
            // Convert STKDE result to contour format
            const contourData = this._convertToContourData(result, i);
            
            if (contourData.features.length > 0) {
                const contourConfig = this._createContourLayerConfig(i);
                
                datasets.push(this.createDataset(
                    `stkde-contours-${i}`,
                    `STKDE Contours - Slice ${i + 1}`,
                    contourData,
                    {
                        description: `Space-time kernel density contours for time slice ${i + 1}`,
                        visualizationConfig: {
                            config: {
                                visState: {
                                    layers: [contourConfig]
                                }
                            }
                        }
                    }
                ));
            }
        }

        return datasets;
    }

    private async _create3DSurfaceDatasets(stkdeResults: any[]): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];

        for (let i = 0; i < stkdeResults.length; i++) {
            const result = stkdeResults[i];
            
            // Convert STKDE result to 3D surface format
            const surfaceData = this._convertTo3DSurfaceData(result, i);
            
            const surfaceConfig = this._create3DSurfaceLayerConfig(i);
            
            datasets.push(this.createDataset(
                `stkde-3d-surface-${i}`,
                `STKDE 3D Surface - Slice ${i + 1}`,
                surfaceData,
                {
                    description: `Space-time kernel density 3D surface for time slice ${i + 1}`,
                    visualizationConfig: {
                        config: {
                            visState: {
                                layers: [surfaceConfig]
                            }
                        }
                    }
                }
            ));
        }

        return datasets;
    }

    private async _createTimeSliceDatasets(stkdeResults: any[]): Promise<DatasetResult[]> {
        const datasets: DatasetResult[] = [];

        // Combine all time slices into one dataset with time information
        const combinedFeatures: any[] = [];

        for (let i = 0; i < stkdeResults.length; i++) {
            const result = stkdeResults[i];
            const sliceData = this._convertToHeatmapData(result, i);
            
            // Add time slice information to each feature
            sliceData.features.forEach((feature: any) => {
                feature.properties.time_slice = i;
                feature.properties.time_slice_label = `Slice ${i + 1}`;
                combinedFeatures.push(feature);
            });
        }

        const timeSlicesData: FeatureCollection = {
            type: 'FeatureCollection',
            features: combinedFeatures
        };

        const timeSlicesConfig = this._createTimeSlicesLayerConfig();
        
        datasets.push(this.createDataset(
            'stkde-time-slices',
            'STKDE Time Slices',
            timeSlicesData,
            {
                description: 'Space-time kernel density across all time slices',
                visualizationConfig: {
                    config: {
                        visState: {
                            layers: [timeSlicesConfig]
                        }
                    }
                }
            }
        ));

        return datasets;
    }

    private _convertToHeatmapData(stkdeResult: any, sliceIndex: number): FeatureCollection {
        const features: any[] = [];
        
        if (stkdeResult && stkdeResult.features) {
            // If result is already in GeoJSON format
            return stkdeResult;
        }

        // Convert grid-based result to point features
        if (stkdeResult.x_centers && stkdeResult.y_centers && stkdeResult.density) {
            const density = Array.isArray(stkdeResult.density) ? stkdeResult.density : [stkdeResult.density];
            const currentDensity = density[sliceIndex] || density[0];

            for (let i = 0; i < stkdeResult.x_centers.length; i++) {
                for (let j = 0; j < stkdeResult.y_centers.length; j++) {
                    const densityValue = Array.isArray(currentDensity) ? 
                        (Array.isArray(currentDensity[i]) ? currentDensity[i][j] : currentDensity[i]) :
                        currentDensity;

                    if (densityValue && densityValue > 0) {
                        features.push({
                            type: 'Feature',
                            geometry: {
                                type: 'Point',
                                coordinates: [stkdeResult.x_centers[i], stkdeResult.y_centers[j]]
                            },
                            properties: {
                                density: densityValue,
                                x_index: i,
                                y_index: j,
                                time_slice: sliceIndex
                            }
                        });
                    }
                }
            }
        }

        return {
            type: 'FeatureCollection',
            features
        };
    }

    private _convertToContourData(stkdeResult: any, sliceIndex: number): FeatureCollection {
        // Simplified contour generation - in practice, you'd use a contouring algorithm
        const heatmapData = this._convertToHeatmapData(stkdeResult, sliceIndex);
        
        // For now, create simple circular contours around high-density areas
        const features: any[] = [];
        const highDensityPoints = heatmapData.features.filter(
            (f: any) => f.properties.density > 0.5
        );

        highDensityPoints.forEach((point: any, index: number) => {
            const coords = point.geometry.coordinates;
            const density = point.properties.density;
            
            // Create a simple buffer as contour
            const radius = density * 0.001; // Adjust scale as needed
            
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [this._createCircleCoordinates(coords, radius)]
                },
                properties: {
                    contour_level: Math.round(density * 10) / 10,
                    density: density,
                    time_slice: sliceIndex
                }
            });
        });

        return {
            type: 'FeatureCollection',
            features
        };
    }

    private _convertTo3DSurfaceData(stkdeResult: any, sliceIndex: number): FeatureCollection {
        const heatmapData = this._convertToHeatmapData(stkdeResult, sliceIndex);
        
        // Add elevation based on density for 3D visualization
        const features = heatmapData.features.map((feature: any) => ({
            ...feature,
            properties: {
                ...feature.properties,
                elevation: feature.properties.density * 1000 // Scale for 3D visualization
            }
        }));

        return {
            type: 'FeatureCollection',
            features
        };
    }

    private _createCircleCoordinates(center: [number, number], radius: number): [number, number][] {
        const coordinates: [number, number][] = [];
        const steps = 16;
        
        for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * 2 * Math.PI;
            const x = center[0] + radius * Math.cos(angle);
            const y = center[1] + radius * Math.sin(angle);
            coordinates.push([x, y]);
        }
        
        return coordinates;
    }

    private _createHeatmapLayerConfig(sliceIndex: number) {
        return {
            id: `stkde-heatmap-layer-${sliceIndex}`,
            type: 'heatmap',
            config: {
                dataId: `stkde-heatmap-${sliceIndex}`,
                label: `STKDE Heatmap ${sliceIndex + 1}`,
                color: [255, 178, 102],
                isVisible: true,
                visConfig: {
                    opacity: 0.8,
                    colorRange: {
                        name: 'Global Warming',
                        type: 'sequential',
                        category: 'Uber',
                        colors: ['#5A1846', '#900C3F', '#C70039', '#E3611C', '#F1920E', '#FFC300']
                    },
                    radius: 50,
                    coverage: 1,
                    intensity: 1,
                    threshold: 0.05,
                    weightField: {
                        name: 'density',
                        type: 'real'
                    }
                }
            }
        };
    }

    private _createContourLayerConfig(sliceIndex: number) {
        return {
            id: `stkde-contour-layer-${sliceIndex}`,
            type: 'geojson',
            config: {
                dataId: `stkde-contours-${sliceIndex}`,
                label: `STKDE Contours ${sliceIndex + 1}`,
                color: [255, 178, 102],
                isVisible: true,
                visConfig: {
                    opacity: 0.6,
                    strokeOpacity: 0.8,
                    thickness: 2,
                    strokeColor: [255, 128, 0],
                    filled: true,
                    colorField: {
                        name: 'contour_level',
                        type: 'real'
                    },
                    colorRange: {
                        name: 'Uber Pool',
                        type: 'sequential',
                        category: 'Uber',
                        colors: ['#213E9F', '#2D5BA8', '#3F7BB2', '#52A0BD', '#66C5C8', '#7BEBD3']
                    }
                }
            }
        };
    }

    private _create3DSurfaceLayerConfig(sliceIndex: number) {
        return {
            id: `stkde-3d-surface-layer-${sliceIndex}`,
            type: 'point',
            config: {
                dataId: `stkde-3d-surface-${sliceIndex}`,
                label: `STKDE 3D Surface ${sliceIndex + 1}`,
                color: [255, 178, 102],
                isVisible: true,
                visConfig: {
                    opacity: 0.8,
                    radius: 20,
                    colorField: {
                        name: 'density',
                        type: 'real'
                    },
                    elevationField: {
                        name: 'elevation',
                        type: 'real'
                    },
                    elevationScale: 100,
                    enable3d: true,
                    colorRange: {
                        name: 'Global Warming',
                        type: 'sequential',
                        category: 'Uber',
                        colors: ['#5A1846', '#900C3F', '#C70039', '#E3611C', '#F1920E', '#FFC300']
                    }
                }
            }
        };
    }

    private _createTimeSlicesLayerConfig() {
        return {
            id: 'stkde-time-slices-layer',
            type: 'heatmap',
            config: {
                dataId: 'stkde-time-slices',
                label: 'STKDE Time Slices',
                color: [255, 178, 102],
                isVisible: true,
                visConfig: {
                    opacity: 0.8,
                    colorRange: {
                        name: 'ColorBrewer OrRd-6',
                        type: 'sequential',
                        category: 'ColorBrewer',
                        colors: ['#feedde', '#fdd0a2', '#fdae6b', '#fd8d3c', '#e6550d', '#a63603']
                    },
                    radius: 30,
                    coverage: 1,
                    intensity: 1,
                    threshold: 0.1,
                    weightField: {
                        name: 'density',
                        type: 'real'
                    }
                }
            }
        };
    }

    private _getMaxDensity(stkdeResults: any[]): number {
        let maxDensity = 0;
        
        for (const result of stkdeResults) {
            const resultMax = this._getResultMaxDensity(result);
            maxDensity = Math.max(maxDensity, resultMax);
        }
        
        return maxDensity;
    }

    private _getResultMaxDensity(result: any): number {
        if (result.features) {
            return Math.max(...result.features.map((f: any) => f.properties.density || 0));
        }
        
        if (result.density) {
            if (Array.isArray(result.density)) {
                return Math.max(...result.density.flat(2).filter((d: any) => typeof d === 'number'));
            }
            return result.density;
        }
        
        return 0;
    }

    private _getDensityRange(stkdeResults: any[]): string {
        const maxDensity = this._getMaxDensity(stkdeResults);
        return `0 to ${maxDensity.toFixed(4)}`;
    }

    private _validatePreprocessedData(data: FeatureCollection): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!data.features || data.features.length === 0) {
            errors.push('No features found in dataset');
        }
        
        if (data.features.length < 10) {
            errors.push('At least 10 points recommended for meaningful STKDE analysis');
        }
        
        return { valid: errors.length === 0, errors };
    }
}