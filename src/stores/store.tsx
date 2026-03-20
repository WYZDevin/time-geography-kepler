// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import keplerGlReducer, { enhanceReduxMiddleware, INITIAL_MAP_STYLE } from '@kepler.gl/reducers';
import progressReducer from './progress-slice';
import metadataReducer from './metadata-slice';
import workflowReducer from './workflow-slice';
import dataReducer from './data-slice';
import settingsReducer from './settings-slice';
import { persistenceMiddleware } from './persistence-middleware';
import { KeplerGlState } from '../interfaces/kepler-types';

const defaultMapStyle = {
  ...INITIAL_MAP_STYLE,
  styleType: 'positron',
  mapStyles: { ...INITIAL_MAP_STYLE.mapStyles },
  visibleLayerGroups: { ...INITIAL_MAP_STYLE.visibleLayerGroups },
  topLayerGroups: { ...INITIAL_MAP_STYLE.topLayerGroups },
  isLoading: { ...INITIAL_MAP_STYLE.isLoading },
  inputStyle: { ...INITIAL_MAP_STYLE.inputStyle },
  threeDBuildingColor: [...INITIAL_MAP_STYLE.threeDBuildingColor],
  backgroundColor: [...INITIAL_MAP_STYLE.backgroundColor]
};

const customKeplerGlReducer = keplerGlReducer.initialState({
  uiState: {
    readOnly: true,
    currentModal: null
  },
  mapStyle: defaultMapStyle,
  mapControls: {
    visibleLayers: {
      show: false
    },
    mapLegend: {
      show: true,
      active: true
    },
    toggle3d: {
      show: false
    },
    splitMap: {
      show: false
    }
  }
});

const middlewares = enhanceReduxMiddleware([persistenceMiddleware]);

const store = configureStore({
  reducer: {
    keplerGl: customKeplerGlReducer,
    metadata: metadataReducer,
    progress: progressReducer,
    workflow: workflowReducer,
    data: dataReducer,
    settings: settingsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Kepler.gl datasets and layers intentionally embed deck.gl classes and
      // accessor functions (see https://docs.kepler.gl/docs/api-reference/get-started).
      // Redux Toolkit's serializableCheck cannot safely inspect those payloads, so
      // disable it here and rely on Kepler's own middleware wrappers instead.
      serializableCheck: false,
      // Kepler.gl also mutates deeply nested dataset containers with deck.gl caches.
      // The default immutableCheck fires against those legitimate mutations, so disable it.
      immutableCheck: false,
    }).concat(middlewares),
});

export default store;

// Extend RootState to properly type keplerGl
export type RootState = Omit<ReturnType<typeof store.getState>, 'keplerGl'> & {
  keplerGl: KeplerGlState;
};
export type AppDispatch = typeof store.dispatch;

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
