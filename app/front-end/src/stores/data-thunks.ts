import { createAsyncThunk } from '@reduxjs/toolkit';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { ToolUtils } from '@/tools/tool-utils';
import { DataSource, addDataSource, removeDataSource } from './data-slice';
import { setLargeFile, deleteLargeFile } from '@/services/large-file-cache';
import { saveLargeFile, deleteLargeFileFromDB } from '@/services/persistence-service';

/**
 * Upload new data source
 */
export const uploadData = createAsyncThunk<
  DataSource,
  { name: string; data: FeatureCollection; bounds?: DataSource['bounds'] }
>(
  'data/upload',
  async (params, { dispatch }) => {
    // Validate
    if (!ToolUtils.isValidGeoJSON(params.data)) {
      throw new Error('Invalid GeoJSON data');
    }

    // Caller may supply pre-computed bounds (or skip them for large datasets)
    const bounds = params.bounds ?? (ToolUtils.getBounds(params.data.features) || undefined);

    // Create data source
    const dataSource: DataSource = {
      id: ToolUtils.generateId('data'),
      name: params.name,
      data: params.data,
      createdAt: new Date().toISOString(),
      featureCount: params.data.features.length,
      bounds
    };

    // Add to store
    dispatch(addDataSource(dataSource));

    return dataSource;
  }
);

/**
 * Save analysis result as new data source
 */
export const saveAnalysisResult = createAsyncThunk(
  'data/saveResult',
  async (params: {
    name: string;
    data: FeatureCollection;
    parentId?: string;
    toolId?: string;
  }, { dispatch }) => {
    // Validate
    if (!ToolUtils.isValidGeoJSON(params.data)) {
      throw new Error('Invalid analysis result data');
    }

    const bounds = ToolUtils.getBounds(params.data.features) || undefined;
    
    const dataSource: DataSource = {
      id: ToolUtils.generateId('result'),
      name: params.name,
      data: params.data,
      createdAt: new Date().toISOString(),
      featureCount: params.data.features.length,
      bounds,
      derivedFrom: params.parentId,
      createdBy: params.toolId
    };
    
    dispatch(addDataSource(dataSource));
    
    return dataSource;
  }
);

// Large-file threshold: above this we skip getBounds and pre-freeze the data
// to avoid O(N) work during Redux/immer processing.
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50 MB
const MAX_FILE_SIZE = 500 * 1024 * 1024;        // 500 MB hard cap

/**
 * Upload data from file
 */
export const uploadDataFromFile = createAsyncThunk<
  DataSource,
  File
>(
  'data/uploadFile',
  async (file, { dispatch }) => {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`
      );
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.json') && !fileName.endsWith('.geojson')) {
      throw new Error('Invalid file type. Please upload a .json or .geojson file.');
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      throw new Error('Failed to read file. The file may be corrupted.');
    }

    if (!text.trim()) throw new Error('File is empty.');

    let data: FeatureCollection;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Invalid JSON format: ${msg}`);
    }

    if (!data || data.type !== 'FeatureCollection') {
      throw new Error(`Expected a GeoJSON FeatureCollection, got "${(data as any)?.type ?? typeof data}".`);
    }
    if (!Array.isArray(data.features) || data.features.length === 0) {
      throw new Error('GeoJSON FeatureCollection is empty.');
    }

    const isLarge = file.size > LARGE_FILE_THRESHOLD;

    // Pre-extract field names before any mutation/freezing.
    const fieldNames = data.features.length > 0
      ? Object.keys(data.features[0].properties ?? {})
      : [];

    if (isLarge) {
      // Store the real data in the module-level cache; Redux holds only a
      // lightweight stub so immer never has to walk 1 M+ features.
      const id = ToolUtils.generateId('data');
      setLargeFile(id, data);
      // Persist the payload so it survives a reload (the Redux stub alone would
      // leave the dataset selectable but data-less). Fire-and-forget; a failed
      // write only costs the rehydration-after-reload, not the current session.
      saveLargeFile(id, data).catch(err =>
        console.error('[large-file] failed to persist dataset to IndexedDB:', err),
      );

      const stub: FeatureCollection = { type: 'FeatureCollection', features: [] };
      const bounds = undefined; // skip for large env files

      const dataSource: DataSource = {
        id,
        name: file.name.replace(/\.[^/.]+$/, ''),
        data: stub,
        fieldNames,
        createdAt: new Date().toISOString(),
        featureCount: data.features.length,
        bounds,
      };
      dispatch(addDataSource(dataSource));
      return dataSource;
    }

    // Small file: normal path — full data in Redux.
    const bounds = ToolUtils.getBounds(data.features) || undefined;

    const result = await dispatch(uploadData({
      name: file.name.replace(/\.[^/.]+$/, ''),
      data,
      bounds,
    }));

    return result.payload as DataSource;
  }
);

/**
 * Remove a data source and evict any cached large-file data.
 */
export const removeDataSourceWithCleanup = createAsyncThunk<void, string>(
  'data/removeWithCleanup',
  async (id, { dispatch }) => {
    deleteLargeFile(id);
    deleteLargeFileFromDB(id).catch(err =>
      console.error('[large-file] failed to evict dataset from IndexedDB:', err),
    );
    dispatch(removeDataSource(id));
  }
);