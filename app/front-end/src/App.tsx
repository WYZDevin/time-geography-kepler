import { useEffect, useState } from 'react';
import { shallowEqual, useSelector } from 'react-redux';
import { RootState } from './stores/store';
import { AppProvider } from './contexts/app-context';
import WorkflowContainer from './components/workflow/workflow-container';
import DataPanel from './components/data-panel/data-panel';
import ProgressDialog from './components/custom-components/progress-bar';
import { progressService } from './components/custom-components/progress-bar';
import { Button } from './components/ui/button';
import { ChevronLeft, ChevronDown, Settings as SettingsIcon, X, Database } from 'lucide-react';
import { DebugTools } from './components/debug-tools';
import { ErrorBoundary } from './components/error-boundary';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useBackendInit } from './hooks/use-backend-init';
import SettingsPanel from './components/settings/settings-panel';
import { DeckMapView } from './components/deck-map-view';
import {
  Dialog,
  DialogContent,
} from './components/ui/dialog';


const AppContent = () => {
  const dataSources = useSelector(
    (state: RootState) => Object.values(state.data.dataSources),
    shallowEqual,
  );
  const settings = useSelector((state: RootState) => state.settings);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  const [isToolboxCollapsed, setIsToolboxCollapsed] = useState(false);
  const [isDataPanelOpen, setIsDataPanelOpen] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  const [hasAutoOpenedSidePanel, setHasAutoOpenedSidePanel] = useState(false);

  const isDark = settings.defaultMapStyle === 'dark';

  // Enable keyboard shortcuts
  useKeyboardShortcuts();

  // Initialize backend connection (health check + tool discovery)
  useBackendInit();

  // Clean up on unmount
  useEffect(() => {
    return () => {
      progressService.reset();
    };
  }, []);

  // Auto-open side panel when data is uploaded (only once, allow manual closing afterwards)
  useEffect(() => {
    if (dataSources.length > 0 && !hasAutoOpenedSidePanel) {
      setIsSidePanelOpen(true);
      setHasAutoOpenedSidePanel(true);
    }
  }, [dataSources.length, hasAutoOpenedSidePanel]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const sidePanelWidth = isSidePanelOpen ? 600 : 0;
  const mapWidth = window.innerWidth - sidePanelWidth;
  const mapHeight = window.innerHeight - 80;


  return (
    <>
      {/* Horizontal header across the top of the page */}
      <header className="w-full bg-gradient-to-r from-blue-600 to-indigo-800 text-white p-3 shadow-md flex justify-between items-center">
        <div className="flex items-center">
          <h1 className="text-xl font-bold mr-4">Space-Time Analytics Platform</h1>
          <span className="text-sm border-l border-white/30 pl-4">Analyzing, visualizing, and exploring space-time data</span>
        </div>
        <div className="flex items-center text-sm space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettingsPanel(true)}
            className="text-white hover:bg-white/20"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <span className="text-sm">v2.0.0</span>
          <div className="flex items-center">
            <span>Created by </span>
            <img src={'/gispark.png'} alt="GISPark" className="h-10 mr-2" />
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-60px)] w-full overflow-hidden">
        <ProgressDialog />
        
        {/* Left side: deck.gl map */}
        <div className="flex-1 relative h-full">
          <div className="absolute top-0 left-0 w-full h-full z-0">
            <DeckMapView width={mapWidth} height={mapHeight} />
          </div>
        </div>

        {/* Right side: Merged Side Panel (Workflow + Data) */}
        <div
          className="relative h-full"
          style={{ width: isSidePanelOpen ? 600 : 0, overflow: isSidePanelOpen ? 'visible' : 'hidden' }}
        >
          {/* Merged Side Panel */}
          <div
            className="bg-gray-50 h-full border-l border-gray-200 shadow-lg absolute right-0 top-0 z-10 transition-transform duration-300 ease-in-out"
            style={{
              width: 600,
              transform: isSidePanelOpen ? 'translateX(0)' : 'translateX(100%)'
            }}
          >
            {/* Panel Content — workflow takes full height */}
            <div className="h-full flex flex-col relative overflow-visible">
              {/* Workflow Section */}
              <div className={`flex-1 min-h-0 transition-all duration-300`}>
                {!isToolboxCollapsed ? (
                  <WorkflowContainer
                    onCollapse={() => setIsToolboxCollapsed(true)}
                    isCollapsible={true}
                  />
                ) : (
                  <div className="h-full flex items-center justify-between px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50">
                    <div className="flex items-center">
                      <SettingsIcon className="w-4 h-4 mr-2 text-blue-600" />
                      <span className="text-sm font-semibold text-gray-700">Analysis Tools</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsToolboxCollapsed(false)}
                      className="h-6 w-6 p-0 hover:bg-blue-100"
                      title="Expand toolbox"
                    >
                      <ChevronDown className="w-4 h-4 text-blue-600" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Data Sources Button — anchored to panel's left edge */}
              <Button
                variant="outline"
                size="sm"
                className="absolute bottom-2 -left-[calc(theme(spacing.2)+100%)] z-20 shadow-lg hover:shadow-xl bg-white border-gray-300 hover:bg-gray-50 gap-2"
                style={{ left: -8, transform: 'translateX(-100%)' }}
                onClick={() => setIsDataPanelOpen(true)}
                title="Data Sources"
              >
                <Database className="w-4 h-4" />
                <span className="text-sm">Data</span>
                {dataSources.length > 0 && (
                  <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                    {dataSources.length}
                  </span>
                )}
              </Button>

              {/* Bottom Right Collapse Button for Entire Panel */}
              <Button
                variant="outline"
                size="sm"
                className="absolute bottom-2 right-2 z-20 h-8 w-8 p-0 shadow-lg hover:shadow-xl bg-white border-gray-300 hover:bg-gray-50"
                onClick={() => setIsSidePanelOpen(false)}
                title="Hide side panel"
              >
                <X className="w-4 h-4 text-gray-600" />
              </Button>
            </div>
          </div>
        </div>

        {/* Floating Side Panel Show Button (only when panel is closed) */}
        {!isSidePanelOpen && (
          <Button
            variant="outline"
            size="sm"
            className="fixed bottom-4 right-4 z-50 shadow-lg hover:shadow-xl bg-white border-gray-300 hover:bg-gray-50"
            onClick={() => setIsSidePanelOpen(true)}
            title="Show side panel"
          >
            <SettingsIcon className="w-4 h-4 mr-2" />
            <span className="text-sm">
              Tools & Data ({dataSources.length})
            </span>
            <ChevronLeft className="w-4 h-4 ml-2" />
          </Button>
        )}

      </div>

      {/* Data Sources Dialog */}
      <Dialog open={isDataPanelOpen} onOpenChange={setIsDataPanelOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] p-0 pt-8 overflow-hidden">
          <DataPanel className="h-[70vh]" />
        </DialogContent>
      </Dialog>

      {/* Settings Panel */}
      {showSettingsPanel && (
        <SettingsPanel onClose={() => setShowSettingsPanel(false)} />
      )}
    </>
  );
};

const App = () => {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
        <DebugTools />
      </AppProvider>
    </ErrorBoundary>
  );
};

export default App;
