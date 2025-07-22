import React, { useState, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { useDropzone } from 'react-dropzone';
import { useAppContext } from '../../../contexts/app-context';
import { setCurrentStep } from '../../../stores/workflow-slice';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { 
  Upload, 
  FileText, 
  Database, 
  CheckCircle, 
  AlertCircle,
  Loader2,
  Plus,
  Download
} from 'lucide-react';
import { FeatureCollection } from '../../../interfaces/data-interfaces';

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  message?: string;
  dataSourceId?: string;
}

const ModernDataUploadStep: React.FC = () => {
  const dispatch = useDispatch();
  const { dataService, isInitialized } = useAppContext();
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });

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
      } else if (file.name.endsWith('.csv')) {
        // For CSV, we'd need a CSV to GeoJSON converter
        throw new Error('CSV parsing not yet implemented');
      } else {
        throw new Error('Unsupported file format');
      }

      // Validate GeoJSON structure
      if (!data.type || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        throw new Error('Invalid GeoJSON format');
      }

      // Upload to data service
      const dataSourceId = await dataService.uploadDataSource(
        file.name.replace(/\.[^/.]+$/, ''), // Remove extension
        data,
        undefined, // Field mapping will be set later
        ['uploaded', 'user-data']
      );

      setUploadState({ 
        status: 'success', 
        message: `Successfully uploaded ${data.features.length} features`,
        dataSourceId 
      });

      // Auto-proceed to field mapping after a short delay
      setTimeout(() => {
        dispatch(setCurrentStep('field-mapping'));
      }, 1500);

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
      'text/csv': ['.csv'],
    },
    multiple: false,
  });

  const handleGenerateSample = async () => {
    if (!dataService || !isInitialized) return;

    setUploadState({ status: 'uploading', message: 'Generating sample data...' });

    try {
      const dataSourceId = await dataService.generateSyntheticData(
        'trajectory', 
        100, 
        'Sample Trajectory Data'
      );

      setUploadState({ 
        status: 'success', 
        message: 'Sample data generated successfully',
        dataSourceId 
      });

      setTimeout(() => {
        dispatch(setCurrentStep('field-mapping'));
      }, 1500);

    } catch (error) {
      console.error('Sample data generation error:', error);
      setUploadState({ 
        status: 'error', 
        message: 'Failed to generate sample data' 
      });
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
      <div className="p-6 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
        <p>Initializing data services...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Upload Your Data</h2>
        <p className="text-gray-600">
          Upload trajectory data in GeoJSON format or generate sample data to get started
        </p>
      </div>

      {/* Main Upload Area */}
      <Card className={`transition-all duration-200 ${getStatusColor()}`}>
        <div
          {...getRootProps()}
          className={`cursor-pointer p-8 text-center transition-all duration-200 ${
            isDragActive ? 'scale-105' : ''
          }`}
        >
          <input {...getInputProps()} />
          
          <div className="flex flex-col items-center space-y-4">
            {getStatusIcon()}
            
            <div>
              <h3 className="text-lg font-semibold mb-2">
                {isDragActive ? 'Drop your file here' : 'Drag & drop your data file'}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Supports GeoJSON (.json, .geojson) and CSV files
              </p>
              
              {uploadState.message && (
                <div className={`text-sm font-medium ${
                  uploadState.status === 'error' ? 'text-red-600' : 
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
      </Card>

      {/* Alternative Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="w-5 h-5" />
              Sample Data
            </CardTitle>
            <CardDescription>
              Generate synthetic trajectory data for testing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={handleGenerateSample}
              disabled={uploadState.status === 'uploading'}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Generate Sample Data
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Download className="w-5 h-5" />
              Example Files
            </CardTitle>
            <CardDescription>
              Download example data files to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full">
              <Download className="w-4 h-4 mr-2" />
              Download Examples
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Supported Formats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Supported Data Formats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-blue-600" />
              <div>
                <div className="font-medium">GeoJSON</div>
                <div className="text-sm text-gray-600">.json, .geojson files</div>
              </div>
              <Badge variant="secondary">Recommended</Badge>
            </div>
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-green-600" />
              <div>
                <div className="font-medium">CSV</div>
                <div className="text-sm text-gray-600">With lat/lng columns</div>
              </div>
              <Badge variant="outline">Coming Soon</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Requirements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Data Requirements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span>Geographic coordinates (latitude, longitude)</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span>Timestamp information for trajectory analysis</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-gray-400" />
              <span>Altitude information (optional)</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-gray-400" />
              <span>Additional attributes (optional)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ModernDataUploadStep;