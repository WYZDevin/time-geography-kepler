import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../../stores/store';
import { Button } from '@/components/ui/button';
import { resetWorkflow, setCurrentStep } from '../../../stores/workflow-slice';
import { AnalysisRunner } from '../../../utils/analysis-runner';
import { AnalysisResult } from '../../../interfaces/tool-interfaces';

const VisualizationStep = () => {
    const dispatch = useDispatch();
    const { selectedTool, uploadedData, fieldMapping, toolOptions } = useSelector((state: RootState) => state.workflow);
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showErrorDetails, setShowErrorDetails] = useState(false);

    useEffect(() => {
        if (uploadedData && fieldMapping && selectedTool && toolOptions && !analysisResult) {
            runAnalysis();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploadedData, fieldMapping, selectedTool, toolOptions, analysisResult]);

    const runAnalysis = async () => {
        if (!uploadedData || !fieldMapping || !selectedTool) return;

        setIsAnalyzing(true);
        try {
            const context = {
                data: uploadedData,
                fieldMapping,
                options: toolOptions,
                toolId: selectedTool.id
            };

            const result = await AnalysisRunner.executeAnalysis(context, (progress, message) => {
                console.log(`Analysis progress: ${progress}% - ${message}`);
            });

            setAnalysisResult(result);
            console.log("Analysis result:", result);

            if (result.success && result.datasets) {
                // Add all datasets to Kepler.gl map
                const keplerActions = AnalysisRunner.createKeplerActions(result, selectedTool.name);
                keplerActions.forEach(action => {
                    if (action) {
                        dispatch(action);
                    }
                });
            }
        } catch (error) {
            console.error('Analysis execution error:', error);
            setAnalysisResult({
                success: false,
                error: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
            console.log("Error during analysis execution:", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleNewAnalysis = () => {
        dispatch(resetWorkflow());
    };

    return (
        <div className="h-full flex flex-col p-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                        <span className="text-2xl mr-3">{selectedTool?.icon}</span>
                        <div>
                            <h1 className="text-xl font-bold text-gray-800">
                                {selectedTool?.name} Analysis
                            </h1>
                            <p className="text-sm text-gray-600">
                                Visualization ready with your configured options
                            </p>
                        </div>
                    </div>
                    <Button 
                        onClick={handleNewAnalysis}
                        variant="outline"
                        className="border-blue-300 text-blue-700 hover:bg-blue-50"
                    >
                        New Analysis
                    </Button>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="bg-gray-50 p-3 rounded">
                        <div className="font-medium text-gray-700 mb-1">Analysis Status</div>
                        <div className="text-gray-600">
                            {isAnalyzing ? (
                                <span className="text-blue-600">🔄 Analyzing...</span>
                            ) : analysisResult?.success ? (
                                <span className="text-green-600">✅ Complete</span>
                            ) : analysisResult?.error ? (
                                <span className="text-red-600">❌ Failed</span>
                            ) : (
                                <span className="text-gray-500">⏳ Pending</span>
                            )}
                        </div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                        <div className="font-medium text-gray-700 mb-1">Processing Time</div>
                        <div className="text-gray-600">
                            {analysisResult?.metadata?.processingTime ? 
                                `${analysisResult.metadata.processingTime}ms` : 'N/A'}
                        </div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                        <div className="font-medium text-gray-700 mb-1">Visualization Templates</div>
                        <div className="text-gray-600">
                            {analysisResult?.metadata?.templatesUsed && analysisResult.metadata.templatesUsed.length > 0 ? (
                                <span className="text-green-600">🎨 {analysisResult.metadata.templatesUsed.length} template(s)</span>
                            ) : analysisResult?.datasets?.some(ds => ds.visualizationConfig || ds.layers) ? (
                                <span className="text-blue-600">🔧 Custom</span>
                            ) : (
                                <span className="text-gray-500">Default</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex-1">
                <h3 className="font-semibold text-gray-800 mb-4">Analysis Configuration</h3>
                
                {fieldMapping && (
                    <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">Field Mapping</h4>
                        <div className="space-y-2">
                            {Object.entries(fieldMapping).map(([key, value]) => (
                                value && (
                                    <div key={key} className="flex justify-between text-sm">
                                        <span className="text-gray-600 capitalize">{key}:</span>
                                        <span className="font-medium">{value}</span>
                                    </div>
                                )
                            ))}
                        </div>
                    </div>
                )}

                {toolOptions && Object.keys(toolOptions).length > 0 && (
                    <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">Tool Options</h4>
                        <div className="space-y-2">
                            {Object.entries(toolOptions).map(([key, value]) => (
                                <div key={key} className="flex justify-between text-sm">
                                    <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                                    <span className="font-medium">
                                        {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value.toString()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {analysisResult?.success && analysisResult.metadata?.templatesUsed && analysisResult.metadata.templatesUsed.length > 0 && (
                    <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">Visualization Details</h4>
                        <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border border-purple-200">
                            <div className="flex items-center mb-2">
                                <span className="text-lg mr-2">🎨</span>
                                <span className="font-medium text-purple-800">
                                    Using {analysisResult.metadata.templatesUsed.length} template(s): {analysisResult.metadata.templatesUsed.join(', ')}
                                </span>
                            </div>
                            <p className="text-purple-700 text-sm">
                                This analysis uses predefined visualization templates optimized for {selectedTool?.name} results.
                            </p>
                        </div>
                    </div>
                )}

                {analysisResult?.success && analysisResult.datasets && analysisResult.datasets.length > 1 && (
                    <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">Datasets Generated</h4>
                        <div className="space-y-2">
                            {analysisResult.datasets.map((dataset) => (
                                <div key={dataset.id} className="bg-gray-50 p-3 rounded border">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-medium text-gray-800">{dataset.name}</div>
                                            {dataset.description && (
                                                <div className="text-sm text-gray-600">{dataset.description}</div>
                                            )}
                                        </div>
                                        <div className="text-sm text-gray-500">
                                            {dataset.data.features.length} features
                                        </div>
                                    </div>
                                    {dataset.templateId && (
                                        <div className="mt-2 text-xs text-purple-600">
                                            Template: {dataset.templateId}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {analysisResult?.success && analysisResult.metadata && (
                    <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">Results Summary</h4>
                        <div className="space-y-2 text-sm">
                            {analysisResult.metadata.totalDatasets && (
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Datasets Generated:</span>
                                    <span className="font-medium">{analysisResult.metadata.totalDatasets}</span>
                                </div>
                            )}
                            {analysisResult.metadata.processedFeatures && (
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Features Processed:</span>
                                    <span className="font-medium">{analysisResult.metadata.processedFeatures}</span>
                                </div>
                            )}
                            {analysisResult.metadata.totalFeatures && (
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Total Features:</span>
                                    <span className="font-medium">{analysisResult.metadata.totalFeatures}</span>
                                </div>
                            )}
                            {analysisResult.metadata.stayPointsDetected !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Stay Points Detected:</span>
                                    <span className="font-medium">{analysisResult.metadata.stayPointsDetected}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Error Display Section */}
                {analysisResult?.error && !analysisResult.success && (
                    <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-start">
                            <div className="flex-shrink-0">
                                <span className="text-red-500 text-xl">❌</span>
                            </div>
                            <div className="ml-3 flex-1">
                                <h4 className="font-medium text-red-800 mb-2">Analysis Failed</h4>
                                <p className="text-red-700 text-sm mb-3">
                                    The analysis could not be completed due to the following error:
                                </p>
                                <div className="bg-red-100 border border-red-300 rounded p-3 mb-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-red-800 text-sm font-medium">Error Message:</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setShowErrorDetails(!showErrorDetails)}
                                            className="text-red-700 hover:bg-red-200 h-6 px-2 py-1"
                                        >
                                            {showErrorDetails ? '▼ Hide Details' : '▶ Show Details'}
                                        </Button>
                                    </div>
                                    <div className="text-red-800 text-xs mb-2">
                                        {analysisResult.error.split(':')[0] || 'Analysis Error'}
                                    </div>
                                    {showErrorDetails && (
                                        <div className="mt-2 pt-2 border-t border-red-200">
                                            <code className="text-red-800 text-xs font-mono break-all block bg-red-50 p-2 rounded">
                                                {analysisResult.error}
                                            </code>
                                        </div>
                                    )}
                                </div>
                                <div className="text-red-600 text-xs">
                                    <p className="font-medium mb-1">Troubleshooting steps:</p>
                                    <ul className="list-disc list-inside space-y-1">
                                        {analysisResult.error.toLowerCase().includes('field') && (
                                            <li className="text-red-700">🔹 <strong>Field issue detected:</strong> Check that your data contains the required fields ({selectedTool?.requiredFields.join(', ')})</li>
                                        )}
                                        {analysisResult.error.toLowerCase().includes('time') && (
                                            <li className="text-red-700">🔹 <strong>Time issue detected:</strong> Verify that time values are in a valid date/time format (e.g., ISO 8601)</li>
                                        )}
                                        {analysisResult.error.toLowerCase().includes('points') && (
                                            <li className="text-red-700">🔹 <strong>Data issue detected:</strong> Ensure your dataset has sufficient data points for analysis</li>
                                        )}
                                        {analysisResult.error.toLowerCase().includes('validation') && (
                                            <li className="text-red-700">🔹 <strong>Validation issue:</strong> Check the field mapping and tool options configuration</li>
                                        )}
                                        <li>📋 Review the field mapping configuration</li>
                                        <li>📊 Verify your data format matches the expected structure</li>
                                        <li>⚙️ Try different tool options or parameters</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 flex space-x-3">
                            <Button 
                                onClick={handleNewAnalysis}
                                size="sm"
                                variant="outline"
                                className="border-red-300 text-red-700 hover:bg-red-50"
                            >
                                Try New Analysis
                            </Button>
                            <Button 
                                onClick={() => {
                                    // Reset analysis result and go back to field mapping
                                    setAnalysisResult(null);
                                    dispatch(setCurrentStep('field-mapping'));
                                }}
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:bg-red-50"
                            >
                                Fix Field Mapping
                            </Button>
                        </div>
                    </div>
                )}

                {/* Success Display Section */}
                {analysisResult?.success && (
                    <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="font-medium text-blue-800 mb-2">Analysis Complete</h4>
                        <p className="text-blue-700 text-sm">
                            Your data has been processed and is now visible on the map. Use the map controls to explore your analysis results.
                            {analysisResult?.datasets?.some(ds => ds.visualizationConfig || ds.templateId) && ' The visualization uses optimized templates for enhanced display.'}
                        </p>
                    </div>
                )}

                {/* Loading Display Section */}
                {isAnalyzing && (
                    <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="flex items-center">
                            <div className="flex-shrink-0">
                                <div className="animate-spin w-5 h-5 border-2 border-yellow-600 border-t-transparent rounded-full"></div>
                            </div>
                            <div className="ml-3">
                                <h4 className="font-medium text-yellow-800 mb-1">Analysis In Progress</h4>
                                <p className="text-yellow-700 text-sm">
                                    Processing your data... This may take a few moments depending on the dataset size and complexity.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VisualizationStep; 