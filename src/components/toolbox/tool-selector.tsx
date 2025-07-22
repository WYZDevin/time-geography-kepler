import React from 'react';
import { useDispatch } from 'react-redux';
import { selectTool } from '../../stores/workflow-slice';
import { getToolsByCategory } from '../../tools';
import { BaseTool } from '../../interfaces/tool-interfaces';
import { Button } from '@/components/ui/button';

const ToolSelector = () => {
    const dispatch = useDispatch();

    const handleToolSelect = (tool: BaseTool) => {
        dispatch(selectTool(tool));
    };

    const renderToolCard = (tool: BaseTool) => (
        <div
            key={tool.id}
            className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 p-4 cursor-pointer border border-gray-200 hover:border-blue-300 mb-3"
            onClick={() => handleToolSelect(tool)}
        >
            <div className="flex items-start space-x-3">
                <span className="text-2xl flex-shrink-0 mt-1">{tool.icon}</span>
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-800 leading-tight mb-1">{tool.name}</h3>
                    <p className="text-xs text-gray-600 mb-2 line-clamp-2">{tool.description}</p>
                    
                    <div className="space-y-1">
                        <div className="flex flex-wrap gap-1">
                            {tool.requiredFields.slice(0, 2).map(field => (
                                <span key={field} className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded">
                                    {field}
                                </span>
                            ))}
                            {tool.requiredFields.length > 2 && (
                                <span className="text-xs text-gray-500">+{tool.requiredFields.length - 2} more</span>
                            )}
                        </div>
                        
                        <div className="flex items-center justify-between">
                            <span className="inline-block bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs px-2 py-0.5 rounded-full">
                                {tool.category}
                            </span>
                            <span className="text-xs text-gray-400">Click to select</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const categories: BaseTool['category'][] = ['visualization', 'analysis', 'processing'];

    return (
        <div className="h-full flex flex-col p-4 overflow-auto bg-white">
            <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-100">
                <h1 className="text-lg font-bold text-gray-800 mb-1">Select Analysis Tool</h1>
                <p className="text-xs text-gray-600">Choose a tool for your space-time data analysis</p>
            </div>

            <div className="flex-1">
                {categories.map(category => {
                    const toolsInCategory = getToolsByCategory(category);
                    if (toolsInCategory.length === 0) return null;

                    return (
                        <div key={category} className="mb-6">
                            <h2 className="text-sm font-semibold text-gray-700 mb-3 capitalize flex items-center">
                                <span className="w-4 h-0.5 bg-gradient-to-r from-blue-500 to-indigo-600 rounded mr-2"></span>
                                {category}
                            </h2>
                            <div className="space-y-2">
                                {toolsInCategory.map(renderToolCard)}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <h3 className="text-xs font-semibold text-blue-800 mb-1">Need Help?</h3>
                    <p className="text-xs text-blue-600 mb-2">
                        Each tool requires specific data fields. Ensure your dataset contains the required fields.
                    </p>
                    <Button variant="outline" size="sm" className="w-full text-xs border-blue-300 text-blue-700 hover:bg-blue-50">
                        View Documentation
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ToolSelector; 