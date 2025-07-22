import { createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit';
import { FeatureCollection, ColumnMapping } from '../interfaces/data-interfaces';

// Enhanced data source interface
export interface DataSource {
  id: string;
  name: string;
  type: 'uploaded' | 'processed' | 'generated';
  data: FeatureCollection;
  metadata: {
    uploadedAt?: string;
    processedBy?: string;
    originalSource?: string;
    fieldMapping?: ColumnMapping;
    processingOptions?: Record<string, any>;
    statistics?: {
      featureCount: number;
      spatialBounds?: {
        minLat: number;
        maxLat: number;
        minLng: number;
        maxLng: number;
      };
      temporalBounds?: {
        start: string;
        end: string;
      };
    };
  };
  tags: string[];
  isActive: boolean;
}

// Data processing session to track tool executions
export interface ProcessingSession {
  id: string;
  toolId: string;
  toolName: string;
  inputDataIds: string[];
  outputDataIds: string[];
  options: Record<string, any>;
  fieldMapping: ColumnMapping;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

interface DataState {
  // Data sources management
  dataSources: Record<string, DataSource>;
  activeDataSourceId: string | null;
  
  // Processing sessions
  sessions: Record<string, ProcessingSession>;
  activeSessionId: string | null;
  
  // Data relationships
  dataRelationships: Record<string, string[]>; // parent -> children mapping
  
  // UI state
  selectedDataIds: string[];
  dataViewMode: 'list' | 'tree' | 'timeline';
  
  // Cache and performance
  lastProcessedAt: string | null;
  cacheEnabled: boolean;
}

const initialState: DataState = {
  dataSources: {},
  activeDataSourceId: null,
  sessions: {},
  activeSessionId: null,
  dataRelationships: {},
  selectedDataIds: [],
  dataViewMode: 'list',
  lastProcessedAt: null,
  cacheEnabled: true,
};

const dataSlice = createSlice({
  name: 'data',
  initialState,
  reducers: {
    // Data source management
    addDataSource: (state, action: PayloadAction<DataSource>) => {
      const dataSource = action.payload;
      state.dataSources[dataSource.id] = dataSource;
      
      // Auto-activate if it's the first data source
      if (!state.activeDataSourceId) {
        state.activeDataSourceId = dataSource.id;
      }
    },
    
    updateDataSource: (state, action: PayloadAction<{ id: string; updates: Partial<DataSource> }>) => {
      const { id, updates } = action.payload;
      if (state.dataSources[id]) {
        state.dataSources[id] = { ...state.dataSources[id], ...updates };
      }
    },
    
    removeDataSource: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      delete state.dataSources[id];
      
      // Update active data source if removed
      if (state.activeDataSourceId === id) {
        const remainingIds = Object.keys(state.dataSources);
        state.activeDataSourceId = remainingIds.length > 0 ? remainingIds[0] : null;
      }
      
      // Clean up relationships
      delete state.dataRelationships[id];
      Object.keys(state.dataRelationships).forEach(parentId => {
        state.dataRelationships[parentId] = state.dataRelationships[parentId].filter(childId => childId !== id);
      });
    },
    
    setActiveDataSource: (state, action: PayloadAction<string | null>) => {
      state.activeDataSourceId = action.payload;
    },
    
    // Processing sessions
    startProcessingSession: (state, action: PayloadAction<Omit<ProcessingSession, 'startTime' | 'status'>>) => {
      const session: ProcessingSession = {
        ...action.payload,
        startTime: new Date().toISOString(),
        status: 'running',
      };
      state.sessions[session.id] = session;
      state.activeSessionId = session.id;
    },
    
    completeProcessingSession: (state, action: PayloadAction<{ 
      sessionId: string; 
      outputDataIds: string[];
      endTime?: string;
    }>) => {
      const { sessionId, outputDataIds, endTime } = action.payload;
      if (state.sessions[sessionId]) {
        state.sessions[sessionId].status = 'completed';
        state.sessions[sessionId].outputDataIds = outputDataIds;
        state.sessions[sessionId].endTime = endTime || new Date().toISOString();
        state.lastProcessedAt = new Date().toISOString();
      }
    },
    
    failProcessingSession: (state, action: PayloadAction<{ sessionId: string; error: string }>) => {
      const { sessionId, error } = action.payload;
      if (state.sessions[sessionId]) {
        state.sessions[sessionId].status = 'failed';
        state.sessions[sessionId].error = error;
        state.sessions[sessionId].endTime = new Date().toISOString();
      }
    },
    
    // Data relationships
    addDataRelationship: (state, action: PayloadAction<{ parentId: string; childId: string }>) => {
      const { parentId, childId } = action.payload;
      if (!state.dataRelationships[parentId]) {
        state.dataRelationships[parentId] = [];
      }
      if (!state.dataRelationships[parentId].includes(childId)) {
        state.dataRelationships[parentId].push(childId);
      }
    },
    
    // UI state
    setSelectedDataIds: (state, action: PayloadAction<string[]>) => {
      state.selectedDataIds = action.payload;
    },
    
    setDataViewMode: (state, action: PayloadAction<DataState['dataViewMode']>) => {
      state.dataViewMode = action.payload;
    },
    
    toggleDataSelection: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      const index = state.selectedDataIds.indexOf(id);
      if (index >= 0) {
        state.selectedDataIds.splice(index, 1);
      } else {
        state.selectedDataIds.push(id);
      }
    },
    
    // Bulk operations
    clearAllData: (state) => {
      state.dataSources = {};
      state.activeDataSourceId = null;
      state.sessions = {};
      state.activeSessionId = null;
      state.dataRelationships = {};
      state.selectedDataIds = [];
      state.lastProcessedAt = null;
    },
    
    // Cache management
    setCacheEnabled: (state, action: PayloadAction<boolean>) => {
      state.cacheEnabled = action.payload;
    },
  },
});

