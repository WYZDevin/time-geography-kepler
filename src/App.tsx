import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from './stores/store';
import { AppProvider } from './contexts/app-context';
import WorkflowContainer from './components/workflow/workflow-container';
import DataPanel from './components/data-panel/data-panel';
import KeplerGl from '@kepler.gl/components';
import ProgressDialog from './components/custom-components/progress-bar';
import { progressService } from './components/custom-components/progress-bar';
import { Button } from './components/ui/button';
import { Database, ChevronLeft, ChevronRight, Settings } from 'lucide-react';

const AppContent = () => {
  const dataSources = useSelector((state: RootState) => Object.values(state.data.dataSources));
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  
  const [hasAutoOpenedSidePanel, setHasAutoOpenedSidePanel] = useState(false);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Clean up any pending progress operations
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

  const sidePanelWidth = isSidePanelOpen ? 400 : 0;
  const mapWidth = window.innerWidth - sidePanelWidth;
  const keplerHeight = window.innerHeight - 80;


  return (
    <>
      {/* Horizontal header across the top of the page */}
      <header className="w-full bg-gradient-to-r from-blue-600 to-indigo-800 text-white p-3 shadow-md flex justify-between items-center">
        <div className="flex items-center">
          <h1 className="text-xl font-bold mr-4">Space-Time Analytics Platform</h1>
          <span className="text-sm border-l border-white/30 pl-4">Analyzing, visualizing, and exploring space-time data</span>
        </div>
        <div className="flex items-center text-sm">
          <span className="mr-4">v2.0.0</span>
          <span>Created by </span>
          <img src={'/gispark.png'} alt="GISPark" className="h-10 mr-2" />
        </div>
      </header>

      <div className="flex h-[calc(100vh-60px)] w-full overflow-hidden">
        <ProgressDialog />
        
        {/* Left side: Kepler.gl map */}
        <div className="flex-1 relative h-full">
          <div className="absolute top-0 left-0 w-full h-full z-0">
            <KeplerGl
              width={mapWidth}
              height={keplerHeight}
              id="kepler"
              mapboxApiAccessToken=""
              theme="light"
              mapStyle={{
                styleType: 'positron',
              }}
            />
          </div>
        </div>

        {/* Right side: Merged Side Panel (Workflow + Data) */}
        <div 
          className="relative h-full overflow-hidden"
          style={{ width: isSidePanelOpen ? 400 : 0 }}
        >
          {/* Merged Side Panel */}
          <div 
            className="bg-gray-50 h-full border-l border-gray-200 shadow-lg absolute right-0 top-0 z-10 transition-transform duration-300 ease-in-out"
            style={{ 
              width: 400,
              transform: isSidePanelOpen ? 'translateX(0)' : 'translateX(100%)'
            }}
          >
            {/* Merged Panel Content */}
            <div className="h-full flex flex-col">
              {/* Workflow Section - Top 70% */}
              <div className="flex-[7] border-b border-gray-300 min-h-0">
                <WorkflowContainer />
              </div>
              
              {/* Data Section - Bottom 30% */}
              <div className="flex-[3] bg-white min-h-0">
                <div className="h-full flex flex-col">
                  <div className="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100 flex-shrink-0">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                      <Database className="w-4 h-4 mr-2 text-blue-600" />
                      Data Sources
                      {dataSources.length > 0 && (
                        <span className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                          {dataSources.length}
                        </span>
                      )}
                    </h3>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <DataPanel />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Floating Side Panel Toggle Button */}
        <Button
          variant="outline"
          size="sm"
          className="fixed top-20 z-50 transition-all duration-300 shadow-lg hover:shadow-xl"
          style={{
            right: isSidePanelOpen ? '404px' : '8px'
          }}
          onClick={() => setIsSidePanelOpen(!isSidePanelOpen)}
          title={isSidePanelOpen ? 'Hide side panel' : 'Show side panel'}
        >
          <Settings className="w-4 h-4 mr-1" />
          {isSidePanelOpen ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
          {!isSidePanelOpen && (
            <span className="ml-1">
              Tools & Data ({dataSources.length})
            </span>
          )}
        </Button>
      </div>
    </>
  );
};

const App = () => {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default App;
