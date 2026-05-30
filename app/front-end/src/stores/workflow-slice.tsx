import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { FeatureCollection } from '../interfaces/data-interfaces';
import { AttributeMapping } from '../interfaces/attribute-mapping';
import { ExecutionMode } from '../interfaces/simple-tool';

interface WorkflowHistoryEntry {
    id: string;
    timestamp: number;
    toolId: string;
    dataSourceId: string;
    fieldMapping: AttributeMapping | null;
    toolOptions: Record<string, any>;
    resultDataSourceId?: string;
}

// Update the workflow state interface
interface ToolWorkflowState {
    selectedToolId: string | null;
    currentStep: 'tool-selection' | 'options' | 'visualization';
    selectedDataSourceId: string | null;
    selectedData: FeatureCollection | null;
    fieldMapping: AttributeMapping | null;
    toolOptions: Record<string, any>;
    executionMode: ExecutionMode | null;
    history: WorkflowHistoryEntry[];
}

const initialState: ToolWorkflowState = {
    selectedToolId: null,
    currentStep: 'tool-selection',
    selectedDataSourceId: null,
    selectedData: null,
    fieldMapping: null,
    toolOptions: {},
    executionMode: null,
    history: []
};

const workflowSlice = createSlice({
    name: 'workflow',
    initialState,
    reducers: {
        selectTool: (state, action: PayloadAction<string>) => {
            state.selectedToolId = action.payload;
            state.currentStep = 'options';
            state.executionMode = null;
        },
        setCurrentStep: (state, action: PayloadAction<ToolWorkflowState['currentStep']>) => {
            state.currentStep = action.payload;
        },
        setSelectedDataSource: (state, action: PayloadAction<{dataSourceId: string, data: FeatureCollection}>) => {
            state.selectedDataSourceId = action.payload.dataSourceId;
            state.selectedData = action.payload.data;
            // Stay on options step since everything is now on one page
        },
        setFieldMapping: (state, action: PayloadAction<AttributeMapping>) => {
            state.fieldMapping = action.payload;
            // Stay on options step since field mapping is now inline
        },
        setToolOptions: (state, action: PayloadAction<Record<string, any>>) => {
            state.toolOptions = action.payload;
        },
        proceedToVisualization: (state) => {
            state.currentStep = 'visualization';
        },
        setExecutionMode: (state, action: PayloadAction<ExecutionMode | null>) => {
            state.executionMode = action.payload;
        },
        resetWorkflow: (state) => {
            state.selectedToolId = null;
            state.currentStep = 'tool-selection';
            state.selectedDataSourceId = null;
            state.selectedData = null;
            state.fieldMapping = null;
            state.toolOptions = {};
            state.executionMode = null;
        },
        goBackStep: (state) => {
            switch (state.currentStep) {
                case 'options':
                    state.currentStep = 'tool-selection';
                    state.selectedToolId = null;
                    state.selectedDataSourceId = null;
                    state.selectedData = null;
                    state.fieldMapping = null;
                    state.toolOptions = {};
                    state.executionMode = null;
                    break;
                case 'visualization':
                    state.currentStep = 'options';
                    break;
            }
        },
        addToHistory: (state, action: PayloadAction<{ resultDataSourceId?: string }>) => {
            if (!state.selectedToolId || !state.selectedDataSourceId) return;

            const entry: WorkflowHistoryEntry = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                toolId: state.selectedToolId,
                dataSourceId: state.selectedDataSourceId,
                fieldMapping: state.fieldMapping,
                toolOptions: { ...state.toolOptions },
                resultDataSourceId: action.payload.resultDataSourceId
            };

            // Keep only last 50 entries
            state.history = [entry, ...state.history].slice(0, 50);
        },
        rerunFromHistory: (state, action: PayloadAction<string>) => {
            const entry = state.history.find(h => h.id === action.payload);
            if (!entry) return;

            state.selectedToolId = entry.toolId;
            state.selectedDataSourceId = entry.dataSourceId;
            state.fieldMapping = entry.fieldMapping;
            state.toolOptions = { ...entry.toolOptions };
            state.currentStep = 'options';
        },
        clearHistory: (state) => {
            state.history = [];
        }
    }
});

export const {
    selectTool,
    setCurrentStep,
    setSelectedDataSource,
    setFieldMapping,
    setToolOptions,
    setExecutionMode,
    proceedToVisualization,
    resetWorkflow,
    goBackStep,
    addToHistory,
    rerunFromHistory,
    clearHistory
} = workflowSlice.actions;

export type { WorkflowHistoryEntry };

export default workflowSlice.reducer; 
