import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import progressReducer from './progress-slice';
import metadataReducer from './metadata-slice';
import workflowReducer from './workflow-slice';
import dataReducer from './data-slice';
import settingsReducer from './settings-slice';
import mapReducer from './map-slice';
import researchAreaReducer from './research-area-slice';
import prismExplorerReducer from './prism-explorer-slice';
import pinReducer from './pin-slice';
import { persistenceMiddleware } from './persistence-middleware';

const store = configureStore({
  reducer: {
    map: mapReducer,
    researchArea: researchAreaReducer,
    prismExplorer: prismExplorerReducer,
    pin: pinReducer,
    metadata: metadataReducer,
    progress: progressReducer,
    workflow: workflowReducer,
    data: dataReducer,
    settings: settingsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // GeoJSON datasets stored in the map slice contain large coordinate arrays
      // that are expensive to deep-check and are always plain serializable data.
      serializableCheck: {
        ignoredActions: ['map/addDatasets', 'map/setLayers', 'map/addLayers'],
        ignoredPaths: ['map.datasets'],
      },
      immutableCheck: {
        ignoredPaths: ['map.datasets'],
      },
    }).concat(persistenceMiddleware),
});

export default store;

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
