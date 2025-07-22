import { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../stores/store';
import { 
  selectAllDataSources, 
  selectActiveDataSource, 
  selectDataStatistics,
  setActiveDataSource,
  removeDataSource,
  setDataViewMode,
  toggleDataSelection,
} from '../../stores/data-slice';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { 
  Database, 
  Upload, 
  Trash2, 
  Eye, 
 
  MoreVertical,
  Calendar,
  MapPin,
  Activity,
  List,
  TreePine,
  Clock
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface DataPanelProps {
  className?: string;
}

const DataPanel: React.FC<DataPanelProps> = ({ className = '' }) => {
  const dispatch = useDispatch();
  const dataSources = useSelector(selectAllDataSources);
  const activeDataSource = useSelector(selectActiveDataSource);
  const statistics = useSelector(selectDataStatistics);
  const { dataViewMode, selectedDataIds } = useSelector((state: RootState) => state.data);

  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  const handleSetActive = (dataSourceId: string) => {
    dispatch(setActiveDataSource(dataSourceId));
  };

  const handleRemove = (dataSourceId: string) => {
    if (confirm('Are you sure you want to remove this data source?')) {
      dispatch(removeDataSource(dataSourceId));
    }
  };

  const handleToggleSelection = (dataSourceId: string) => {
    dispatch(toggleDataSelection(dataSourceId));
  };

  const handleViewModeChange = (mode: 'list' | 'tree' | 'timeline') => {
    dispatch(setDataViewMode(mode));
  };

  const toggleExpanded = (dataSourceId: string) => {
    const newExpanded = new Set(expandedSources);
    if (newExpanded.has(dataSourceId)) {
      newExpanded.delete(dataSourceId);
    } else {
      newExpanded.add(dataSourceId);
    }
    setExpandedSources(newExpanded);
  };

  const formatFileSize = (features: number) => {
    if (features < 1000) return `${features} features`;
    if (features < 1000000) return `${(features / 1000).toFixed(1)}K features`;
    return `${(features / 1000000).toFixed(1)}M features`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'uploaded': return <Upload className="w-4 h-4" />;
      case 'processed': return <Activity className="w-4 h-4" />;
      case 'generated': return <Database className="w-4 h-4" />;
      default: return <Database className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'uploaded': return 'bg-blue-100 text-blue-800';
      case 'processed': return 'bg-green-100 text-green-800';
      case 'generated': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="p-4 border-b bg-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database className="w-5 h-5" />
            Data Sources
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant={dataViewMode === 'list' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleViewModeChange('list')}
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={dataViewMode === 'tree' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleViewModeChange('tree')}
            >
              <TreePine className="w-4 h-4" />
            </Button>
            <Button
              variant={dataViewMode === 'timeline' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleViewModeChange('timeline')}
            >
              <Clock className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="text-center p-2 bg-gray-50 rounded">
            <div className="font-semibold">{statistics.totalDataSources}</div>
            <div className="text-gray-600">Sources</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded">
            <div className="font-semibold">{formatFileSize(statistics.totalFeatures)}</div>
            <div className="text-gray-600">Total</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded">
            <div className="font-semibold">{selectedDataIds.length}</div>
            <div className="text-gray-600">Selected</div>
          </div>
        </div>
      </div>

      {/* Data Sources List */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {dataSources.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No data sources</p>
            <p className="text-sm mb-4">Upload data using the workflow panel to get started</p>
            <div className="text-xs text-gray-400 bg-gray-50 p-3 rounded-lg">
              <p>💡 Tip: Use the "Data Upload" step in the workflow to add your trajectory data</p>
            </div>
          </div>
        ) : (
          dataSources.map((dataSource) => (
            <Card 
              key={dataSource.id}
              className={`cursor-pointer transition-all ${
                activeDataSource?.id === dataSource.id 
                  ? 'ring-2 ring-blue-500 bg-blue-50' 
                  : 'hover:shadow-md'
              } ${
                selectedDataIds.includes(dataSource.id)
                  ? 'ring-1 ring-green-500'
                  : ''
              }`}
              onClick={() => handleSetActive(dataSource.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="checkbox"
                      checked={selectedDataIds.includes(dataSource.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleToggleSelection(dataSource.id);
                      }}
                      className="rounded"
                    />
                    {getTypeIcon(dataSource.type)}
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm truncate">
                        {dataSource.name}
                      </CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge 
                          variant="secondary" 
                          className={`text-xs ${getTypeColor(dataSource.type)}`}
                        >
                          {dataSource.type}
                        </Badge>
                        <span className="text-xs text-gray-500">
                          {formatFileSize(dataSource.data.features.length)}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => handleSetActive(dataSource.id)}>
                        <Eye className="w-4 h-4 mr-2" />
                        Set Active
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleExpanded(dataSource.id)}>
                        <Activity className="w-4 h-4 mr-2" />
                        {expandedSources.has(dataSource.id) ? 'Collapse' : 'Expand'}
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleRemove(dataSource.id)}
                        className="text-red-600"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>

              {expandedSources.has(dataSource.id) && (
                <CardContent className="pt-0">
                  <div className="space-y-2 text-sm">
                    {/* Tags */}
                    {dataSource.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {dataSource.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="space-y-1 text-xs text-gray-600">
                      {dataSource.metadata.uploadedAt && (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(dataSource.metadata.uploadedAt).toLocaleDateString()}
                        </div>
                      )}
                      
                      {dataSource.metadata.statistics?.spatialBounds && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          Spatial bounds available
                        </div>
                      )}

                      {dataSource.metadata.statistics?.temporalBounds && (
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(dataSource.metadata.statistics.temporalBounds.start).toLocaleDateString()} - 
                          {new Date(dataSource.metadata.statistics.temporalBounds.end).toLocaleDateString()}
                        </div>
                      )}

                      {dataSource.metadata.processedBy && (
                        <div className="text-xs">
                          Processed by: {dataSource.metadata.processedBy}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>

      {/* Footer Actions */}
      {selectedDataIds.length > 0 && (
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {selectedDataIds.length} selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                Export
              </Button>
              <Button variant="outline" size="sm">
                Merge
              </Button>
              <Button variant="destructive" size="sm">
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataPanel;