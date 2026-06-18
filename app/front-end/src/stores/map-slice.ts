import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { MapViewState, MapState, MapDataset, DeckLayerDescriptor, SelectedAnchor, AnimationMode } from '@/interfaces/map-types';

const initialState: MapState = {
  viewState: {
    // Default view: downtown Toronto
    longitude: -79.38,
    latitude: 43.65,
    zoom: 11,
    pitch: 45,
    bearing: 0,
  },
  mapStyle: 'positron',
  datasets: {},
  layers: [],
  selectedAnchors: [],
  animation: {
    isPlaying: false,
    currentProgress: 1,
    speed: 1,
    sliceCount: 0,
    mode: 'progressive',
    loop: false,
  },
};

const mapSlice = createSlice({
  name: 'map',
  initialState,
  reducers: {
    setViewState(state, action: PayloadAction<Partial<MapViewState>>) {
      Object.assign(state.viewState, action.payload);
    },

    setMapStyle(state, action: PayloadAction<MapState['mapStyle']>) {
      state.mapStyle = action.payload;
    },

    addDatasets(state, action: PayloadAction<MapDataset[]>) {
      for (const ds of action.payload) {
        state.datasets[ds.id] = ds;
      }
    },

    removeDataset(state, action: PayloadAction<string>) {
      delete state.datasets[action.payload];
      state.layers = state.layers.filter(l => l.datasetId !== action.payload);
    },

    setLayers(state, action: PayloadAction<DeckLayerDescriptor[]>) {
      state.layers = action.payload;
    },

    addLayers(state, action: PayloadAction<DeckLayerDescriptor[]>) {
      state.layers.push(...action.payload);
    },

    updateLayer(state, action: PayloadAction<{ id: string; changes: Partial<DeckLayerDescriptor> }>) {
      const layer = state.layers.find(l => l.id === action.payload.id);
      if (layer) {
        Object.assign(layer, action.payload.changes);
      }
    },

    removeLayers(state, action: PayloadAction<string[]>) {
      const ids = new Set(action.payload);
      state.layers = state.layers.filter(l => !ids.has(l.id));
    },

    clearAll(state) {
      state.datasets = {};
      state.layers = [];
      state.selectedAnchors = [];
      state.animation = { isPlaying: false, currentProgress: 1, speed: 1, sliceCount: 0, mode: 'progressive', loop: false };
    },

    pushAnchor(state, action: PayloadAction<SelectedAnchor>) {
      if (state.selectedAnchors.length >= 2) {
        state.selectedAnchors = [action.payload]; // reset, start new pair
      } else {
        state.selectedAnchors.push(action.payload);
      }
    },

    setAnchors(state, action: PayloadAction<SelectedAnchor[]>) {
      state.selectedAnchors = action.payload.slice(0, 2);
    },

    clearAnchors(state) {
      state.selectedAnchors = [];
    },

    // Animation reducers
    setAnimationPlaying(state, action: PayloadAction<boolean>) {
      state.animation.isPlaying = action.payload;
    },

    setAnimationProgress(state, action: PayloadAction<number>) {
      state.animation.currentProgress = Math.max(0, Math.min(1, action.payload));
    },

    setAnimationSpeed(state, action: PayloadAction<number>) {
      state.animation.speed = action.payload;
    },

    setSliceCount(state, action: PayloadAction<number>) {
      state.animation.sliceCount = Math.max(0, action.payload);
    },

    setAnimationMode(state, action: PayloadAction<AnimationMode>) {
      state.animation.mode = action.payload;
    },

    setAnimationLoop(state, action: PayloadAction<boolean>) {
      state.animation.loop = action.payload;
    },

    resetAnimation(state) {
      state.animation.isPlaying = false;
      state.animation.currentProgress = 1;
      state.animation.speed = 1;
      state.animation.sliceCount = 0;
      state.animation.mode = 'progressive';
      state.animation.loop = false;
    },
  },
});

export const {
  setViewState,
  setMapStyle,
  addDatasets,
  removeDataset,
  setLayers,
  addLayers,
  updateLayer,
  removeLayers,
  clearAll,
  pushAnchor,
  setAnchors,
  clearAnchors,
  setAnimationPlaying,
  setAnimationProgress,
  setAnimationSpeed,
  setSliceCount,
  setAnimationMode,
  setAnimationLoop,
  resetAnimation,
} = mapSlice.actions;

export default mapSlice.reducer;
