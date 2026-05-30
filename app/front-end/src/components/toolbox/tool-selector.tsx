import { useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../stores/store';
import { selectTool } from '../../stores/workflow-slice';
import { SimpleTool } from '../../interfaces/simple-tool';
import { toolRegistry } from '../../utils/tool-registry';
import { resolveToolCapabilities, ResolvedCapabilities } from '@/services/execution-resolver';
import { Button } from '@/components/ui/button';
import { Search, Clock } from 'lucide-react';

const ToolSelector = () => {
    const dispatch = useDispatch();
    const history = useSelector((state: RootState) => state.workflow.history);
    const backendAvailable = useSelector((state: RootState) => state.settings.backendAvailable);
    const backendTools = useSelector((state: RootState) => state.settings.backendTools);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');

    // Get recently used tools (unique by tool ID, most recent first)
    const recentlyUsedTools = useMemo(() => {
        const uniqueToolIds = new Set<string>();
        const recentTools: SimpleTool[] = [];

        for (const entry of history) {
            if (!uniqueToolIds.has(entry.toolId)) {
                const tool = toolRegistry.getTool(entry.toolId);
                if (tool) {
                    uniqueToolIds.add(entry.toolId);
                    recentTools.push(tool);
                    if (recentTools.length >= 3) break; // Limit to 3 most recent
                }
            }
        }

        return recentTools;
    }, [history]);

    const handleToolSelect = (tool: SimpleTool, caps: ResolvedCapabilities) => {
        if (caps.isDisabled) return;
        dispatch(selectTool(tool.id));
    };

    // Filter tools based on search and category
    const filteredTools = useMemo(() => {
        let tools = toolRegistry.getAllTools();

        // Filter by category
        if (selectedCategory !== 'all') {
            tools = tools.filter(t => t.category === selectedCategory);
        }

        // Filter by search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            tools = tools.filter(t =>
                t.name.toLowerCase().includes(query) ||
                t.description.toLowerCase().includes(query) ||
                t.category.toLowerCase().includes(query)
            );
        }

        return tools;
    }, [searchQuery, selectedCategory]);

    const renderToolCard = (tool: SimpleTool) => {
        const caps = resolveToolCapabilities(tool.id, backendAvailable, backendTools);

        const executionBadge = () => {
            if (caps.isDisabled) {
                return <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Server offline</span>;
            }
            if (caps.canRunFrontend && caps.canRunBackend) {
                return <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">Browser & Server</span>;
            }
            if (caps.canRunFrontend) {
                return <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">Browser</span>;
            }
            if (caps.canRunBackend) {
                return <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-800">Server</span>;
            }
            return null;
        };

        return (
            <div
                key={tool.id}
                className={`bg-white rounded-lg shadow-sm transition-shadow duration-200 p-4 border mb-3 ${
                    caps.isDisabled
                        ? 'opacity-50 cursor-not-allowed border-gray-200'
                        : 'hover:shadow-md cursor-pointer border-gray-200 hover:border-blue-300'
                }`}
                onClick={() => handleToolSelect(tool, caps)}
            >
                <div className="flex items-start space-x-3">
                    <span className="text-2xl flex-shrink-0 mt-1">{tool.icon}</span>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-800 leading-tight mb-1">{tool.name}</h3>
                        <p className="text-xs text-gray-600 mb-2 line-clamp-2">{tool.description}</p>

                        <div className="space-y-1">
                            <div className="flex flex-wrap gap-1">
                                <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded">
                                    {tool.category}
                                </span>
                                {executionBadge()}
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-400">
                                    {caps.isDisabled ? 'Backend server required' : 'Click to select'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const categories: Array<{ id: string; label: string }> = [
        { id: 'all', label: 'All Tools' },
        { id: 'visualization', label: 'Visualization' },
        { id: 'analysis', label: 'Analysis' },
        { id: 'processing', label: 'Processing' }
    ];

    return (
        <div className="h-full flex flex-col p-4 overflow-auto bg-white">
            <div className="mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-100">
                <h1 className="text-lg font-bold text-gray-800 mb-1">Select Analysis Tool</h1>
                <p className="text-xs text-gray-600">Choose a tool for your space-time data analysis</p>
            </div>

            {/* Search Bar */}
            <div className="mb-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search tools by name or description..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Category Tabs */}
            <div className="mb-4 flex flex-wrap gap-2">
                {categories.map(category => (
                    <button
                        key={category.id}
                        onClick={() => setSelectedCategory(category.id)}
                        className={`
                            px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                            ${selectedCategory === category.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }
                        `}
                    >
                        {category.label}
                    </button>
                ))}
            </div>

            <div className="flex-1">
                {/* Recently Used Section */}
                {recentlyUsedTools.length > 0 && selectedCategory === 'all' && !searchQuery && (
                    <div className="mb-6">
                        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
                            <Clock className="w-4 h-4 mr-2 text-purple-600" />
                            Recently Used
                        </h2>
                        <div className="space-y-2">
                            {recentlyUsedTools.map(renderToolCard)}
                        </div>
                    </div>
                )}

                {/* All Tools Section */}
                {filteredTools.length > 0 ? (
                    <div className="space-y-2">
                        {filteredTools.map(renderToolCard)}
                    </div>
                ) : (
                    <div className="text-center py-8">
                        <p className="text-gray-500 text-sm">No tools found matching your search.</p>
                    </div>
                )}
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
