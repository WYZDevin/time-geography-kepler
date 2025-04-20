// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import { configureStore } from '@reduxjs/toolkit';
import keplerGlReducer, { enhanceReduxMiddleware } from '@kepler.gl/reducers';
import progressReducer from './progress-slice';
import metadataReducer from './metadata-slice';

const customKeplerGlReducer = keplerGlReducer.initialState({
  uiState: {
    readOnly: true,
    currentModal: null
  },
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

const middlewares = enhanceReduxMiddleware([]);

const store = configureStore({
  reducer: {
    keplerGl: customKeplerGlReducer,
    metadata: metadataReducer,
    progress: progressReducer,
  },
  middleware: () => middlewares,
});

export default store;

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
