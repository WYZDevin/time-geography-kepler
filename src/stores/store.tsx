// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import {createStore, combineReducers, applyMiddleware, compose, Action} from 'redux';
import keplerGlReducer, {enhanceReduxMiddleware} from '@kepler.gl/reducers';
import { FeatureCollection } from '../interfaces/data-interfaces';
import { Field } from '@kepler.gl/types';

import { configureStore } from '@reduxjs/toolkit';
import progressReducer from './progress-slice';


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


// Define the shape of our data state
interface DataState {
  geojson: FeatureCollection | null;
  columns: Field[];
}

const initialDataState: DataState = {
  geojson: null,
  columns: [],
};

// Define action types
const SET_GEOJSON = 'SET_GEOJSON';
const SET_COLUMNS = 'SET_COLUMNS';

// Define action interfaces (if using TypeScript)
interface SetGeojsonAction extends Action<typeof SET_GEOJSON> {
  payload: FeatureCollection;
}

interface SetColumnsAction extends Action<typeof SET_COLUMNS> {
  payload: Field[];
}

type DataActionTypes = SetGeojsonAction | SetColumnsAction;

// Reducer to manage geojson and column names
function dataReducer(state = initialDataState, action: DataActionTypes): DataState {
  switch (action.type) {
    case SET_GEOJSON:
      return {
        ...state,
        geojson: action.payload,
      };
    case SET_COLUMNS:
      return {
        ...state,
        columns: action.payload,
      };
    default:
      return state;
  }
}

const reducers = combineReducers({
  keplerGl: customKeplerGlReducer,
  data: dataReducer,
  progress: progressReducer,
});

const middlewares = enhanceReduxMiddleware([]);
// Configure Redux DevTools with max age to limit memory usage
const devToolsOptions = {
  maxAge: 50, // Limit history to 50 actions
  trace: false, // Disable action tracing
  traceLimit: 25 // Limit trace history if enabled
};

const store = configureStore({
  reducer: reducers,
  preloadedState: {}, // equivalent to the empty object in createStore
  middleware: () => middlewares, // directly use the middlewares from enhanceReduxMiddleware
  // enhancers: [applyMiddleware(...middlewares)], // use compose directly as an enhancer
  // devTools: devToolsOptions,
});

export default store;

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Action creators for updating geojson and columns
export const setGeojson = (geojson: FeatureCollection): SetGeojsonAction => ({
  type: SET_GEOJSON,
  payload: geojson,
});

export const setColumns = (columns: Field[]): SetColumnsAction => ({
  type: SET_COLUMNS,
  payload: columns,
});
