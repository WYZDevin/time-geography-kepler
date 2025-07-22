import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { FeatureCollection, ColumnMapping } from '../interfaces/data-interfaces';
import { BaseTool } from '../interfaces/tool-interfaces';

// Update the workflow state interface
interface ToolWorkflowState {
    selectedTool: BaseTool | null;
    currentStep: 'tool-selection' | 'data-upload' | 'field-mapping' | 'options' | 'visualization';
    uploadedData: FeatureCollection | null;
    fieldMapping: ColumnMapping | null;
    toolOptions: Record<string, any>;
}

const initialState: ToolWorkflowState = {
    selectedTool: null,
    currentStep: 'tool-selection',
    uploadedData: null,
    fieldMapping: null,
    toolOptions: {}
};

const workflowSlice = createSlice({
    name: 'workflow',
    initialState,
    reducers: {
        selectTool: (state, action: PayloadAction<BaseTool>) => {
            state.selectedTool = action.payload;
            state.currentStep = 'data-upload';
        },
        setCurrentStep: (state, action: PayloadAction<ToolWorkflowState['currentStep']>) => {
            state.currentStep = action.payload;
        },
        setUploadedData: (state, action: PayloadAction<FeatureCollection>) => {
            state.uploadedData = action.payload;
            state.currentStep = 'field-mapping';
        },
        setFieldMapping: (state, action: PayloadAction<ColumnMapping>) => {
            state.fieldMapping = action.payload;
            state.currentStep = 'options';
        },
        setToolOptions: (state, action: PayloadAction<Record<string, any>>) => {
            state.toolOptions = action.payload;
        },
        proceedToVisualization: (state) => {
            state.currentStep = 'visualization';
        },
        resetWorkflow: (state) => {
            state.selectedTool = null;
            state.currentStep = 'tool-selection';
            state.uploadedData = null;
            state.fieldMapping = null;
            state.toolOptions = {};
        },
        goBackStep: (state) => {
            switch (state.currentStep) {
                case 'data-upload':
                    state.currentStep = 'tool-selection';
                    state.selectedTool = null;
                    break;
                case 'field-mapping':
                    state.currentStep = 'data-upload';
                    state.uploadedData = null;
                    break;
                case 'options':
                    state.currentStep = 'field-mapping';
                    state.fieldMapping = null;
                    break;
                case 'visualization':
                    state.currentStep = 'options';
                    break;
            }
        }
    }
});

export const {
    selectTool,
    setCurrentStep,
    setUploadedData,
    setFieldMapping,
    setToolOptions,
    proceedToVisualization,
    resetWorkflow,
    goBackStep
} = workflowSlice.actions;

export default workflowSlice.reducer; 