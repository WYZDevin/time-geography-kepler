/**
 * CSV Upload Dialog Component
 * Handles CSV file upload, field mapping, and preview
 */

import { useState, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../stores/store';
import { uploadData } from '../../stores/data-thunks';
import {
  parseCSV,
  detectCoordinateColumns,
  csvToGeoJSON,
  getCoordinateConfidence,
  previewCSVData,
  type CSVParseResult,
  type CoordinateMapping,
} from '../../services/csv-service';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import {
  FileText,
  Upload,
  CheckCircle,
  AlertCircle,
  MapPin,
  Eye,
  X,
  Loader2,
} from 'lucide-react';

interface CSVUploadDialogProps {
  onClose: () => void;
  onSuccess?: (dataSourceId: string) => void;
}

type UploadStep = 'select' | 'mapping' | 'preview' | 'uploading' | 'success' | 'error';

export const CSVUploadDialog: React.FC<CSVUploadDialogProps> = ({ onClose, onSuccess }) => {
  const dispatch = useDispatch<AppDispatch>();

  const [step, setStep] = useState<UploadStep>('select');
  const [_file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<CSVParseResult | null>(null);
  const [coordinateMapping, setCoordinateMapping] = useState<CoordinateMapping>({
    longitude: null,
    latitude: null,
    altitude: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState<string>('');

  // File selection handler
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setStep('uploading');

    try {
      // Parse CSV
      const result = await parseCSV(selectedFile);
      setParseResult(result);

      // Auto-detect coordinate columns
      const detected = detectCoordinateColumns(result.headers);
      setCoordinateMapping(detected);

      // Set default dataset name
      setDatasetName(selectedFile.name.replace(/\.csv$/i, ''));

      setStep('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file');
      setStep('error');
    }
  }, []);

  // Field mapping change
  const handleMappingChange = (field: keyof CoordinateMapping, value: string) => {
    setCoordinateMapping(prev => ({
      ...prev,
      [field]: value || null,
    }));
  };

  // Proceed to preview
  const handleProceedToPreview = () => {
    if (!coordinateMapping.longitude || !coordinateMapping.latitude) {
      setError('Please select both longitude and latitude columns');
      return;
    }
    setError(null);
    setStep('preview');
  };

  // Upload data
  const handleUpload = async () => {
    if (!parseResult || !coordinateMapping.longitude || !coordinateMapping.latitude) {
      setError('Invalid data or mapping');
      return;
    }

    setStep('uploading');
    setError(null);

    try {
      // Convert CSV to GeoJSON
      const { featureCollection, stats } = csvToGeoJSON(parseResult.data, {
        coordinateMapping,
        skipInvalidRows: true,
        includeAllProperties: true,
      });

      // Upload using Redux thunk
      const result = await dispatch(
        uploadData({
          name: datasetName || 'CSV Import',
          data: featureCollection,
        })
      ).unwrap();

      setStep('success');

      // Show stats
      if (stats.invalidRows > 0) {
        console.warn(`CSV Import: ${stats.invalidRows} invalid rows skipped`, stats.errors);
      }

      // Call success callback
      if (onSuccess) {
        setTimeout(() => onSuccess(result.id), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV data');
      setStep('error');
    }
  };

  // Get confidence badges
  const getConfidenceBadge = (score: number) => {
    if (score >= 0.9) return <Badge className="bg-green-500">High Confidence</Badge>;
    if (score >= 0.7) return <Badge className="bg-yellow-500">Medium Confidence</Badge>;
    return <Badge variant="outline">Low Confidence</Badge>;
  };

  const confidence = parseResult
    ? getCoordinateConfidence(parseResult.headers, coordinateMapping)
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-auto">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Import CSV File
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {/* Step 1: File Selection */}
          {step === 'select' && (
            <div className="space-y-4">
              <div className="text-center">
                <Upload className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-semibold mb-2">Select CSV File</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Upload a CSV file with latitude and longitude columns
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                  className="hidden"
                  id="csv-file-input"
                />
                <label htmlFor="csv-file-input">
                  <Button asChild>
                    <span>Choose File</span>
                  </Button>
                </label>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-2 text-sm">Supported Formats</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Decimal degrees (e.g., -122.4194, 37.7749)</li>
                  <li>• DMS format (e.g., 40°26'46"N, 79°58'56"W)</li>
                  <li>• Header row required</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 2: Field Mapping */}
          {step === 'mapping' && parseResult && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-4">Map Coordinate Columns</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Select which columns contain your coordinate data.
                  {parseResult.rowCount} rows detected.
                </p>
              </div>

              {/* Dataset Name */}
              <div>
                <label className="block text-sm font-medium mb-2">Dataset Name</label>
                <input
                  type="text"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter dataset name"
                />
              </div>

              {/* Longitude */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Longitude Column *
                  {coordinateMapping.longitude && confidence && (
                    <span className="ml-2">{getConfidenceBadge(confidence.longitude)}</span>
                  )}
                </label>
                <select
                  value={coordinateMapping.longitude || ''}
                  onChange={(e) => handleMappingChange('longitude', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select Column --</option>
                  {parseResult.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>

              {/* Latitude */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Latitude Column *
                  {coordinateMapping.latitude && confidence && (
                    <span className="ml-2">{getConfidenceBadge(confidence.latitude)}</span>
                  )}
                </label>
                <select
                  value={coordinateMapping.latitude || ''}
                  onChange={(e) => handleMappingChange('latitude', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select Column --</option>
                  {parseResult.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>

              {/* Altitude (optional) */}
              <div>
                <label className="block text-sm font-medium mb-2">Altitude Column (Optional)</label>
                <select
                  value={coordinateMapping.altitude || ''}
                  onChange={(e) => handleMappingChange('altitude', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- None --</option>
                  {parseResult.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-4 border-t">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={handleProceedToPreview} className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Preview Data
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && parseResult && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">Preview Data</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Review the first 5 rows before importing
                </p>
              </div>

              {/* Preview Table */}
              <div className="border rounded-md overflow-auto max-h-64">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {parseResult.headers.map((header) => (
                        <th
                          key={header}
                          className={`px-3 py-2 text-left font-semibold ${
                            header === coordinateMapping.longitude ||
                            header === coordinateMapping.latitude ||
                            header === coordinateMapping.altitude
                              ? 'bg-blue-50 text-blue-700'
                              : ''
                          }`}
                        >
                          {header}
                          {header === coordinateMapping.longitude && (
                            <MapPin className="w-3 h-3 inline ml-1" />
                          )}
                          {header === coordinateMapping.latitude && (
                            <MapPin className="w-3 h-3 inline ml-1" />
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewCSVData(parseResult.data).map((row, idx) => (
                      <tr key={idx} className="border-t">
                        {parseResult.headers.map((header) => (
                          <td key={header} className="px-3 py-2">
                            {row[header]?.toString() || ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <Button variant="outline" onClick={() => setStep('mapping')}>
                  Back
                </Button>
                <Button onClick={handleUpload} className="flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Import Data
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Uploading */}
          {step === 'uploading' && (
            <div className="text-center py-8">
              <Loader2 className="w-16 h-16 mx-auto mb-4 text-blue-500 animate-spin" />
              <h3 className="text-lg font-semibold mb-2">Processing...</h3>
              <p className="text-sm text-gray-600">Converting CSV to GeoJSON</p>
            </div>
          )}

          {/* Step 5: Success */}
          {step === 'success' && (
            <div className="text-center py-8">
              <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
              <h3 className="text-lg font-semibold mb-2">Import Successful!</h3>
              <p className="text-sm text-gray-600">Your CSV data has been imported</p>
            </div>
          )}

          {/* Step 6: Error */}
          {step === 'error' && (
            <div className="space-y-4">
              <div className="text-center py-8">
                <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
                <h3 className="text-lg font-semibold mb-2">Import Failed</h3>
                <p className="text-sm text-red-600">{error}</p>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                <Button onClick={() => setStep('select')}>Try Again</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
