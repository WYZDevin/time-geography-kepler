import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../stores/store';
import { rerunFromHistory, clearHistory, setSelectedDataSource, proceedToVisualization } from '../../stores/workflow-slice';
import { Button } from '../ui/button';
import { History, Play, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { toolRegistry } from '@/utils/tool-registry';

const WorkflowHistoryPanel: React.FC = () => {
    const dispatch = useDispatch();
    const history = useSelector((state: RootState) => state.workflow.history);
    const dataSources = useSelector((state: RootState) => state.data.dataSources);
    const [isExpanded, setIsExpanded] = useState(false);

    const handleRerun = (historyId: string) => {
        const entry = history.find(h => h.id === historyId);
        dispatch(rerunFromHistory(historyId));

        // Restore selectedData from data slice using the stored dataSourceId
        if (entry) {
            const dataSource = dataSources[entry.dataSourceId];
            if (dataSource) {
                dispatch(setSelectedDataSource({
                    dataSourceId: entry.dataSourceId,
                    data: dataSource.data
                }));
            }
        }

        // Auto-proceed to visualization after setting up
        setTimeout(() => {
            dispatch(proceedToVisualization());
        }, 100);
    };

    const handleClearHistory = () => {
        if (confirm('Clear all workflow history?')) {
            dispatch(clearHistory());
        }
    };

    const formatTimestamp = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    if (history.length === 0) {
        return null;
    }

    return (
        <div className="bg-white border-b border-gray-200">
            {/* Header */}
            <div
                className="px-4 py-3 bg-gradient-to-r from-purple-50 to-pink-50 flex items-center justify-between cursor-pointer hover:bg-purple-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center space-x-2">
                    <History className="w-4 h-4 text-purple-600" />
                    <span className="text-sm font-semibold text-gray-700">
                        Workflow History
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                        {history.length}
                    </span>
                </div>
                <div className="flex items-center space-x-2">
                    {history.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleClearHistory();
                            }}
                            className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Clear
                        </Button>
                    )}
                    {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-500" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                </div>
            </div>

            {/* History List */}
            {isExpanded && (
                <div className="max-h-64 overflow-auto">
                    {history.map((entry) => {
                        const tool = toolRegistry.getTool(entry.toolId);
                        if (!tool) return null;
                        return (
                            <div
                                key={entry.id}
                                className="px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center space-x-2 mb-1">
                                            <span className="text-lg">{tool.icon}</span>
                                            <span className="text-sm font-medium text-gray-800">
                                                {tool.name}
                                            </span>
                                            <span className="text-xs text-gray-400">
                                                {formatTimestamp(entry.timestamp)}
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-600 ml-7">
                                            Data: {entry.dataSourceId}
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRerun(entry.id)}
                                        className="h-7 px-2 text-xs flex items-center space-x-1 ml-2"
                                    >
                                        <Play className="w-3 h-3" />
                                        <span>Rerun</span>
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default WorkflowHistoryPanel;