// Selectors
export const selectAllDataSources = (state: { data: DataState }) => 
  Object.values(state.data.dataSources);

export const selectActiveDataSource = (state: { data: DataState }) => 
  state.data.activeDataSourceId ? state.data.dataSources[state.data.activeDataSourceId] : null;

export const selectDataSourceById = (id: string) => (state: { data: DataState }) =>
  state.data.dataSources[id];

export const selectDataSourcesByType = (type: DataSource['type']) => 
  createSelector(
    [selectAllDataSources],
    (dataSources) => dataSources.filter(ds => ds.type === type)
  );

export const selectDataSourcesByTag = (tag: string) =>
  createSelector(
    [selectAllDataSources],
    (dataSources) => dataSources.filter(ds => ds.tags.includes(tag))
  );

export const selectProcessingSessions = (state: { data: DataState }) =>
  Object.values(state.data.sessions);

export const selectActiveSession = (state: { data: DataState }) =>
  state.data.activeSessionId ? state.data.sessions[state.data.activeSessionId] : null;

export const selectDataRelationships = (state: { data: DataState }) =>
  state.data.dataRelationships;

export const selectChildDataSources = (parentId: string) =>
  createSelector(
    [selectAllDataSources, selectDataRelationships],
    (dataSources, relationships) => {
      const childIds = relationships[parentId] || [];
      return childIds.map(id => dataSources.find(ds => ds.id === id)).filter(Boolean) as DataSource[];
    }
  );

// Statistics selectors
export const selectDataStatistics = createSelector(
  [selectAllDataSources],
  (dataSources) => ({
    totalDataSources: dataSources.length,
    totalFeatures: dataSources.reduce((sum, ds) => sum + ds.data.features.length, 0),
    dataSourcesByType: dataSources.reduce((acc, ds) => {
      acc[ds.type] = (acc[ds.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    lastUpdated: dataSources.reduce((latest, ds) => {
      const timestamp = ds.metadata.uploadedAt || '';
      return timestamp > latest ? timestamp : latest;
    }, ''),
  })
);

export const {
  addDataSource,
  updateDataSource,
  removeDataSource,
  setActiveDataSource,
  startProcessingSession,
  completeProcessingSession,
  failProcessingSession,
  addDataRelationship,
  setSelectedDataIds,
  setDataViewMode,
  toggleDataSelection,
  clearAllData,
  setCacheEnabled,
} = dataSlice.actions;

export default dataSlice.reducer;