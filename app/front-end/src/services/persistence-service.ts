/**
 * Project persistence service (IndexedDB-backed).
 *
 * Datasets are multi-MB GeoJSON, which overflows the browser's ~5 MB
 * localStorage quota. IndexedDB has a far larger quota (typically hundreds of
 * MB) and stores structured objects directly, so we use it as the source of
 * truth. The public API is async; callers await it.
 */

import { DataSource } from '../stores/data-slice';
import { FeatureCollection } from '../interfaces/data-interfaces';

// Keys (shared between the IndexedDB store and the legacy localStorage layer
// we migrate away from).
const STORAGE_KEY_PREFIX = 'time-geography-kepler';
const DATA_SOURCES_KEY = `${STORAGE_KEY_PREFIX}:data-sources`;
// Large-file payloads are stored one-per-key (not inside DATA_SOURCES_KEY) so
// the project blob stays small and immer never walks them.
const LARGE_FILE_PREFIX = `${STORAGE_KEY_PREFIX}:large-file:`;
const SELECTED_IDS_KEY = `${STORAGE_KEY_PREFIX}:selected-ids`;
const VERSION_KEY = `${STORAGE_KEY_PREFIX}:version`;
const CURRENT_VERSION = '1.0.0';

// Fallback quota used only for the storage-usage indicator when the browser
// does not expose navigator.storage.estimate().
const FALLBACK_QUOTA = 50 * 1024 * 1024;

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

// ---------------------------------------------------------------------------
// Minimal IndexedDB key/value wrapper (single object store)
// ---------------------------------------------------------------------------

const DB_NAME = STORAGE_KEY_PREFIX;
const STORE_NAME = 'kv';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSetMany(entries: Array<[string, unknown]>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const [key, value] of entries) store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function idbDelete(keys: string[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * One-time migration of any project saved by the old localStorage layer into
 * IndexedDB, then clear the localStorage copies so they stop consuming the
 * 5 MB bucket. No-op once migrated.
 */
async function migrateFromLocalStorage(): Promise<void> {
  let legacy: string | null;
  try {
    legacy = localStorage.getItem(DATA_SOURCES_KEY);
  } catch {
    return; // localStorage unavailable (private mode etc.) — nothing to migrate
  }
  if (!legacy) return;

  try {
    const alreadyMigrated = await idbGet(DATA_SOURCES_KEY);
    if (alreadyMigrated == null) {
      const dataSources = JSON.parse(legacy) as Record<string, DataSource>;
      const selectedIdsRaw = localStorage.getItem(SELECTED_IDS_KEY);
      const selectedIds = selectedIdsRaw ? (JSON.parse(selectedIdsRaw) as string[]) : [];
      await idbSetMany([
        [DATA_SOURCES_KEY, dataSources],
        [SELECTED_IDS_KEY, selectedIds],
        [VERSION_KEY, CURRENT_VERSION],
      ]);
      console.log('[Persistence] Migrated project from localStorage to IndexedDB');
    }
    localStorage.removeItem(DATA_SOURCES_KEY);
    localStorage.removeItem(SELECTED_IDS_KEY);
    localStorage.removeItem(VERSION_KEY);
  } catch (error) {
    console.warn('[Persistence] localStorage→IndexedDB migration skipped:', error);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save project data to IndexedDB. Datasets are stored as structured objects in
 * a single transaction (atomic), with no size cap beyond the browser quota.
 */
export const saveProject = async (
  dataSources: Record<string, DataSource>,
  selectedIds: string[]
): Promise<void> => {
  try {
    await idbSetMany([
      [DATA_SOURCES_KEY, dataSources],
      [SELECTED_IDS_KEY, selectedIds],
      [VERSION_KEY, CURRENT_VERSION],
    ]);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please remove some data sources.');
    }
    throw error instanceof Error ? error : new Error('Failed to save project');
  }
};

/**
 * Persist a large-file payload (the full GeoJSON kept out of Redux) so it
 * survives a page reload. Stored under its own key, keyed by dataset id.
 */
export const saveLargeFile = async (id: string, data: FeatureCollection): Promise<void> => {
  try {
    await idbSetMany([[LARGE_FILE_PREFIX + id, data]]);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please remove some data sources.');
    }
    throw error instanceof Error ? error : new Error('Failed to save dataset');
  }
};

/**
 * Load a persisted large-file payload by dataset id (undefined if absent).
 */
export const loadLargeFile = async (id: string): Promise<FeatureCollection | undefined> => {
  return idbGet<FeatureCollection>(LARGE_FILE_PREFIX + id);
};

/**
 * Remove a persisted large-file payload by dataset id.
 */
export const deleteLargeFileFromDB = async (id: string): Promise<void> => {
  await idbDelete([LARGE_FILE_PREFIX + id]);
};

/**
 * Load saved project data from IndexedDB (migrating from localStorage first).
 */
export const loadProject = async (): Promise<ProjectData | null> => {
  try {
    await migrateFromLocalStorage();

    const dataSources = await idbGet<Record<string, DataSource>>(DATA_SOURCES_KEY);
    if (!dataSources) return null;

    const selectedIds = (await idbGet<string[]>(SELECTED_IDS_KEY)) ?? [];
    const version = (await idbGet<string>(VERSION_KEY)) ?? CURRENT_VERSION;

    return {
      version,
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
 * Clear all saved project data.
 */
export const clearProject = async (): Promise<void> => {
  try {
    await idbDelete([DATA_SOURCES_KEY, SELECTED_IDS_KEY, VERSION_KEY]);
  } catch (error) {
    console.error('Failed to clear project:', error);
    throw new Error('Failed to clear saved data');
  }
};

/**
 * Get storage usage information for the saved datasets.
 */
export const getStorageInfo = async (): Promise<StorageInfo> => {
  try {
    const dataSources = await idbGet<Record<string, DataSource>>(DATA_SOURCES_KEY);
    const usedBytes = dataSources ? new Blob([JSON.stringify(dataSources)]).size : 0;
    const itemCount = dataSources ? Object.keys(dataSources).length : 0;

    let quota = FALLBACK_QUOTA;
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota) quota = estimate.quota;
    } catch {
      /* estimate() unsupported — keep fallback */
    }

    const usedMB = usedBytes / 1024 / 1024;
    const percentUsed = quota > 0 ? (usedBytes / quota) * 100 : 0;

    return {
      usedBytes,
      usedMB: parseFloat(usedMB.toFixed(2)),
      percentUsed: parseFloat(percentUsed.toFixed(1)),
      itemCount,
    };
  } catch (error) {
    console.error('Failed to get storage info:', error);
    return { usedBytes: 0, usedMB: 0, percentUsed: 0, itemCount: 0 };
  }
};

/**
 * Check whether there is saved data available.
 */
export const hasSavedData = async (): Promise<boolean> => {
  return (await idbGet(DATA_SOURCES_KEY)) != null;
};

/**
 * Export project data as a downloadable JSON file. Operates on the in-memory
 * state passed in, so it stays synchronous.
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
 * Import project data from a JSON file.
 */
export const importProject = (file: File): Promise<ProjectData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const projectData = JSON.parse(json) as ProjectData;

        if (!projectData.dataSources || !projectData.version) {
          reject(new Error('Invalid project file format'));
          return;
        }

        resolve(projectData);
      } catch {
        reject(new Error('Failed to parse project file'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read project file'));
    };

    reader.readAsText(file);
  });
};
