import { createAsyncThunk } from '@reduxjs/toolkit';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { ToolUtils } from '@/tools/tool-utils';
import { DataSource, addDataSource } from './data-slice';

/**
 * Upload new data source
 */
export const uploadData = createAsyncThunk<
  DataSource,
  { name: string; data: FeatureCollection }
>(
  'data/upload',
  async (params, { dispatch }) => {
    // Validate
    if (!ToolUtils.isValidGeoJSON(params.data)) {
      throw new Error('Invalid GeoJSON data');
    }

    // Calculate bounds
    const bounds = ToolUtils.getBounds(params.data.features) || undefined;

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

/**
 * Upload data from file
 */
export const uploadDataFromFile = createAsyncThunk<
  DataSource,
  File
>(
  'data/uploadFile',
  async (file, { dispatch }) => {
    // File size limit: 10MB
    const MAX_FILE_SIZE = 10 * 1024 * 1024;

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum size is 10MB.`);
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.json') && !fileName.endsWith('.geojson')) {
      throw new Error('Invalid file type. Please upload a .json or .geojson file.');
    }

    // Read file content
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      throw new Error('Failed to read file. The file may be corrupted.');
    }

    // Validate JSON structure
    if (!text.trim()) {
      throw new Error('File is empty.');
    }

    let data: FeatureCollection;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Invalid JSON format: ${errMsg}. Please check that your file contains valid JSON.`);
    }

    // Validate GeoJSON structure
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data structure. Expected a GeoJSON object.');
    }

    if (data.type !== 'FeatureCollection') {
      throw new Error(`Invalid GeoJSON type: "${data.type}". Expected "FeatureCollection".`);
    }

    if (!Array.isArray(data.features)) {
      throw new Error('Invalid GeoJSON: Missing or invalid "features" array.');
    }

    if (data.features.length === 0) {
      throw new Error('GeoJSON FeatureCollection is empty (0 features). Please upload a file with data.');
    }

    const result = await dispatch(uploadData({
      name: file.name.replace(/\.[^/.]+$/, ''), // Remove file extension
      data
    }));

    return result.payload as DataSource;
  }
);