import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface BackendToolInfo {
    id: string;
    name: string;
    version: string;
    executionPolicy: string;
}

/**
 * Settings State
 * Simple, flat structure - no over-engineering
 */
export interface SettingsState {
    // Visualization
    defaultMapStyle: 'light' | 'dark' | 'satellite';
    defaultColorScheme: string;

    // Data Management
    autoSaveEnabled: boolean;
    maxDatasetSizeMB: number;

    // Debug
    debugMode: boolean;
    showPerformanceMetrics: boolean;

    // Backend
    backendUrl: string;
    backendAvailable: boolean;
    backendTools: BackendToolInfo[];

}

const initialState: SettingsState = {
    // Sensible defaults
    defaultMapStyle: 'light',
    defaultColorScheme: 'viridis',
    autoSaveEnabled: true,
    maxDatasetSizeMB: 10,
    debugMode: false,
    showPerformanceMetrics: false,
    backendUrl: (import.meta.env.VITE_BACKEND_URL as string) || '/api',
    backendAvailable: false,
    backendTools: [],
};

// Load from localStorage if available
const loadSettingsFromStorage = (): SettingsState => {
    try {
        const stored = localStorage.getItem('time-geography-kepler:settings');
        if (stored) {
            const parsed = JSON.parse(stored);
            // Merge with defaults to handle new settings
            return { ...initialState, ...parsed };
        }
    } catch (error) {
        console.error('Failed to load settings from localStorage:', error);
    }
    return initialState;
};

const settingsSlice = createSlice({
    name: 'settings',
    initialState: loadSettingsFromStorage(),
    reducers: {
        updateSettings: (state, action: PayloadAction<Partial<SettingsState>>) => {
            Object.assign(state, action.payload);
            // Persist to localStorage
            try {
                localStorage.setItem('time-geography-kepler:settings', JSON.stringify(state));
            } catch (error) {
                console.error('Failed to save settings to localStorage:', error);
            }
        },
        resetSettings: () => {
            // Clear localStorage
            try {
                localStorage.removeItem('time-geography-kepler:settings');
            } catch (error) {
                console.error('Failed to clear settings from localStorage:', error);
            }
            return initialState;
        },
        toggleDebugMode: (state) => {
            state.debugMode = !state.debugMode;
            try {
                localStorage.setItem('time-geography-kepler:settings', JSON.stringify(state));
            } catch (error) {
                console.error('Failed to save settings to localStorage:', error);
            }
        },
        toggleAutoSave: (state) => {
            state.autoSaveEnabled = !state.autoSaveEnabled;
            try {
                localStorage.setItem('time-geography-kepler:settings', JSON.stringify(state));
            } catch (error) {
                console.error('Failed to save settings to localStorage:', error);
            }
        },
        setBackendStatus: (state, action: PayloadAction<boolean>) => {
            state.backendAvailable = action.payload;
        },
        setBackendTools: (state, action: PayloadAction<BackendToolInfo[]>) => {
            state.backendTools = action.payload;
        },
    }
});

export const {
    updateSettings,
    resetSettings,
    toggleDebugMode,
    toggleAutoSave,
    setBackendStatus,
    setBackendTools,
} = settingsSlice.actions;

export default settingsSlice.reducer;
