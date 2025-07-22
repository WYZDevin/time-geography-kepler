import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../../stores/store';
import { setFieldMapping } from '../../../stores/workflow-slice';
import { ColumnMapping } from '../../../interfaces/data-interfaces';
import { Button } from '@/components/ui/button';
import { extractFieldNames } from '../../../utils/data-utils';
import { autoDetectFields, getFieldConfidence, validateAutoDetection } from '../../../utils/field-auto-detection';

const FieldMappingStep = () => {
    const dispatch = useDispatch();
    const { selectedTool, uploadedData } = useSelector((state: RootState) => state.workflow);
    const [availableFields, setAvailableFields] = useState<string[]>([]);
    const [mapping, setMapping] = useState<ColumnMapping>({
        latitude: '',
        longitude: '',
        time: '',
        altitude: ''
    });
    const [autoDetectedFields, setAutoDetectedFields] = useState<Partial<ColumnMapping>>({});
    const [detectionWarnings, setDetectionWarnings] = useState<string[]>([]);

    useEffect(() => {
        if (uploadedData) {
            console.log('uploadedData', uploadedData);
            try {
                // Use our safe field extraction utility instead of processGeojson
                const fieldNames = extractFieldNames(uploadedData);
                setAvailableFields(fieldNames);
                console.log('Extracted field names:', fieldNames);

                // Auto-detect field mappings
                const detectedMapping = autoDetectFields(fieldNames);
                setAutoDetectedFields(detectedMapping);
                
                // Validate auto-detection
                const validation = validateAutoDetection(detectedMapping, fieldNames);
                setDetectionWarnings(validation.warnings);
                
                // Apply auto-detected mappings
                setMapping(prev => ({
                    latitude: detectedMapping.latitude || prev.latitude,
                    longitude: detectedMapping.longitude || prev.longitude,
                    time: detectedMapping.time || prev.time,
                    altitude: detectedMapping.altitude || prev.altitude
                }));

                console.log('Auto-detected fields:', detectedMapping);
                
            } catch (error) {
                console.error('Error extracting field names:', error);
                setAvailableFields([]);
            }
        }
    }, [uploadedData]);

    const handleFieldChange = (fieldType: keyof ColumnMapping, value: string) => {
        setMapping(prev => ({
            ...prev,
            [fieldType]: value
        }));
    };

    const handleSubmit = () => {
        dispatch(setFieldMapping(mapping));
    };

    const handleResetAutoDetection = () => {
        if (availableFields.length > 0) {
            const detectedMapping = autoDetectFields(availableFields);
            setAutoDetectedFields(detectedMapping);
            
            const validation = validateAutoDetection(detectedMapping, availableFields);
            setDetectionWarnings(validation.warnings);
            
            setMapping({
                latitude: detectedMapping.latitude || '',
                longitude: detectedMapping.longitude || '',
                time: detectedMapping.time || '',
                altitude: detectedMapping.altitude || ''
            });
        }
    };

    const isValid = () => {
        if (!selectedTool) return false;
        
        const requiredFields = selectedTool.requiredFields;
        return requiredFields.every(field => {
            switch (field) {
                case 'latitude':
                    return mapping.latitude !== '';
                case 'longitude':
                    return mapping.longitude !== '';
                case 'time':
                    return mapping.time !== '';
                case 'altitude':
                    return mapping.altitude !== '';
                default:
                    return true;
            }
        });
    };

    const renderFieldSelector = (fieldType: keyof ColumnMapping, label: string, required: boolean = false) => {
        const currentValue = mapping[fieldType] || '';
        const wasAutoDetected = autoDetectedFields[fieldType] === currentValue;
        const confidence = currentValue ? getFieldConfidence(currentValue, fieldType) : 0;
        
        return (
            <div className="mb-3">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                    {label} {required && <span className="text-red-500">*</span>}
                    {wasAutoDetected && (
                        <span className="ml-1 text-xs text-blue-600">
                            ✨ Auto-detected
                            {confidence >= 0.9 && <span className="text-green-600"> (High confidence)</span>}
                            {confidence >= 0.7 && confidence < 0.9 && <span className="text-yellow-600"> (Medium confidence)</span>}
                            {confidence < 0.7 && <span className="text-red-600"> (Low confidence)</span>}
                        </span>
                    )}
                </label>
                <select
                    value={currentValue}
                    onChange={(e) => handleFieldChange(fieldType, e.target.value)}
                    className={`w-full p-2 text-xs border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        wasAutoDetected 
                            ? confidence >= 0.9 
                                ? 'border-green-300 bg-green-50' 
                                : confidence >= 0.7
                                    ? 'border-yellow-300 bg-yellow-50'
                                    : 'border-red-300 bg-red-50'
                            : 'border-gray-300'
                    }`}
                    required={required}
                >
                    <option value="">Select field...</option>
                    {availableFields.map(field => (
                        <option key={field} value={field}>{field}</option>
                    ))}
                </select>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col p-4 overflow-auto">
            <div className="mb-4">
                <h1 className="text-lg font-bold text-gray-800 mb-1">Map Fields</h1>
                <p className="text-xs text-gray-600">
                    Map data fields for <strong>{selectedTool?.name}</strong>
                </p>
            </div>

            <div className="flex-1">
                {/* Auto-detection feedback */}
                {Object.keys(autoDetectedFields).length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                        <h4 className="text-xs font-semibold text-blue-800 mb-2">🔍 Auto-Detection Results</h4>
                        <div className="space-y-1">
                            {Object.entries(autoDetectedFields).map(([fieldType, detectedField]) => (
                                detectedField && (
                                    <div key={fieldType} className="text-xs text-blue-700">
                                        <span className="font-medium capitalize">{fieldType}:</span> {detectedField}
                                        <span className="ml-1 text-blue-600">
                                            ({Math.round(getFieldConfidence(detectedField, fieldType as keyof ColumnMapping) * 100)}% confidence)
                                        </span>
                                    </div>
                                )
                            ))}
                        </div>
                        {detectionWarnings.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-blue-200">
                                <div className="text-xs text-amber-700">
                                    <strong>⚠️ Warnings:</strong>
                                    <ul className="mt-1 list-disc list-inside space-y-1">
                                        {detectionWarnings.map((warning, index) => (
                                            <li key={index}>{warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                                                 )}
                         <div className="mt-2 pt-2 border-t border-blue-200">
                             <Button
                                 variant="outline"
                                 size="sm"
                                 onClick={handleResetAutoDetection}
                                 className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                             >
                                 🔄 Re-run Auto-Detection
                             </Button>
                         </div>
                     </div>
                 )}

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
                    <div className="space-y-4">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-800 mb-3">Required Fields</h3>
                            
                            {selectedTool?.requiredFields.includes('latitude') && 
                                renderFieldSelector('latitude', 'Latitude', true)}
                            
                            {selectedTool?.requiredFields.includes('longitude') && 
                                renderFieldSelector('longitude', 'Longitude', true)}
                            
                            {selectedTool?.requiredFields.includes('time') && 
                                renderFieldSelector('time', 'Time', true)}
                        </div>

                        {selectedTool?.optionalFields?.includes('altitude') && (
                            <div>
                                <h3 className="text-sm font-semibold text-gray-800 mb-3">Optional Fields</h3>
                                {renderFieldSelector('altitude', 'Altitude', false)}
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                    <div className="text-xs text-gray-600 mb-2">
                        <strong>Available fields:</strong>
                    </div>
                    <div className="text-xs text-gray-500">
                        {availableFields.length > 0 ? availableFields.join(', ') : 'None detected'}
                    </div>
                </div>
            </div>

            <div className="pt-3 border-t border-gray-200">
                <Button 
                    onClick={handleSubmit}
                    disabled={!isValid()}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-sm"
                >
                    Continue to Options
                </Button>
            </div>
        </div>
    );
};

export default FieldMappingStep; 