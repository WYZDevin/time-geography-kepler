import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../../stores/store';
import { Button } from '@/components/ui/button';
import { resetWorkflow, setCurrentStep, addToHistory } from '../../../stores/workflow-slice';
import { AnalysisResult, createAnalysisEngine } from '../../../services/analysis-engine';
import { KeplerAdapter } from '../../kepler-adapter';
import { toolRegistry } from '@/utils/tool-registry';

const VisualizationStep = () => {
    const dispatch = useAppDispatch();
    const { selectedToolId, selectedData, fieldMapping, toolOptions, executionMode } = useAppSelector(state => state.workflow);
    const { sideLength, heightScale } = useAppSelector(state => state.metadata);
    const selectedTool = selectedToolId ? toolRegistry.getTool(selectedToolId) : null;
    const analysisEngine = useMemo(() => createAnalysisEngine(), []);
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showErrorDetails, setShowErrorDetails] = useState(false);
    const hasRunAnalysis = useRef(false);

    const keplerState = useAppSelector((state: any) => state.keplerGl.kepler);
    const hasExistingData = useMemo(() => {
        if (!keplerState?.visState?.datasets) return false;
        return Object.keys(keplerState.visState.datasets).length > 0;
    }, [keplerState]);

    const [mapActionChoice, setMapActionChoice] = useState<'none' | 'pending' | 'overwrite' | 'append'>('none');

    const runAnalysis = useCallback(async () => {
        if (!selectedData || !selectedToolId) {
            return;
        }

        // Prevent running analysis multiple times
        if (hasRunAnalysis.current) {
            return;
        }

        hasRunAnalysis.current = true;
        setIsAnalyzing(true);

        try {
            const request = {
                toolId: selectedToolId,
                data: selectedData,
                attributes: fieldMapping || undefined,
                options: { ...toolOptions, sideLength, heightScale },
                mode: executionMode || 'frontend',
            };

            const result = await analysisEngine.execute(request);

            setAnalysisResult(result);

            if (result.success) {
                // Add to history on successful analysis
                dispatch(addToHistory({}));
                if (hasExistingData) {
                    setMapActionChoice('pending');
                } else {
                    setMapActionChoice('overwrite');
                }
            } else {
                console.error("Analysis failed:", result.error);
            }
        } catch (error) {
            console.error('Analysis execution error:', error);
            console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');

            const errorResult: AnalysisResult = {
                success: false,
                toolId: selectedToolId,
                outputs: [],
                error: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                metadata: {
                    executionTime: 0,
                    featureCount: 0,
                    timestamp: new Date().toISOString()
                }
            };

            setAnalysisResult(errorResult);
        } finally {
            setIsAnalyzing(false);
        }
    }, [selectedData, selectedToolId, fieldMapping, toolOptions, sideLength, heightScale, analysisEngine, dispatch, hasExistingData]);

    useEffect(() => {
        if (selectedData && selectedToolId && !hasRunAnalysis.current) {
            runAnalysis();
        }
    }, [selectedData, selectedToolId, runAnalysis]);

    const handleNewAnalysis = () => {
        hasRunAnalysis.current = false;
        setAnalysisResult(null);
        setMapActionChoice('none');
        dispatch(resetWorkflow());
    };

    // Reset analysis state when going back to options
    useEffect(() => {
        return () => {
            hasRunAnalysis.current = false;
        };
    }, []);

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
                            {analysisResult?.metadata?.executionTime ?
                                `${analysisResult.metadata.executionTime}ms` : 'N/A'}
                        </div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                        <div className="font-medium text-gray-700 mb-1">Features Generated</div>
                        <div className="text-gray-600">
                            {analysisResult?.metadata?.featureCount ?
                                `${analysisResult.metadata.featureCount} features` : 'N/A'}
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

                {/* Append vs Overwrite Selection Prompt - MOVED TO TOP FOR VISIBILITY */}
                {mapActionChoice === 'pending' && (
                    <div className="mb-6 p-6 bg-blue-50 border-2 border-blue-400 shadow-xl rounded-lg text-center animate-in slide-in-from-bottom-2 duration-300 relative overflow-hidden">
                        <div className="absolute top-0 w-full left-0 h-1 bg-blue-500 animate-pulse"></div>
                        <h4 className="font-bold text-gray-900 text-xl mb-2 flex items-center justify-center">
                            <span className="mr-2">🗺️</span> Map Action Required
                        </h4>
                        <p className="text-gray-700 mb-6 text-base font-medium">Your map already contains data layers. <br />Would you like to add this new analysis on top, or clear the map and start fresh?</p>
                        <div className="flex flex-col sm:flex-row justify-center items-center space-y-3 sm:space-y-0 sm:space-x-4">
                            <Button
                                onClick={() => setMapActionChoice('append')}
                                size="lg"
                                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 shadow-md transition-all hover:scale-105"
                            >
                                ➕ Append to existing map
                            </Button>
                            <Button
                                onClick={() => setMapActionChoice('overwrite')}
                                variant="outline"
                                size="lg"
                                className="w-full sm:w-auto border-gray-400 bg-white text-gray-800 hover:bg-gray-100 font-bold px-8 shadow-sm transition-all hover:border-gray-500"
                            >
                                🔄 Overwrite previous map
                            </Button>
                        </div>
                    </div>
                )}

                {analysisResult?.success && (
                    <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">Analysis Results</h4>
                        <div className="bg-gradient-to-r from-green-50 to-blue-50 p-4 rounded-lg border border-green-200">
                            <div className="flex items-center mb-2">
                                <span className="text-lg mr-2">✅</span>
                                <span className="font-medium text-green-800">
                                    Analysis completed successfully
                                </span>
                            </div>
                            <p className="text-green-700 text-sm">
                                Generated {analysisResult.outputs.length} output dataset(s) with {analysisResult.metadata.featureCount} total features.
                            </p>
                        </div>
                    </div>
                )}

                {analysisResult?.success && analysisResult.outputs && analysisResult.outputs.length > 1 && (
                    <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">Output Datasets</h4>
                        <div className="space-y-2">
                            {analysisResult.outputs.map((output, index) => (
                                <div key={index} className="bg-gray-50 p-3 rounded border">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-medium text-gray-800">Dataset {index + 1}</div>
                                            <div className="text-sm text-gray-600">GeoJSON FeatureCollection</div>
                                        </div>
                                        <div className="text-sm text-gray-500">
                                            {output.features.length} features
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {analysisResult?.success && analysisResult.metadata && (
                    <div className="mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">Results Summary</h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Output Datasets:</span>
                                <span className="font-medium">{analysisResult.outputs.length}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Total Features:</span>
                                <span className="font-medium">{analysisResult.metadata.featureCount}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Execution Time:</span>
                                <span className="font-medium">{analysisResult.metadata.executionTime}ms</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Completed At:</span>
                                <span className="font-medium">{new Date(analysisResult.metadata.timestamp).toLocaleTimeString()}</span>
                            </div>
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
                                            <li className="text-red-700">🔹 <strong>Field issue detected:</strong> Check that your data contains the required fields</li>
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
                                    hasRunAnalysis.current = false;
                                    setAnalysisResult(null);
                                    setMapActionChoice('none');
                                    dispatch(setCurrentStep('options'));
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

            {/* Kepler Adapter handles visualization separately from analysis logic */}
            {(mapActionChoice === 'append' || mapActionChoice === 'overwrite') && (
                <KeplerAdapter
                    result={analysisResult}
                    appendMode={mapActionChoice === 'append'}
                    onVisualizationComplete={() => { }}
                />
            )}
        </div>
    );
};

export default VisualizationStep; 