/**
 * Redux middleware for auto-saving to localStorage
 * Saves data after mutations with debouncing
 */

import { Middleware } from '@reduxjs/toolkit';
import { saveProject } from '../services/persistence-service';

// Actions that trigger save
const SAVE_TRIGGER_ACTIONS = [
  'data/addDataSource',
  'data/removeDataSource',
  'data/clearAll',
  'data/loadProjectData',
];

// Debounce timeout
let saveTimeout: NodeJS.Timeout | null = null;
const SAVE_DEBOUNCE_MS = 1000; // Save 1 second after last change

/**
 * Middleware that auto-saves data state to localStorage
 */
export const persistenceMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);

  // Check if this action should trigger a save
  if (SAVE_TRIGGER_ACTIONS.includes((action as any).type)) {
    // Check if auto-save is enabled
    const state = store.getState();
    const autoSaveEnabled = state.settings?.autoSaveEnabled ?? true; // Default to true if settings not loaded

    if (!autoSaveEnabled) {
      console.log('[Persistence] Auto-save disabled, skipping save');
      return result;
    }

    // Clear existing timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Schedule save
    saveTimeout = setTimeout(() => {
      const state = store.getState();
      const { dataSources, selectedIds } = state.data;
      // saveProject is async (IndexedDB); never let a rejection break the app.
      saveProject(dataSources, selectedIds)
        .then(() => console.log('[Persistence] Auto-saved project data'))
        .catch((error) => console.error('[Persistence] Failed to auto-save:', error));
    }, SAVE_DEBOUNCE_MS);
  }

  return result;
};
