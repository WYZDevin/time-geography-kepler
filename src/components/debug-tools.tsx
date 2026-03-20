import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../stores/store';
import { toolRegistry } from '../utils/tool-registry';
import { SimpleTool } from '../interfaces/simple-tool';

export const DebugTools: React.FC = () => {
    const debugMode = useSelector((state: RootState) => state.settings.debugMode);
    const [tools, setTools] = useState<SimpleTool[]>([]);
    const [toolCount, setToolCount] = useState(0);

    // Don't render if debug mode is off
    if (!debugMode) {
        return null;
    }

    useEffect(() => {
        // Initial check
        const updateTools = () => {
            const allTools = toolRegistry.getAllTools();
            setTools(allTools);
            setToolCount(toolRegistry.getToolCount());
            console.log('Debug: Tool registry status', {
                count: toolRegistry.getToolCount(),
                tools: allTools,
                ids: toolRegistry.getToolIds()
            });
        };

        updateTools();

        // Check periodically for debugging
        const interval = setInterval(updateTools, 2000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="fixed bottom-4 right-4 bg-black bg-opacity-75 text-white p-4 rounded-lg shadow-lg max-w-sm">
            <h3 className="font-bold text-sm mb-2">Tool Registry Debug</h3>
            <div className="text-xs space-y-1">
                <div>Total tools: {toolCount}</div>
                {tools.length > 0 ? (
                    <div>
                        <div className="font-semibold mt-2">Registered tools:</div>
                        {tools.map(tool => (
                            <div key={tool.id} className="ml-2">
                                • {tool.name} ({tool.id})
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-red-300">No tools registered!</div>
                )}
            </div>
        </div>
    );
};