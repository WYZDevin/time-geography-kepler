import { useState, useCallback, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useAppSelector } from '../../stores/store';
import type { AppDispatch } from '../../stores/store';
import {
  selectAllDataSources,
  selectSelectedDataSourceIds,
  selectDataSource,
  deselectDataSource,
  clearSelection,
  clearAll,
  loadProjectData
} from '../../stores/data-slice';
import { uploadDataFromFile, removeDataSourceWithCleanup } from '../../stores/data-thunks';
import {
  saveProject,
  exportProject,
  importProject,
  clearProject,
  getStorageInfo,
  type StorageInfo
} from '../../services/persistence-service';
import { CSVUploadDialog } from '../csv-upload/csv-upload-dialog';
import { ResearchAreaControl } from '../research-area/research-area-control';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Database,
  Upload,
  Trash2,
  MoreVertical,
  Calendar,
  MapPin,
  Plus,
  Loader2,
  CheckCircle,
  AlertCircle,
  FileText,
  Save,
  FolderOpen,
  Download,
  HardDrive,
  Search,
  SortAsc,
  Table,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useDropzone } from 'react-dropzone';

interface DataPanelProps {
  className?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  message?: string;
  dataSourceId?: string;
}

const DataPanel: React.FC<DataPanelProps> = ({ className = '', isCollapsed = false, onToggleCollapse }) => {
  const dispatch = useDispatch<AppDispatch>();
  const dataSources = useAppSelector(selectAllDataSources);
  const selectedIds = useAppSelector(selectSelectedDataSourceIds);

  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo>({
    usedBytes: 0,
    usedMB: 0,
    percentUsed: 0,
    itemCount: 0,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');
  const [showCSVDialog, setShowCSVDialog] = useState(false);
  const [showUploadOptionsDialog, setShowUploadOptionsDialog] = useState(false);

  // Update storage info when data changes
  useEffect(() => {
    getStorageInfo().then(setStorageInfo).catch(() => { /* ignore */ });
  }, [dataSources]);

  // Filter and sort data sources
  const filteredAndSortedDataSources = dataSources
    .filter((ds) =>
      ds.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'date':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'size':
          return b.featureCount - a.featureCount;
        default:
          return 0;
      }
    });

  const handleToggleSelection = (dataSourceId: string) => {
    if (selectedIds.includes(dataSourceId)) {
      dispatch(deselectDataSource(dataSourceId));
    } else {
      dispatch(selectDataSource(dataSourceId));
    }
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

  // Upload functionality
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setUploadState({ status: 'uploading', message: 'Processing file...' });

    try {
      const result = await dispatch(uploadDataFromFile(file)).unwrap();
      
      setUploadState({
        status: 'success',
        message: `Successfully uploaded ${result.featureCount} features`,
        dataSourceId: result.id
      });

      // Auto-hide upload section after successful upload
      setTimeout(() => {
        setShowUploadSection(false);
        setUploadState({ status: 'idle' });
      }, 2000);

    } catch (error) {
      console.error('Upload error:', error);
      setUploadState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Upload failed'
      });
    }
  }, [dispatch]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/json': ['.json', '.geojson'],
    },
    multiple: false,
  });

  const getUploadStatusIcon = () => {
    switch (uploadState.status) {
      case 'uploading':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Upload className="w-4 h-4" />;
    }
  };

  const getUploadStatusColor = () => {
    switch (uploadState.status) {
      case 'uploading':
        return 'border-blue-300 bg-blue-50';
      case 'success':
        return 'border-green-300 bg-green-50';
      case 'error':
        return 'border-red-300 bg-red-50';
      default:
        return 'border-gray-300 hover:border-gray-400';
    }
  };

  // Persistence handlers
  const handleSaveProject = async () => {
    try {
      const dataSourcesObj = dataSources.reduce((acc, ds) => {
        acc[ds.id] = ds;
        return acc;
      }, {} as Record<string, typeof dataSources[0]>);
      await saveProject(dataSourcesObj, selectedIds);
      alert('Project saved successfully!');
      setStorageInfo(await getStorageInfo());
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save project');
    }
  };

  const handleExportProject = () => {
    try {
      const dataSourcesObj = dataSources.reduce((acc, ds) => {
        acc[ds.id] = ds;
        return acc;
      }, {} as Record<string, typeof dataSources[0]>);
      exportProject(dataSourcesObj, selectedIds);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to export project');
    }
  };

  const handleImportProject = async (file: File) => {
    try {
      const projectData = await importProject(file);
      dispatch(loadProjectData({
        dataSources: projectData.dataSources,
        selectedIds: projectData.selectedIds,
      }));
      alert(`Project imported successfully! Loaded ${Object.keys(projectData.dataSources).length} data sources.`);
      setStorageInfo(await getStorageInfo());
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to import project');
    }
  };

  const handleClearAll = async () => {
    if (dataSources.length === 0) {
      alert('No data to clear');
      return;
    }

    const confirmed = confirm(
      `Are you sure you want to clear all ${dataSources.length} data sources?\n\nThis will also clear saved data from storage.`
    );

    if (confirmed) {
      dispatch(clearAll());
      await clearProject();
      setStorageInfo(await getStorageInfo());
      alert('All data cleared successfully!');
    }
  };

  // File input for importing
  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        await handleImportProject(file);
      }
    };
    input.click();
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="p-4 border-b bg-white flex-shrink-0 overflow-visible relative z-50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database className="w-5 h-5" />
            Data Sources
            {dataSources.length > 0 && (
              <span className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                {dataSources.length}
              </span>
            )}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1"
              onClick={() => setShowUploadOptionsDialog(true)}
            >
              <Plus className="w-4 h-4" />
              Upload
            </Button>

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-1">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[9999]">
                <DropdownMenuItem onClick={handleSaveProject}>
                  <Save className="w-4 h-4 mr-2" />
                  Save Project
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleImportClick}>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Load Project
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportProject}>
                  <Download className="w-4 h-4 mr-2" />
                  Export Project
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleClearAll}
                  className="text-red-600"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear All Data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {onToggleCollapse && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleCollapse}
                className="h-8 w-8 p-0"
                title={isCollapsed ? 'Expand data sources' : 'Collapse data sources'}
              >
                {isCollapsed ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <>
        {/* Statistics */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="text-center p-2 bg-gray-50 rounded">
            <div className="font-semibold">{dataSources.length}</div>
            <div className="text-gray-600">Sources</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded">
            <div className="font-semibold">{selectedIds.length}</div>
            <div className="text-gray-600">Selected</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded">
            <div className="flex items-center justify-center gap-1">
              <HardDrive className="w-3 h-3" />
              <span className="font-semibold">{storageInfo.usedMB} MB</span>
            </div>
            <div className="text-gray-600 text-xs">
              {storageInfo.percentUsed.toFixed(0)}% used
            </div>
          </div>
        </div>

        {/* Search and Sort */}
        {dataSources.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search data sources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <SortAsc className="w-4 h-4 text-gray-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'date' | 'size')}
                className="text-sm border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="date">Sort by Date (newest first)</option>
                <option value="name">Sort by Name (A-Z)</option>
                <option value="size">Sort by Size (largest first)</option>
              </select>
            </div>
          </div>
        )}

        {/* Upload Section */}
        {showUploadSection && (
          <div className="mt-4 space-y-3">
            <Card className={`transition-all duration-200 ${getUploadStatusColor()}`}>
              <CardContent className="p-4">
                <div
                  {...getRootProps()}
                  className={`cursor-pointer p-4 border-2 border-dashed rounded-lg text-center transition-all duration-200 ${
                    isDragActive ? 'border-blue-400 bg-blue-50 scale-105' : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input {...getInputProps()} />

                  <div className="flex flex-col items-center space-y-2">
                    {getUploadStatusIcon()}

                    <div>
                      <h4 className="font-medium text-sm mb-1">
                        {isDragActive ? 'Drop your file here' : 'Drag & drop or click to upload'}
                      </h4>
                      <p className="text-xs text-gray-600 mb-2">
                        Supports GeoJSON (.json, .geojson) files
                      </p>

                      {uploadState.message && (
                        <div className={`text-xs font-medium ${
                          uploadState.status === 'error' ? 'text-red-600' :
                          uploadState.status === 'success' ? 'text-green-600' :
                          'text-blue-600'
                        }`}>
                          {uploadState.message}
                        </div>
                      )}
                    </div>

                    {uploadState.status === 'idle' && (
                      <Button variant="outline" size="sm" disabled={isDragActive}>
                        <FileText className="w-3 h-3 mr-1" />
                        Choose File
                      </Button>
                    )}
                  </div>
                </div>

              </CardContent>
            </Card>
          </div>
        )}
          </>
        )}
      </div>

      {!isCollapsed && (
        <>
      {/* Data Sources List */}
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
        <ResearchAreaControl />
        {dataSources.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No data sources</p>
            <p className="text-sm mb-4">Click the "Upload" button above to add your data</p>
          </div>
        ) : filteredAndSortedDataSources.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No matching data sources</p>
            <p className="text-sm">Try a different search term</p>
          </div>
        ) : (
          filteredAndSortedDataSources.map((dataSource) => (
            <Card
              key={dataSource.id}
              onClick={() => toggleExpanded(dataSource.id)}
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedIds.includes(dataSource.id) ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(dataSource.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleToggleSelection(dataSource.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded"
                    />
                    <Database className="w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm truncate">
                        {dataSource.name}
                      </CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">
                          {formatFileSize(dataSource.featureCount)}
                        </span>
                        {dataSource.derivedFrom && (
                          <Badge variant="secondary" className="text-xs">
                            Derived
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>

              {expandedSources.has(dataSource.id) && (
                <CardContent className="pt-0">
                  <div className="space-y-3 text-sm">
                    {/* Basic Info */}
                    <div className="space-y-1 text-xs text-gray-600">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(dataSource.createdAt).toLocaleString()}
                      </div>

                      {dataSource.bounds && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          Bounds: [{dataSource.bounds.minLat.toFixed(3)}, {dataSource.bounds.minLng.toFixed(3)}] to [{dataSource.bounds.maxLat.toFixed(3)}, {dataSource.bounds.maxLng.toFixed(3)}]
                        </div>
                      )}

                      {dataSource.createdBy && (
                        <div className="text-xs">
                          Created by: {dataSource.createdBy}
                        </div>
                      )}

                      {dataSource.derivedFrom && (
                        <div className="text-xs">
                          Derived from: {dataSources.find(ds => ds.id === dataSource.derivedFrom)?.name || dataSource.derivedFrom}
                        </div>
                      )}
                    </div>

                    {/* Properties Preview */}
                    {dataSource.data.features.length > 0 && (
                      <div className="border-t pt-2">
                        <div className="font-medium text-xs mb-2 text-gray-700">Properties</div>
                        <div className="space-y-1">
                          {Object.entries(dataSource.data.features[0].properties || {}).slice(0, 5).map(([key, value]) => (
                            <div key={key} className="flex items-start gap-2 text-xs">
                              <span className="font-mono text-gray-600 min-w-[80px]">{key}:</span>
                              <span className="text-gray-800 truncate flex-1">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </span>
                            </div>
                          ))}
                          {Object.keys(dataSource.data.features[0].properties || {}).length > 5 && (
                            <div className="text-xs text-gray-500 italic">
                              +{Object.keys(dataSource.data.features[0].properties || {}).length - 5} more properties
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Geometry Type */}
                    {dataSource.data.features.length > 0 && (
                      <div className="border-t pt-2">
                        <div className="font-medium text-xs mb-1 text-gray-700">Geometry</div>
                        <div className="text-xs text-gray-600">
                          Type: {dataSource.data.features[0].geometry?.type || 'Unknown'}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>

      {/* Footer Actions */}
      {selectedIds.length > 0 && (
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {selectedIds.length} selected
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch(clearSelection())}
              >
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirm(`Delete ${selectedIds.length} selected data sources?`)) {
                    selectedIds.forEach(id => dispatch(removeDataSourceWithCleanup(id) as any));
                  }
                }}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Upload Options Dialog */}
      <Dialog open={showUploadOptionsDialog} onOpenChange={setShowUploadOptionsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Data</DialogTitle>
            <DialogDescription>
              Choose how you want to add data to your project
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-4"
              onClick={() => {
                setShowUploadOptionsDialog(false);
                setShowUploadSection(true);
              }}
            >
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 mt-0.5" />
                <div className="text-left">
                  <div className="font-semibold">GeoJSON File</div>
                  <div className="text-sm text-muted-foreground">
                    Upload a .json or .geojson file
                  </div>
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start h-auto py-4"
              onClick={() => {
                setShowUploadOptionsDialog(false);
                setShowCSVDialog(true);
              }}
            >
              <div className="flex items-start gap-3">
                <Table className="w-5 h-5 mt-0.5" />
                <div className="text-left">
                  <div className="font-semibold">CSV File</div>
                  <div className="text-sm text-muted-foreground">
                    Upload a CSV file with coordinate columns
                  </div>
                </div>
              </div>
            </Button>

          </div>
        </DialogContent>
      </Dialog>

      {/* CSV Upload Dialog */}
      {showCSVDialog && (
        <CSVUploadDialog
          onClose={() => setShowCSVDialog(false)}
          onSuccess={(_dataSourceId) => {
            setShowCSVDialog(false);
            getStorageInfo().then(setStorageInfo).catch(() => { /* ignore */ });
          }}
        />
      )}
    </div>
  );
};

export default DataPanel;