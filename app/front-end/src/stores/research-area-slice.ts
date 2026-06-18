import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { FeatureCollection } from '@/interfaces/data-interfaces';
import type { RootState } from './store';

/** One uploaded GeoJSON that contributes to the research area. */
export interface ResearchAreaSource {
  id: string;
  name: string;
  geojson: FeatureCollection;
  featureCount: number;
}

/**
 * The global research area, built from one or more uploaded GeoJSON files.
 * When `enabled`, backend tool runs clip their output to the union of all
 * sources (see backend `filter_to_research_area`).
 */
export interface ResearchAreaState {
  sources: ResearchAreaSource[];
  enabled: boolean;
  /** Whether the area boundary is drawn on the map (independent of clipping). */
  visible: boolean;
}

const initialState: ResearchAreaState = {
  sources: [],
  enabled: false,
  visible: true,
};

const researchAreaSlice = createSlice({
  name: 'researchArea',
  initialState,
  reducers: {
    addResearchAreaSource(
      state,
      action: PayloadAction<{ id: string; name: string; geojson: FeatureCollection }>,
    ) {
      state.sources.push({
        id: action.payload.id,
        name: action.payload.name,
        geojson: action.payload.geojson,
        featureCount: action.payload.geojson.features.length,
      });
      state.enabled = true; // adding an area turns clipping on by default
    },

    removeResearchAreaSource(state, action: PayloadAction<string>) {
      state.sources = state.sources.filter((s) => s.id !== action.payload);
      if (state.sources.length === 0) state.enabled = false;
    },

    clearResearchArea() {
      return initialState;
    },

    setResearchAreaEnabled(state, action: PayloadAction<boolean>) {
      state.enabled = action.payload;
    },

    setResearchAreaVisible(state, action: PayloadAction<boolean>) {
      state.visible = action.payload;
    },
  },
});

export const {
  addResearchAreaSource,
  removeResearchAreaSource,
  clearResearchArea,
  setResearchAreaEnabled,
  setResearchAreaVisible,
} = researchAreaSlice.actions;

export const selectResearchArea = (s: RootState) => s.researchArea;
export const selectResearchAreaSources = (s: RootState) => s.researchArea.sources;
export const selectResearchAreaEnabled = (s: RootState) => s.researchArea.enabled;
export const selectResearchAreaVisible = (s: RootState) => s.researchArea.visible;

// Memoized so consumers get a stable reference unless the sources actually
// change — important because these feed useCallback/effect dependency arrays.

/** Combined FeatureCollection across all sources (for map display), or null. */
export const selectResearchAreaGeoJSON = createSelector(
  [selectResearchAreaSources],
  (sources): FeatureCollection | null =>
    sources.length === 0
      ? null
      : { type: 'FeatureCollection', features: sources.flatMap((s) => s.geojson.features) },
);

/** The clip geometry to send to the backend, or null when disabled/empty. */
export const selectActiveResearchArea = createSelector(
  [selectResearchAreaGeoJSON, selectResearchAreaEnabled],
  (geojson, enabled): FeatureCollection | null => (enabled ? geojson : null),
);

export default researchAreaSlice.reducer;
