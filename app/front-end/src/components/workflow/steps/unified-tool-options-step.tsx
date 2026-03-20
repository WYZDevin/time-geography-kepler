import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../../stores/store';
import { setToolOptions, setSelectedDataSource, setFieldMapping, setExecutionMode, proceedToVisualization } from '../../../stores/workflow-slice';
import { selectAllDataSources, DataSource } from '../../../stores/data-slice';
import { useResolvedCapabilities } from '@/services/execution-resolver';
import { ExecutionMode } from '@/interfaces/simple-tool';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../ui/dialog';
import { DatasetSelector } from '../../dataset-selector';
import { FeatureCollection } from '../../../interfaces/data-interfaces';
import { AttributeMapping } from '../../../interfaces/attribute-mapping';
import { extractFieldNames } from '../../../utils/data-utils';
import { autoDetectFields } from '../../../utils/field-auto-detection';
import { toolRegistry } from '../../../utils/tool-registry';
import {
    Settings,
    ArrowRight,
    FileText,
    Database,
    ChevronRight,
    Check,
    Monitor,
    Server,
    AlertTriangle,
} from 'lucide-react';

const UnifiedToolOptionsStep = () => {
    const dispatch = useDispatch();
    const { selectedToolId, selectedDataSourceId } = useSelector((state: RootState) => state.workflow);
    const selectedTool = selectedToolId ? toolRegistry.getTool(selectedToolId) : null;
    const dataSources = useSelector(selectAllDataSources);
    const selectedDataSource = useSelector((state: RootState) =>
        selectedDataSourceId ? state.data.dataSources[selectedDataSourceId] : null
    );

    const caps = useResolvedCapabilities(selectedToolId);
    const executionMode = useSelector((state: RootState) => state.workflow.executionMode);

    const [dataSourceDialogOpen, setDataSourceDialogOpen] = useState(false);

    const [options, setOptions] = useState<Record<string, boolean | string | number | FeatureCollection | null>>({});
    const [mapping, setMapping] = useState<AttributeMapping>({
        time: '',
        value: '',
        category: '',
        id: ''
    });

    // Initialize options when tool changes
    useEffect(() => {
        if (selectedToolId) {
            const toolInstance = toolRegistry.getTool(selectedToolId);
            const schema = toolInstance?.getOptionSchema() || [];

            // Initialize options with default values
            const defaultOptions: Record<string, boolean | string | number | FeatureCollection | null> = {};
            schema.forEach(opt => {
                // Type assertion to handle the union type properly
                const defaultValue = opt.defaultValue as boolean | string | number | FeatureCollection | null | undefined;
                defaultOptions[opt.key] = defaultValue ?? null;
            });
            setOptions(defaultOptions);
        }
    }, [selectedToolId]); // Only re-run when tool ID changes

    // Extract fields and auto-detect mapping when data source ID changes (not the data object itself)
    useEffect(() => {
        if (selectedDataSourceId && selectedDataSource) {
            try {
                // Extract field names from data
                const fieldNames = selectedDataSource.data ? extractFieldNames(selectedDataSource.data) : [];

                // Auto-detect field mapping
                if (fieldNames.length > 0) {
                    const detectedMapping = autoDetectFields(fieldNames);

                    if (detectedMapping) {
                        const newMapping = {
                            time: detectedMapping.time || '',
                            value: '',
                            category: '',
                            id: ''
                        };
                        setMapping(newMapping);
                        // Update Redux store once
                        dispatch(setFieldMapping(newMapping));
                    }
                }
            } catch (error) {
                console.error('Error extracting field names:', error);
            }
        }
    }, [selectedDataSourceId]); // Only depend on ID, not the data object


    const handleOptionChange = (key: string, value: boolean | string | number | FeatureCollection | null) => {
        setOptions(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const handleFieldMappingChange = (fieldType: keyof AttributeMapping, value: string) => {
        const newMapping = {
            ...mapping,
            [fieldType]: value
        };
        setMapping(newMapping);
        dispatch(setFieldMapping(newMapping));
    };

    const handleSelectDataSource = (ds: DataSource) => {
        dispatch(setSelectedDataSource({
            dataSourceId: ds.id,
            data: ds.data
        }));
        setDataSourceDialogOpen(false);
    };

    const handleSubmit = () => {
        if (!selectedDataSourceId) {
            alert('Please select a data source');
            return;
        }

        if (caps.isDisabled) {
            alert('This tool requires the backend server, which is currently offline.');
            return;
        }

        // For backend_only tools, ensure mode is set to backend
        if (caps.effectivePolicy === 'backend_only') {
            dispatch(setExecutionMode('backend'));
        }

        dispatch(setToolOptions(options));
        dispatch(proceedToVisualization());
    };

    const renderOptionInput = (option: any) => { // Generic since ToolOption is not available
        const value = options[option.key] ?? option.defaultValue;

        switch (option.type) {
            case 'boolean':
                return (
                    <div key={option.key} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                {option.label}
                            </label>
                            {option.description && (
                                <p className="text-xs text-gray-500 mt-1">{option.description}</p>
                            )}
                        </div>
                        <input
                            type="checkbox"
                            checked={value || false}
                            onChange={(e) => handleOptionChange(option.key, e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                        />
                    </div>
                );

            case 'number': {
                const numOption = option as any;
                return (
                    <div key={option.key} className="p-3 border rounded-lg">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {option.label}
                        </label>
                        {option.description && (
                            <p className="text-xs text-gray-500 mb-2">{option.description}</p>
                        )}
                        <input
                            type="number"
                            value={value || numOption.defaultValue || 0}
                            onChange={(e) => {
                                const newValue = parseFloat(e.target.value);
                                handleOptionChange(option.key, isNaN(newValue) ? 0 : newValue);
                            }}
                            className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            min={numOption.min}
                            max={numOption.max}
                            step={numOption.step || 1}
                        />
                    </div>
                );
            }

            case 'string':
                return (
                    <div key={option.key} className="p-3 border rounded-lg">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {option.label}
                        </label>
                        {option.description && (
                            <p className="text-xs text-gray-500 mb-2">{option.description}</p>
                        )}
                        <input
                            type="text"
                            value={value || option.defaultValue || ''}
                            onChange={(e) => handleOptionChange(option.key, e.target.value)}
                            className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                );

            case 'select': {
                const selectOption = option as any;
                return (
                    <div key={option.key} className="p-3 border rounded-lg">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {option.label}
                        </label>
                        {option.description && (
                            <p className="text-xs text-gray-500 mb-2">{option.description}</p>
                        )}
                        <select
                            value={value || selectOption.defaultValue || ''}
                            onChange={(e) => handleOptionChange(option.key, e.target.value)}
                            className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            {selectOption.options?.map((opt: any) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                );
            }

            case 'dataset': {
                const datasetOption = option as any;
                return (
                    <div key={option.key} className="p-3 border rounded-lg">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {option.label}
                        </label>
                        {option.description && (
                            <p className="text-xs text-gray-500 mb-2">{option.description}</p>
                        )}
                        <DatasetSelector
                            value={typeof value === 'string' ? value : ''}
                            onChange={(datasetId) => handleOptionChange(option.key, datasetId)}
                            placeholder={`Select ${option.label.toLowerCase()}...`}
                            required={datasetOption.required || false}
                        />
                    </div>
                );
            }

            case 'primary_dataset': {
                const primaryDatasetOption = option as any;
                const selectedDataset = dataSources.find(ds => ds.id === value);
                
                return (
                    <div key={option.key} className="space-y-3">
                        <div className="p-3 border rounded-lg bg-blue-50 border-blue-200">
                            <label className="block text-sm font-medium text-blue-800 mb-2">
                                {option.label}
                                {primaryDatasetOption.required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            {option.description && (
                                <p className="text-xs text-blue-700 mb-2">{option.description}</p>
                            )}
                            <DatasetSelector
                                value={typeof value === 'string' ? value : ''}
                                onChange={(datasetId) => {
                                    handleOptionChange(option.key, datasetId);
                                    // Also update the main selected data source
                                    const dataSource = dataSources.find(ds => ds.id === datasetId);
                                    if (dataSource) {
                                        dispatch(setSelectedDataSource({
                                            dataSourceId: datasetId,
                                            data: dataSource.data
                                        }));
                                    }
                                }}
                                placeholder="Select primary data source..."
                                required={primaryDatasetOption.required || false}
                                className="text-sm"
                            />
                            
                            {selectedDataset && (
                                <div className="mt-2 text-xs text-blue-700 flex items-center gap-4">
                                    <span className="flex items-center gap-1">
                                        <FileText className="w-3 h-3" />
                                        {selectedDataset.data.features.length} features
                                    </span>
                                </div>
                            )}
                        </div>
                        
                        {/* Inline field mapping for primary dataset */}
                        {primaryDatasetOption.enableFieldMapping !== false && 
                         selectedDataset && 
                         selectedDataSource && ( // Show attribute mapping if data available
                            <div className="pl-6 border-l-2 border-blue-200">
                                {renderFieldMappingForDataset(selectedDataset.data)}
                            </div>
                        )}
                    </div>
                );
            }

            default:
                return null;
        }
    };

    const renderFieldMappingForDataset = (data: FeatureCollection) => {
        const fieldNames = extractFieldNames(data);
        // SimpleTool doesn't have requiredFields - spatial data comes from geometry
        const requiredFields: string[] = [];
        // SimpleTool doesn't have optionalFields - spatial data from GeoJSON geometry
        const optionalFields: string[] = [];

        return (
            <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700">Field Mapping</h4>
                
                {/* Required Fields */}
                {requiredFields.map(field => (
                    <div key={field} className="p-2 bg-white border rounded">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            {field} <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={mapping[field as keyof AttributeMapping] || ''}
                            onChange={(e) => handleFieldMappingChange(field as keyof AttributeMapping, e.target.value)}
                            className="w-full p-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            required
                        >
                            <option value="">Select field...</option>
                            {fieldNames.map(fieldName => (
                                <option key={fieldName} value={fieldName}>
                                    {fieldName}
                                </option>
                            ))}
                        </select>
                    </div>
                ))}

                {/* Optional Fields */}
                {optionalFields.length > 0 && optionalFields.map(field => (
                    <div key={field} className="p-2 bg-gray-50 border rounded">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                            {field} <span className="text-gray-400">(optional)</span>
                        </label>
                        <select
                            value={mapping[field as keyof AttributeMapping] || ''}
                            onChange={(e) => handleFieldMappingChange(field as keyof AttributeMapping, e.target.value)}
                            className="w-full p-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="">Select field...</option>
                            {fieldNames.map(fieldName => (
                                <option key={fieldName} value={fieldName}>
                                    {fieldName}
                                </option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>
        );
    };


    if (!selectedTool) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center">
                <Settings className="w-12 h-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Tool Selected</h3>
                <p className="text-gray-600">Please select a tool to configure its options.</p>
            </div>
        );
    }

    const toolInstance = toolRegistry.getTool(selectedTool.id);
    const toolOptions = toolInstance?.getOptionSchema() || [];

    return (
        <div className="h-full flex flex-col p-6 overflow-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedTool.icon}</span>
                <div>
                    <h1 className="text-xl font-bold text-gray-800">{selectedTool.name}</h1>
                    <p className="text-sm text-gray-600">{selectedTool.description}</p>
                </div>
            </div>

            {/* Data Source — compact inline display with dialog picker */}
            <button
                type="button"
                onClick={() => setDataSourceDialogOpen(true)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    selectedDataSource
                        ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                        : 'bg-gray-50 border-dashed border-gray-300 hover:bg-gray-100'
                }`}
            >
                <div className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center ${
                    selectedDataSource ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'
                }`}>
                    <Database className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                    {selectedDataSource ? (
                        <>
                            <p className="text-sm font-medium text-gray-900 truncate">
                                {dataSources.find(ds => ds.id === selectedDataSourceId)?.name || 'Dataset'}
                            </p>
                            <p className="text-xs text-blue-600">
                                {selectedDataSource.data.features.length} features
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-sm font-medium text-gray-600">No data source selected</p>
                            <p className="text-xs text-gray-400">Click to choose a dataset</p>
                        </>
                    )}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </button>

            {/* Data Source Selection Dialog */}
            <Dialog open={dataSourceDialogOpen} onOpenChange={setDataSourceDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Select Data Source</DialogTitle>
                        <DialogDescription>
                            Choose a dataset to analyze with {selectedTool.name}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
                        {dataSources.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                <Database className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                                <p className="text-sm font-medium">No datasets available</p>
                                <p className="text-xs mt-1">Upload data from the left panel first</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {dataSources.map((ds) => {
                                    const isSelected = ds.id === selectedDataSourceId;
                                    return (
                                        <button
                                            key={ds.id}
                                            type="button"
                                            onClick={() => handleSelectDataSource(ds)}
                                            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                                                isSelected
                                                    ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-300'
                                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                                            }`}
                                        >
                                            <div className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center ${
                                                isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                                            }`}>
                                                {isSelected ? <Check className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-medium truncate ${
                                                    isSelected ? 'text-blue-900' : 'text-gray-900'
                                                }`}>
                                                    {ds.name}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {ds.featureCount} features
                                                    {ds.createdBy && <span className="ml-2 text-gray-400">via {ds.createdBy}</span>}
                                                </p>
                                            </div>
                                            {isSelected && (
                                                <span className="text-xs font-medium text-blue-600 flex-shrink-0">Selected</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Execution Mode Selector */}
            {caps.effectivePolicy === 'hybrid' && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Server className="w-4 h-4" />
                            Execution Mode
                        </CardTitle>
                        <CardDescription>Choose where to run this analysis</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => dispatch(setExecutionMode('frontend'))}
                                className={`flex-1 flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                                    (executionMode ?? caps.defaultMode) === 'frontend'
                                        ? 'bg-blue-50 border-blue-300 text-blue-800 ring-1 ring-blue-300'
                                        : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                <Monitor className="w-4 h-4 flex-shrink-0" />
                                Browser
                            </button>
                            <button
                                type="button"
                                onClick={() => dispatch(setExecutionMode('backend'))}
                                className={`flex-1 flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                                    (executionMode ?? caps.defaultMode) === 'backend'
                                        ? 'bg-orange-50 border-orange-300 text-orange-800 ring-1 ring-orange-300'
                                        : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                <Server className="w-4 h-4 flex-shrink-0" />
                                Backend Server
                            </button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {caps.effectivePolicy === 'backend_only' && caps.canRunBackend && (
                <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
                    <Server className="w-4 h-4 flex-shrink-0" />
                    Runs on backend server
                </div>
            )}

            {caps.effectivePolicy === 'backend_only' && !caps.canRunBackend && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    Backend server required — currently offline
                </div>
            )}

            {/* Tool Options */}
            {toolOptions.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Settings className="w-4 h-4" />
                            Tool Options
                        </CardTitle>
                        <CardDescription>
                            Configure tool-specific parameters
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {toolOptions.map((option) => renderOptionInput(option))}
                    </CardContent>
                </Card>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end pt-4 border-t">
                <Button 
                    onClick={handleSubmit}
                    className="flex items-center gap-2"
                >
                    Run Analysis
                    <ArrowRight className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
};

export default UnifiedToolOptionsStep;