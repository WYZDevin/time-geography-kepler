import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { FeatureCollection } from '../interfaces/data-interfaces';

// SIMPLIFIED data source - only what we need
export interface DataSource {
  id: string;
  name: string;
  data: FeatureCollection;
  createdAt: string;

  // Only essential metadata
  featureCount: number;
  bounds?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };

  // Pre-extracted field names — always populated for large files where
  // data.features is an empty stub (real data lives in large-file-cache).
  fieldNames?: string[];

  // Simple lineage
  derivedFrom?: string; // Parent data source ID
  createdBy?: string;   // Tool ID that created this
}

interface DataState {
  dataSources: Record<string, DataSource>;
  selectedIds: string[];
}

const initialState: DataState = {
  dataSources: {},
  selectedIds: []
};

const dataSlice = createSlice({
  name: 'data',
  initialState,
  reducers: {
    // Simple actions only
    addDataSource: (state, action: PayloadAction<DataSource>) => {
      state.dataSources[action.payload.id] = action.payload;
    },
    
    removeDataSource: (state, action: PayloadAction<string>) => {
      delete state.dataSources[action.payload];
      state.selectedIds = state.selectedIds.filter(id => id !== action.payload);
    },
    
    selectDataSource: (state, action: PayloadAction<string>) => {
      if (!state.selectedIds.includes(action.payload)) {
        state.selectedIds.push(action.payload);
      }
    },
    
    deselectDataSource: (state, action: PayloadAction<string>) => {
      state.selectedIds = state.selectedIds.filter(id => id !== action.payload);
    },
    
    clearSelection: (state) => {
      state.selectedIds = [];
    },
    
    clearAll: (state) => {
      state.dataSources = {};
      state.selectedIds = [];
    },

    // Persistence actions
    loadProjectData: (state, action: PayloadAction<{ dataSources: Record<string, DataSource>; selectedIds: string[] }>) => {
      state.dataSources = action.payload.dataSources;
      state.selectedIds = action.payload.selectedIds;
    },
  }
});

// Simple selectors
export const selectAllDataSources = (state: { data: DataState }) => 
  Object.values(state.data.dataSources);

export const selectDataSourceById = (id: string) => (state: { data: DataState }) =>
  state.data.dataSources[id];

export const selectSelectedDataSources = (state: { data: DataState }) =>
  state.data.selectedIds.map(id => state.data.dataSources[id]).filter(Boolean);

export const selectSelectedDataSourceIds = (state: { data: DataState }) =>
  state.data.selectedIds;

export const {
  addDataSource,
  removeDataSource,
  selectDataSource,
  deselectDataSource,
  clearSelection,
  clearAll,
  loadProjectData,
} = dataSlice.actions;

export default dataSlice.reducer;