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
import { Database, ChevronLeft, ChevronRight } from 'lucide-react';

const AppContent = () => {
  const dataSources = useSelector((state: RootState) => Object.values(state.data.dataSources));
  const [isDataPanelOpen, setIsDataPanelOpen] = useState(false);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Clean up any pending progress operations
      progressService.reset();
    };
  }, []);

  // Auto-open data panel when data is uploaded
  useEffect(() => {
    if (dataSources.length > 0 && !isDataPanelOpen) {
      setIsDataPanelOpen(true);
    }
  }, [dataSources.length, isDataPanelOpen]);

  const dataPanelWidth = isDataPanelOpen ? 320 : 0;
  const workflowWidth = 400;
  const mapWidth = window.innerWidth - workflowWidth - dataPanelWidth;
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

        {/* Middle: Workflow container */}
        <div 
          className={`bg-gray-50 h-full overflow-hidden relative z-10 border-l border-r border-gray-200 shadow-lg transition-all duration-300 ${
            isDataPanelOpen ? 'shadow-lg' : 'shadow-xl'
          }`}
          style={{ width: workflowWidth }}
        >
          <WorkflowContainer />
        </div>

        {/* Right side: Collapsible Data Panel */}
        <div 
          className="relative h-full transition-all duration-300 ease-in-out"
          style={{ width: isDataPanelOpen ? 320 : 0 }}
        >
          {/* Data Panel */}
          <div 
            className="bg-white h-full border-l border-gray-200 shadow-lg absolute right-0 top-0 z-10 transition-all duration-300 ease-in-out"
            style={{ 
              width: 320,
              transform: isDataPanelOpen ? 'translateX(0)' : 'translateX(100%)'
            }}
          >
            <DataPanel />
          </div>
        </div>

        {/* Floating Data Panel Toggle Button */}
        <Button
          variant="outline"
          size="sm"
          className={`fixed top-20 z-30 transition-all duration-300 shadow-lg hover:shadow-xl ${
            isDataPanelOpen 
              ? 'right-[324px]' 
              : 'right-2'
          }`}
          onClick={() => setIsDataPanelOpen(!isDataPanelOpen)}
          title={isDataPanelOpen ? 'Hide data panel' : 'Show data panel'}
        >
          <Database className="w-4 h-4 mr-1" />
          {isDataPanelOpen ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
          {!isDataPanelOpen && (
            <span className="ml-1">
              Data ({dataSources.length})
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
