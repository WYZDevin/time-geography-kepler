/**
 * Local Storage Persistence Service
 * Simple, dumb serialization - no over-engineering
 */

import { DataSource } from '../stores/data-slice';

// Storage keys
const STORAGE_KEY_PREFIX = 'time-geography-kepler';
const DATA_SOURCES_KEY = `${STORAGE_KEY_PREFIX}:data-sources`;
const SELECTED_IDS_KEY = `${STORAGE_KEY_PREFIX}:selected-ids`;
const VERSION_KEY = `${STORAGE_KEY_PREFIX}:version`;
const CURRENT_VERSION = '1.0.0';

// Storage limits (localStorage typically has 5-10MB limit)
const MAX_STORAGE_SIZE = 5 * 1024 * 1024; // 5MB warning threshold

export interface ProjectData {
  version: string;
  dataSources: Record<string, DataSource>;
  selectedIds: string[];
  savedAt: string;
}

export interface StorageInfo {
  usedBytes: number;
  usedMB: number;
  percentUsed: number;
  itemCount: number;
}

/**
 * Save project data to localStorage
 */
export const saveProject = (
  dataSources: Record<string, DataSource>,
  selectedIds: string[]
): void => {
  try {
    const projectData: ProjectData = {
      version: CURRENT_VERSION,
      dataSources,
      selectedIds,
      savedAt: new Date().toISOString(),
    };

    // Serialize
    const serialized = JSON.stringify(projectData);

    // Check size before saving
    const sizeBytes = new Blob([serialized]).size;
    if (sizeBytes > MAX_STORAGE_SIZE) {
      throw new Error(
        `Project size (${(sizeBytes / 1024 / 1024).toFixed(2)}MB) exceeds recommended limit of ${MAX_STORAGE_SIZE / 1024 / 1024}MB. Consider removing some datasets.`
      );
    }

    // Save individual components for easier access
    localStorage.setItem(DATA_SOURCES_KEY, JSON.stringify(dataSources));
    localStorage.setItem(SELECTED_IDS_KEY, JSON.stringify(selectedIds));
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION);

  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'QuotaExceededError') {
        throw new Error('Storage quota exceeded. Please clear some data sources.');
      }
      throw error;
    }
    throw new Error('Failed to save project');
  }
};

/**
 * Load project data from localStorage
 */
export const loadProject = (): ProjectData | null => {
  try {
    const dataSourcesJson = localStorage.getItem(DATA_SOURCES_KEY);
    const selectedIdsJson = localStorage.getItem(SELECTED_IDS_KEY);
    const version = localStorage.getItem(VERSION_KEY);

    if (!dataSourcesJson) {
      return null; // No saved data
    }

    const dataSources = JSON.parse(dataSourcesJson) as Record<string, DataSource>;
    const selectedIds = selectedIdsJson ? JSON.parse(selectedIdsJson) as string[] : [];

    return {
      version: version || '1.0.0',
      dataSources,
      selectedIds,
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Failed to load project:', error);
    return null;
  }
};

/**
 * Clear all saved project data
 */
export const clearProject = (): void => {
  try {
    localStorage.removeItem(DATA_SOURCES_KEY);
    localStorage.removeItem(SELECTED_IDS_KEY);
    localStorage.removeItem(VERSION_KEY);
  } catch (error) {
    console.error('Failed to clear project:', error);
    throw new Error('Failed to clear saved data');
  }
};

/**
 * Get storage usage information
 */
export const getStorageInfo = (): StorageInfo => {
  try {
    let totalBytes = 0;
    let itemCount = 0;

    // Calculate size of our keys only
    const keys = [DATA_SOURCES_KEY, SELECTED_IDS_KEY, VERSION_KEY];

    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value) {
        totalBytes += new Blob([key, value]).size;
        itemCount++;
      }
    }

    const totalMB = totalBytes / 1024 / 1024;
    const percentUsed = (totalBytes / MAX_STORAGE_SIZE) * 100;

    return {
      usedBytes: totalBytes,
      usedMB: parseFloat(totalMB.toFixed(2)),
      percentUsed: parseFloat(percentUsed.toFixed(1)),
      itemCount,
    };
  } catch (error) {
    console.error('Failed to get storage info:', error);
    return {
      usedBytes: 0,
      usedMB: 0,
      percentUsed: 0,
      itemCount: 0,
    };
  }
};

/**
 * Check if there is saved data available
 */
export const hasSavedData = (): boolean => {
  return localStorage.getItem(DATA_SOURCES_KEY) !== null;
};

/**
 * Export project data as JSON file
 */
export const exportProject = (
  dataSources: Record<string, DataSource>,
  selectedIds: string[]
): void => {
  const projectData: ProjectData = {
    version: CURRENT_VERSION,
    dataSources,
    selectedIds,
    savedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(projectData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `time-geography-project-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();

  URL.revokeObjectURL(url);
};

/**
 * Import project data from JSON file
 */
export const importProject = (file: File): Promise<ProjectData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const projectData = JSON.parse(json) as ProjectData;

        // Validate structure
        if (!projectData.dataSources || !projectData.version) {
          reject(new Error('Invalid project file format'));
          return;
        }

        resolve(projectData);
      } catch (error) {
        reject(new Error('Failed to parse project file'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read project file'));
    };

    reader.readAsText(file);
  });
};
