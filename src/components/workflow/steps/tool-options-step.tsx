import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../../stores/store';
import { setToolOptions, proceedToVisualization } from '../../../stores/workflow-slice';
import { Button } from '@/components/ui/button';
import { toolRegistry } from '../../../utils/tool-registry';
import { ToolOption } from '../../../interfaces/tool-interfaces';

const ToolOptionsStep = () => {
    const dispatch = useDispatch();
    const { selectedTool } = useSelector((state: RootState) => state.workflow);
    const [options, setOptions] = useState<Record<string, boolean | string | number>>({});

    // Initialize options with default values when tool changes
    useEffect(() => {
        if (selectedTool) {
            const toolInstance = toolRegistry.getTool(selectedTool.id);
            if (toolInstance && toolInstance.options) {
                const defaultOptions: Record<string, any> = {};
                toolInstance.options.forEach(option => {
                    if (option.defaultValue !== undefined) {
                        defaultOptions[option.key] = option.defaultValue;
                    }
                });
                setOptions(defaultOptions);
            }
        }
    }, [selectedTool]);

    const handleOptionChange = (key: string, value: boolean | string | number) => {
        setOptions(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const handleSubmit = () => {
        dispatch(setToolOptions(options));
        dispatch(proceedToVisualization());
    };

    const renderOptionInput = (option: ToolOption) => {
        const value = options[option.key] ?? option.defaultValue;

        switch (option.type) {
            case 'boolean':
                return (
                    <div key={option.key} className="flex items-center justify-between">
                        <div>
                            <label className="text-xs font-medium text-gray-700">
                                {option.label}
                            </label>
                            {option.description && (
                                <p className="text-xs text-gray-500 mt-1">{option.description}</p>
                            )}
                        </div>
                        <input
                            type="checkbox"
                            checked={value || false}
                            onChange={(e) => handleOptionChange(option.key, e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                        />
                    </div>
                );

            case 'number':
                const numOption = option as any;
                return (
                    <div key={option.key}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            {option.label}
                        </label>
                        {option.description && (
                            <p className="text-xs text-gray-500 mb-2">{option.description}</p>
                        )}
                        <input
                            type="number"
                            value={value || numOption.defaultValue || 0}
                            onChange={(e) => {
                                const newValue = parseFloat(e.target.value);
                                handleOptionChange(option.key, isNaN(newValue) ? 0 : newValue);
                            }}
                            className="w-full p-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            min={numOption.min}
                            max={numOption.max}
                            step={numOption.step || 1}
                        />
                    </div>
                );

            case 'string':
                return (
                    <div key={option.key}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            {option.label}
                        </label>
                        {option.description && (
                            <p className="text-xs text-gray-500 mb-2">{option.description}</p>
                        )}
                        <input
                            type="text"
                            value={value || option.defaultValue || ''}
                            onChange={(e) => handleOptionChange(option.key, e.target.value)}
                            className="w-full p-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                );

            case 'select':
                const selectOption = option as any;
                return (
                    <div key={option.key}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            {option.label}
                        </label>
                        {option.description && (
                            <p className="text-xs text-gray-500 mb-2">{option.description}</p>
                        )}
                        <select
                            value={value || selectOption.defaultValue || ''}
                            onChange={(e) => handleOptionChange(option.key, e.target.value)}
                            className="w-full p-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            {selectOption.options?.map((opt: any) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                );

            default:
                return null;
        }
    };

    const renderOptionsForTool = () => {
        if (!selectedTool) return null;

        const toolInstance = toolRegistry.getTool(selectedTool.id);
        if (!toolInstance || !toolInstance.options || toolInstance.options.length === 0) {
            return (
                <div className="text-center py-6">
                    <p className="text-xs text-gray-500">No specific options available for this tool.</p>
                </div>
            );
        }

        return (
            <div className="space-y-4">
                {toolInstance.options.map(option => renderOptionInput(option))}
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col p-4 overflow-auto">
            <div className="mb-4">
                <h1 className="text-lg font-bold text-gray-800 mb-1">Configure Options</h1>
                <p className="text-xs text-gray-600">
                    Customize settings for <strong>{selectedTool?.name}</strong>
                </p>
            </div>

            <div className="flex-1">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
                    <div className="mb-4">
                        <div className="flex items-center mb-2">
                            <span className="text-lg mr-2">{selectedTool?.icon}</span>
                            <h3 className="text-sm font-semibold text-gray-800">
                                {selectedTool?.name}
                            </h3>
                        </div>
                        <p className="text-xs text-gray-600 mb-4">
                            {selectedTool?.description}
                        </p>
                    </div>

                    {renderOptionsForTool()}
                </div>
            </div>

            <div className="pt-3 border-t border-gray-200">
                <Button 
                    onClick={handleSubmit}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-sm"
                >
                    Start Analysis
                </Button>
            </div>
        </div>
    );
};

export default ToolOptionsStep; 