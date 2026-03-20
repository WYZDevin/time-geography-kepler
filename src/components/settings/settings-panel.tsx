import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../stores/store';
import { updateSettings, resetSettings, toggleDebugMode, toggleAutoSave } from '../../stores/settings-slice';
import { Button } from '../ui/button';
import { X, RotateCcw } from 'lucide-react';

interface SettingsPanelProps {
    onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
    const dispatch = useDispatch();
    const settings = useSelector((state: RootState) => state.settings);

    const handleReset = () => {
        if (confirm('Reset all settings to defaults?')) {
            dispatch(resetSettings());
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-800">Settings</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6">
                    {/* Visualization Settings */}
                    <section className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                            <span className="w-1 h-5 bg-blue-600 rounded mr-3"></span>
                            Visualization
                        </h3>

                        <div className="space-y-4">
                            {/* Map Style */}
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="text-sm font-medium text-gray-700">
                                        Default Map Style
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Base map appearance for new visualizations
                                    </p>
                                </div>
                                <select
                                    value={settings.defaultMapStyle}
                                    onChange={(e) =>
                                        dispatch(
                                            updateSettings({
                                                defaultMapStyle: e.target.value as 'light' | 'dark' | 'satellite',
                                            })
                                        )
                                    }
                                    className="ml-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="light">Light</option>
                                    <option value="dark">Dark</option>
                                    <option value="satellite">Satellite</option>
                                </select>
                            </div>

                            {/* Color Scheme */}
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="text-sm font-medium text-gray-700">
                                        Default Color Scheme
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Color palette for visualizations
                                    </p>
                                </div>
                                <select
                                    value={settings.defaultColorScheme}
                                    onChange={(e) =>
                                        dispatch(updateSettings({ defaultColorScheme: e.target.value }))
                                    }
                                    className="ml-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="viridis">Viridis</option>
                                    <option value="plasma">Plasma</option>
                                    <option value="inferno">Inferno</option>
                                    <option value="blues">Blues</option>
                                    <option value="greens">Greens</option>
                                    <option value="reds">Reds</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* Data Management Settings */}
                    <section className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                            <span className="w-1 h-5 bg-green-600 rounded mr-3"></span>
                            Data Management
                        </h3>

                        <div className="space-y-4">
                            {/* Auto-save */}
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="text-sm font-medium text-gray-700">
                                        Auto-save
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Automatically save project data to browser storage
                                    </p>
                                </div>
                                <button
                                    onClick={() => dispatch(toggleAutoSave())}
                                    className={`
                                        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                                        ${settings.autoSaveEnabled ? 'bg-blue-600' : 'bg-gray-300'}
                                    `}
                                >
                                    <span
                                        className={`
                                            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                                            ${settings.autoSaveEnabled ? 'translate-x-6' : 'translate-x-1'}
                                        `}
                                    />
                                </button>
                            </div>

                            {/* Max Dataset Size */}
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="text-sm font-medium text-gray-700">
                                        Max Dataset Size (MB)
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Warn when uploading files larger than this size
                                    </p>
                                </div>
                                <input
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={settings.maxDatasetSizeMB}
                                    onChange={(e) =>
                                        dispatch(
                                            updateSettings({ maxDatasetSizeMB: parseInt(e.target.value) || 10 })
                                        )
                                    }
                                    className="ml-4 w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                    </section>

                    {/* Advanced Settings */}
                    <section className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                            <span className="w-1 h-5 bg-purple-600 rounded mr-3"></span>
                            Advanced
                        </h3>

                        <div className="space-y-4">
                            {/* Debug Mode */}
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="text-sm font-medium text-gray-700">
                                        Debug Mode
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Show detailed console logs and error messages
                                    </p>
                                </div>
                                <button
                                    onClick={() => dispatch(toggleDebugMode())}
                                    className={`
                                        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                                        ${settings.debugMode ? 'bg-blue-600' : 'bg-gray-300'}
                                    `}
                                >
                                    <span
                                        className={`
                                            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                                            ${settings.debugMode ? 'translate-x-6' : 'translate-x-1'}
                                        `}
                                    />
                                </button>
                            </div>

                            {/* Performance Metrics */}
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="text-sm font-medium text-gray-700">
                                        Show Performance Metrics
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Display analysis execution time and memory usage
                                    </p>
                                </div>
                                <button
                                    onClick={() =>
                                        dispatch(
                                            updateSettings({ showPerformanceMetrics: !settings.showPerformanceMetrics })
                                        )
                                    }
                                    className={`
                                        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                                        ${settings.showPerformanceMetrics ? 'bg-blue-600' : 'bg-gray-300'}
                                    `}
                                >
                                    <span
                                        className={`
                                            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                                            ${settings.showPerformanceMetrics ? 'translate-x-6' : 'translate-x-1'}
                                        `}
                                    />
                                </button>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReset}
                        className="flex items-center space-x-2"
                    >
                        <RotateCcw className="w-4 h-4" />
                        <span>Reset to Defaults</span>
                    </Button>
                    <Button variant="default" size="sm" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default SettingsPanel;
