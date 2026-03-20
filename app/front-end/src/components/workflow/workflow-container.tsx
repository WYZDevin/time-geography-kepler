import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../stores/store';
import { goBackStep, resetWorkflow, setCurrentStep } from '../../stores/workflow-slice';
import ToolSelector from '../toolbox/tool-selector';
import UnifiedToolOptionsStep from './steps/unified-tool-options-step';
import VisualizationStep from './steps/visualization-step';
import WorkflowStepper from './workflow-stepper';
import WorkflowHistoryPanel from './workflow-history-panel';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Home, ChevronUp, Settings } from 'lucide-react';
import { toolRegistry } from '@/utils/tool-registry';

interface WorkflowContainerProps {
    onCollapse?: () => void;
    isCollapsible?: boolean;
}

const WorkflowContainer: React.FC<WorkflowContainerProps> = ({
    onCollapse,
    isCollapsible = false
}) => {
    const dispatch = useDispatch();
    const { currentStep, selectedToolId } = useSelector((state: RootState) => state.workflow);
    const selectedTool = selectedToolId ? toolRegistry.getTool(selectedToolId) : null;

    const handleGoBack = () => {
        dispatch(goBackStep());
    };

    const handleGoHome = () => {
        dispatch(resetWorkflow());
    };

    const handleStepClick = (step: 'tool-selection' | 'options' | 'visualization') => {
        dispatch(setCurrentStep(step));
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 'tool-selection':
                return <ToolSelector />;
            case 'options':
                return <UnifiedToolOptionsStep />;
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
            case 'options':
                return 'Configure Tool';
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
            {/* Workflow Stepper */}
            <WorkflowStepper
                currentStep={currentStep}
                onStepClick={handleStepClick}
            />

            {/* Workflow History Panel */}
            <WorkflowHistoryPanel />

            {showNavigation && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200 px-6 py-4 flex items-center justify-between">
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
                            <div className="flex flex-col">
                                <div className="flex items-center space-x-2">
                                    <span className="text-lg">{selectedTool.icon}</span>
                                    <span className="font-medium text-gray-700">{selectedTool.name}</span>
                                </div>
                                <div className="text-xs text-gray-500 ml-6">
                                    Step: {getStepTitle()}
                                </div>
                            </div>
                        )}
                        {!selectedTool && (
                            <div className="text-sm text-gray-500">
                                Step: {getStepTitle()}
                            </div>
                        )}
                        {isCollapsible && onCollapse && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onCollapse}
                                className="h-6 w-6 p-0 hover:bg-blue-100 ml-2"
                                title="Collapse toolbox"
                            >
                                <ChevronUp className="w-4 h-4 text-blue-600" />
                            </Button>
                        )}
                    </div>
                </div>
            )}
            
            {/* Add a header when no navigation is shown (tool-selection step) */}
            {!showNavigation && isCollapsible && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center">
                        <Settings className="w-4 h-4 mr-2 text-blue-600" />
                        <span className="text-sm font-semibold text-gray-700">Analysis Tools</span>
                    </div>
                    {onCollapse && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onCollapse}
                            className="h-6 w-6 p-0 hover:bg-blue-100"
                            title="Collapse toolbox"
                        >
                            <ChevronUp className="w-4 h-4 text-blue-600" />
                        </Button>
                    )}
                </div>
            )}
            
            <div className="flex-1 overflow-auto bg-gray-50">
                {renderStepContent()}
            </div>
        </div>
    );
};

export default WorkflowContainer; 