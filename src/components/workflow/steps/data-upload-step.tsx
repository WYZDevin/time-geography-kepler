import React, { useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../../stores/store';
import { setCurrentStep, setUploadedData } from '../../../stores/workflow-slice';
import { setActiveDataSource } from '../../../stores/data-slice';
import { useAppContext } from '../../../contexts/app-context';
import { FeatureCollection } from '../../../interfaces/data-interfaces';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import {
    Upload,
    Database,
    CheckCircle,
    AlertCircle,
    Loader2,
    Plus,
    ArrowRight,
    FileText,
    Calendar,
    MapPin
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';

interface UploadState {
    status: 'idle' | 'uploading' | 'success' | 'error';
    message?: string;
    dataSourceId?: string;
}

const DataUploadStep = () => {
    const dispatch = useDispatch();
    const { dataService, isInitialized } = useAppContext();
    const { selectedTool } = useSelector((state: RootState) => state.workflow);
    const dataSources = useSelector((state: RootState) => Object.values(state.data.dataSources));
    const activeDataSource = useSelector((state: RootState) =>
        state.data.activeDataSourceId ? state.data.dataSources[state.data.activeDataSourceId] : null
    );

    const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });
    const [selectedDataSourceId, setSelectedDataSourceId] = useState<string | null>(
        activeDataSource?.id || null
    );

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (!dataService || !isInitialized) {
            setUploadState({
                status: 'error',
                message: 'Data service not initialized'
            });
            return;
        }

        const file = acceptedFiles[0];
        if (!file) return;

        setUploadState({ status: 'uploading', message: 'Processing file...' });

        try {
            // Read file content
            const text = await file.text();
            let data: FeatureCollection;

            // Parse based on file type
            if (file.name.endsWith('.json') || file.name.endsWith('.geojson')) {
                data = JSON.parse(text);
            } else {
                throw new Error('Unsupported file format. Please use GeoJSON (.json or .geojson) files.');
            }

            // Validate GeoJSON structure
            if (!data.type || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
                throw new Error('Invalid GeoJSON format. Please ensure your file is a valid FeatureCollection.');
            }

            if (data.features.length === 0) {
                throw new Error('The uploaded file contains no features.');
            }

            // Upload to data service
            const dataSourceId = await dataService.uploadDataSource(
                file.name.replace(/\.[^/.]+$/, ''), // Remove extension
                data,
                undefined, // Field mapping will be set later
                ['uploaded', 'user-data']
            );

            // Set as active data source
            dispatch(setActiveDataSource(dataSourceId));
            setSelectedDataSourceId(dataSourceId);

            // Also set in workflow slice for field mapping
            dispatch(setUploadedData(data));

            setUploadState({
                status: 'success',
                message: `Successfully uploaded ${data.features.length} features`,
                dataSourceId
            });

        } catch (error) {
            console.error('Upload error:', error);
            setUploadState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Upload failed'
            });
        }
    }, [dataService, isInitialized, dispatch]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/json': ['.json', '.geojson'],
        },
        multiple: false,
    });

    const handleGenerateSample = async () => {
        if (!dataService || !isInitialized) return;

        setUploadState({ status: 'uploading', message: 'Generating sample data...' });

        try {
            // Create synthetic data manually to ensure we have access to it
            const syntheticData: FeatureCollection = {
                type: 'FeatureCollection',
                features: []
            };

            const baseTime = new Date('2024-01-01T00:00:00Z').getTime();
            const bounds = {
                minLat: 37.7049,
                maxLat: 37.8049,
                minLng: -122.5149,
                maxLng: -122.3849,
            };

            for (let i = 0; i < 100; i++) {
                const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
                const lng = bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng);
                const time = new Date(baseTime + i * 60000).toISOString();

                syntheticData.features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat, Math.random() * 100],
                    },
                    properties: {
                        id: i,
                        timestamp: time,
                        user_id: `user_${Math.floor(i / 10)}`,
                        activity: ['walking', 'driving', 'stationary'][Math.floor(Math.random() * 3)],
                        speed: Math.random() * 50,
                    },
                });
            }

            // Upload to data service
            const dataSourceId = await dataService.uploadDataSource(
                'Sample Trajectory Data',
                syntheticData,
                undefined,
                ['synthetic', 'trajectory']
            );

            dispatch(setActiveDataSource(dataSourceId));
            setSelectedDataSourceId(dataSourceId);

            // Set in workflow slice for field mapping
            dispatch(setUploadedData(syntheticData));

            setUploadState({
                status: 'success',
                message: 'Sample data generated successfully',
                dataSourceId
            });

        } catch (error) {
            console.error('Sample data generation error:', error);
            setUploadState({
                status: 'error',
                message: 'Failed to generate sample data'
            });
        }
    };

    const handleSelectDataSource = (dataSourceId: string) => {
        setSelectedDataSourceId(dataSourceId);
        dispatch(setActiveDataSource(dataSourceId));

        // Find the selected data source and set it in workflow slice for field mapping
        const selectedDataSource = dataSources.find(ds => ds.id === dataSourceId);
        if (selectedDataSource) {
            dispatch(setUploadedData(selectedDataSource.data));
        }
    };

    const handleProceedToNext = () => {
        if (selectedDataSourceId) {
            // Ensure the selected data is set in workflow slice before proceeding
            const selectedDataSource = dataSources.find(ds => ds.id === selectedDataSourceId);
            if (selectedDataSource) {
                dispatch(setUploadedData(selectedDataSource.data));
            }
            dispatch(setCurrentStep('field-mapping'));
        }
    };

    const getStatusIcon = () => {
        switch (uploadState.status) {
            case 'uploading':
                return <Loader2 className="w-5 h-5 animate-spin" />;
            case 'success':
                return <CheckCircle className="w-5 h-5 text-green-600" />;
            case 'error':
                return <AlertCircle className="w-5 h-5 text-red-600" />;
            default:
                return <Upload className="w-5 h-5" />;
        }
    };

    const getStatusColor = () => {
        switch (uploadState.status) {
            case 'uploading':
                return 'border-blue-300 bg-blue-50';
            case 'success':
                return 'border-green-300 bg-green-50';
            case 'error':
                return 'border-red-300 bg-red-50';
            default:
                return 'border-gray-300 hover:border-gray-400';
        }
    };

    if (!isInitialized) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-6">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p>Initializing data services...</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col p-4 overflow-auto space-y-4">
            {/* Header */}
            <div>
                <h1 className="text-lg font-bold text-gray-800 mb-1">Upload or Select Data</h1>
                <p className="text-sm text-gray-600">
                    Upload new data or select from existing data sources
                    {selectedTool && (
                        <span> for <strong>{selectedTool.name}</strong></span>
                    )}
                </p>
            </div>

            {/* Tool Requirements */}
            {selectedTool && (
                <Card className="bg-blue-50 border-blue-200">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-blue-800">Data Requirements</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="space-y-2">
                            <div>
                                <h4 className="font-medium text-blue-700 mb-1 text-xs">Required Fields</h4>
                                <div className="flex flex-wrap gap-1">
                                    {selectedTool.requiredFields.map(field => (
                                        <Badge key={field} className="bg-blue-100 text-blue-800 text-xs">
                                            {field}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                            {selectedTool.optionalFields && selectedTool.optionalFields.length > 0 && (
                                <div>
                                    <h4 className="font-medium text-blue-700 mb-1 text-xs">Optional Fields</h4>
                                    <div className="flex flex-wrap gap-1">
                                        {selectedTool.optionalFields.map(field => (
                                            <Badge key={field} variant="outline" className="text-xs">
                                                {field}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Existing Data Sources */}
            {dataSources.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Database className="w-4 h-4" />
                            Existing Data Sources
                        </CardTitle>
                        <CardDescription>
                            Select from previously uploaded data sources
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                            {dataSources.map((dataSource) => (
                                <div
                                    key={dataSource.id}
                                    className={`p-3 border rounded-lg cursor-pointer transition-all ${selectedDataSourceId === dataSource.id
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                    onClick={() => handleSelectDataSource(dataSource.id)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-medium text-sm truncate">{dataSource.name}</h4>
                                                <Badge variant="outline" className="text-xs">
                                                    {dataSource.type}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                                                <span className="flex items-center gap-1">
                                                    <FileText className="w-3 h-3" />
                                                    {dataSource.data.features.length} features
                                                </span>
                                                {dataSource.metadata.uploadedAt && (
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" />
                                                        {new Date(dataSource.metadata.uploadedAt).toLocaleDateString()}
                                                    </span>
                                                )}
                                                {dataSource.metadata.statistics?.spatialBounds && (
                                                    <span className="flex items-center gap-1">
                                                        <MapPin className="w-3 h-3" />
                                                        Spatial data
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {selectedDataSourceId === dataSource.id && (
                                            <CheckCircle className="w-4 h-4 text-blue-600" />
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Upload New Data */}
            <Card className={`transition-all duration-200 ${getStatusColor()}`}>
                <CardHeader>
                    <CardTitle className="text-base">Upload New Data</CardTitle>
                    <CardDescription>
                        Upload GeoJSON files with trajectory or point data
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div
                        {...getRootProps()}
                        className={`cursor-pointer p-6 border-2 border-dashed rounded-lg text-center transition-all duration-200 ${isDragActive ? 'border-blue-400 bg-blue-50 scale-105' : 'border-gray-300 hover:border-gray-400'
                            }`}
                    >
                        <input {...getInputProps()} />

                        <div className="flex flex-col items-center space-y-3">
                            {getStatusIcon()}

                            <div>
                                <h3 className="font-medium mb-1">
                                    {isDragActive ? 'Drop your file here' : 'Drag & drop your data file'}
                                </h3>
                                <p className="text-sm text-gray-600 mb-2">
                                    Supports GeoJSON (.json, .geojson) files
                                </p>

                                {uploadState.message && (
                                    <div className={`text-sm font-medium ${uploadState.status === 'error' ? 'text-red-600' :
                                        uploadState.status === 'success' ? 'text-green-600' :
                                            'text-blue-600'
                                        }`}>
                                        {uploadState.message}
                                    </div>
                                )}
                            </div>

                            {uploadState.status === 'idle' && (
                                <Button variant="outline" disabled={isDragActive}>
                                    <Upload className="w-4 h-4 mr-2" />
                                    Choose File
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Generate Sample Data */}
                    <div className="mt-4 pt-4 border-t">
                        <Button
                            onClick={handleGenerateSample}
                            disabled={uploadState.status === 'uploading'}
                            variant="outline"
                            className="w-full"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Generate Sample Data
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Next Step Button */}
            {selectedDataSourceId && (
                <div className="flex justify-end pt-4 border-t">
                    <Button onClick={handleProceedToNext}>
                        Continue to Field Mapping
                        <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                </div>
            )}
        </div>
    );
};

export default DataUploadStep; 