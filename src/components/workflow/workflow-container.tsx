import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../stores/store';
import { goBackStep, resetWorkflow } from '../../stores/workflow-slice';
import ToolSelector from '../toolbox/tool-selector';
import DataUploadStep from './steps/data-upload-step';
import FieldMappingStep from './steps/field-mapping-step';
import ToolOptionsStep from './steps/tool-options-step';
import VisualizationStep from './steps/visualization-step';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Home } from 'lucide-react';

const WorkflowContainer = () => {
    const dispatch = useDispatch();
    const { currentStep, selectedTool } = useSelector((state: RootState) => state.workflow);

    const handleGoBack = () => {
        dispatch(goBackStep());
    };

    const handleGoHome = () => {
        dispatch(resetWorkflow());
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 'tool-selection':
                return <ToolSelector />;
            case 'data-upload':
                return <DataUploadStep />;
            case 'field-mapping':
                return <FieldMappingStep />;
            case 'options':
                return <ToolOptionsStep />;
            case 'visualization':
                return <VisualizationStep />;
            default:
                return <ToolSelector />;
        }
    };

    const getStepTitle = () => {
        switch (currentStep) {
            case 'tool-selection':
                return 'Tool Selection';
            case 'data-upload':
                return 'Upload Data';
            case 'field-mapping':
                return 'Map Fields';
            case 'options':
                return 'Configure Options';
            case 'visualization':
                return 'Visualization';
            default:
                return 'Tool Selection';
        }
    };

    const showNavigation = currentStep !== 'tool-selection';
    const isToolComplete = currentStep === 'visualization';

    return (
        <div className="h-full flex flex-col">
            {showNavigation && (
                <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        {!isToolComplete ? (
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={handleGoBack}
                                className="flex items-center space-x-2"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span>Back</span>
                            </Button>
                        ) : (
                            <Button 
                                variant="outline" 
                                size="sm" 
                                disabled
                                className="flex items-center space-x-2 opacity-50 cursor-not-allowed"
                                title="Analysis complete - use Home to start a new analysis"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span>Back</span>
                            </Button>
                        )}
                        <Button 
                            variant={isToolComplete ? "default" : "ghost"}
                            size="sm" 
                            onClick={handleGoHome}
                            className={`flex items-center space-x-2 ${
                                isToolComplete ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''
                            }`}
                        >
                            <Home className="w-4 h-4" />
                            <span>{isToolComplete ? 'Start New Analysis' : 'Home'}</span>
                        </Button>
                    </div>
                    <div className="flex items-center space-x-4">
                        {selectedTool && (
                            <div className="flex items-center space-x-2">
                                <span className="text-lg">{selectedTool.icon}</span>
                                <span className="font-medium text-gray-700">{selectedTool.name}</span>
                            </div>
                        )}
                        <div className="text-sm text-gray-500">
                            Step: {getStepTitle()}
                        </div>
                    </div>
                </div>
            )}
            
            <div className="flex-1 overflow-auto bg-gray-50">
                {renderStepContent()}
            </div>
        </div>
    );
};

export default WorkflowContainer; 