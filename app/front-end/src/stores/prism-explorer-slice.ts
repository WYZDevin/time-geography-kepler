import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { SelectedAnchor } from '@/interfaces/map-types';

export type PrismExplorerMode = 'idle' | 'selectingA' | 'selectingB' | 'ready' | 'computing';

export interface PrismParams {
  prismMode: string;
  speedMode: string;
  customSpeed: number;
  durationMinutes: number;
  bufferMeters: number;
  timeSlices: number;
  showPPA: boolean;
  showAxes: boolean;
  timeBreaks: string;
  roadNetworkDatasetId: string;
  h3Resolution: number;
  minActivityMinutes: number;
  /**
   * Realistic-speed adjustment (road-network prism): 'off' = free-flow profile
   * speeds; 'auto' = calibrate from the GPS trajectory (fallback: time-of-day
   * congestion factor); 'manual' = multiply speeds by speedFactor.
   */
  speedAdjustment: 'off' | 'auto' | 'manual';
  /** Real speed = factor × profile speed (used when speedAdjustment='manual'). */
  speedFactor: number;
  // PPA road-network mode (gps-road-network):
  // T (totalBudgetMinutes) — total time budget per GPS origin
  // A (minActivityMinutes) — reused above; minimum activity time at destination
  // maxOrigins             — cap on GPS points sampled between anchors
  totalBudgetMinutes: number;
  maxOrigins: number;
  /**
   * Merge consecutive GPS samples whose locations stay within this radius
   * (metres) into a single PPA at the cluster centroid. 0 disables merging.
   */
  clusterRadiusMeters: number;
  /**
   * Per-origin cap on emitted reachable road segments — sorted by dwell
   * time (closest to origin first) and the lowest-dwell fringe is dropped
   * when the count exceeds the cap. 0 disables the cap.
   */
  maxSegmentsPerOrigin: number;
}

interface PrismExplorerState {
  mode: PrismExplorerMode;
  anchorA: SelectedAnchor | null;
  anchorB: SelectedAnchor | null;
  params: PrismParams;
  /** Dataset/layer IDs owned by the explorer — removed on recompute or close */
  ownedDatasetIds: string[];
  ownedLayerIds: string[];
}

const initialState: PrismExplorerState = {
  mode: 'idle',
  anchorA: null,
  anchorB: null,
  params: {
    prismMode: 'road-network-stp',
    speedMode: 'walking',
    customSpeed: 5,
    durationMinutes: 45,
    bufferMeters: 100,
    timeSlices: 15,
    showPPA: true,
    showAxes: true,
    timeBreaks: 'auto',
    roadNetworkDatasetId: '',
    h3Resolution: 9,
    minActivityMinutes: 5,
    speedAdjustment: 'off',
    speedFactor: 0.7,
    totalBudgetMinutes: 30,
    maxOrigins: 30,
    clusterRadiusMeters: 50,
    maxSegmentsPerOrigin: 300,
  },
  ownedDatasetIds: [],
  ownedLayerIds: [],
};

const prismExplorerSlice = createSlice({
  name: 'prismExplorer',
  initialState,
  reducers: {
    startExplorer(state) {
      state.mode = 'selectingA';
      state.anchorA = null;
      state.anchorB = null;
    },

    setAnchorA(state, action: PayloadAction<SelectedAnchor>) {
      state.anchorA = action.payload;
      state.mode = 'selectingB';
    },

    setAnchorB(state, action: PayloadAction<SelectedAnchor>) {
      state.anchorB = action.payload;
      state.mode = 'ready';
    },

    swapAnchors(state) {
      const tmp = state.anchorA;
      state.anchorA = state.anchorB;
      state.anchorB = tmp;
    },

    clearAnchorB(state) {
      state.anchorB = null;
      state.mode = 'selectingB';
    },

    pickNewAnchors(state) {
      state.anchorA = null;
      state.anchorB = null;
      state.mode = 'selectingA';
    },

    updateParams(state, action: PayloadAction<Partial<PrismParams>>) {
      Object.assign(state.params, action.payload);
    },

    setComputing(state) {
      state.mode = 'computing';
    },

    setReady(state) {
      state.mode = 'ready';
    },

    setOwnedIds(state, action: PayloadAction<{ datasetIds: string[]; layerIds: string[] }>) {
      state.ownedDatasetIds = action.payload.datasetIds;
      state.ownedLayerIds = action.payload.layerIds;
    },

    closeExplorer() {
      return initialState;
    },
  },
});

export const {
  startExplorer,
  setAnchorA,
  setAnchorB,
  swapAnchors,
  clearAnchorB,
  pickNewAnchors,
  updateParams,
  setComputing,
  setReady,
  setOwnedIds,
  closeExplorer,
} = prismExplorerSlice.actions;

export default prismExplorerSlice.reducer;
