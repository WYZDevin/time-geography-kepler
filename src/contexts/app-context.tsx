import React, { createContext, useContext, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../stores/store';
import { DataService, createDataService } from '../services/data-service';
import { ToolManager, createToolManager } from '../services/tool-manager';
import { AnalysisRunner, createAnalysisRunner } from '../services/analysis-runner';
import { TimeGeographyTool } from '../tools/time-geography-tool';

interface AppContextType {
  dataService: DataService | null;
  toolManager: ToolManager | null;
  analysisRunner: AnalysisRunner | null;
  isInitialized: boolean;
}

const AppContext = createContext<AppContextType>({
  dataService: null,
  toolManager: null,
  analysisRunner: null,
  isInitialized: false,
});

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};

interface AppProviderProps {
  children: React.ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const dispatch = useDispatch();
  const [services, setServices] = useState<AppContextType>({
    dataService: null,
    toolManager: null,
    analysisRunner: null,
    isInitialized: false,
  });

  useEffect(() => {
    const initializeServices = async () => {
      try {
        console.log('Initializing application services...');

        // Initialize data service
        const dataService = createDataService(dispatch);
        console.log('✓ Data service initialized');

        // Initialize tool manager
        const toolManager = createToolManager(dataService);
        console.log('✓ Tool manager initialized');

        // Register built-in tools
        const timeGeographyTool = new TimeGeographyTool();
        toolManager.registerTool(timeGeographyTool);
        console.log('✓ Time geography tool registered');

        // Initialize analysis runner
        const analysisRunner = createAnalysisRunner(dataService, toolManager, dispatch);
        console.log('✓ Analysis runner initialized');

        // Sample data generation is now handled through the UI
        // Users can generate sample data via the upload step if needed

        setServices({
          dataService,
          toolManager,
          analysisRunner,
          isInitialized: true,
        });

        console.log('🚀 Application services initialized successfully');

      } catch (error) {
        console.error('Failed to initialize application services:', error);
        setServices(prev => ({ ...prev, isInitialized: false }));
      }
    };

    initializeServices();
  }, [dispatch]);

  return (
    <AppContext.Provider value={services}>
      {children}
    </AppContext.Provider>
  );
};

// Hook for accessing specific services
export const useDataService = () => {
  const { dataService } = useAppContext();
  if (!dataService) {
    throw new Error('DataService not available. Make sure AppProvider is initialized.');
  }
  return dataService;
};

export const useToolManager = () => {
  const { toolManager } = useAppContext();
  if (!toolManager) {
    throw new Error('ToolManager not available. Make sure AppProvider is initialized.');
  }
  return toolManager;
};

export const useAnalysisRunner = () => {
  const { analysisRunner } = useAppContext();
  if (!analysisRunner) {
    throw new Error('AnalysisRunner not available. Make sure AppProvider is initialized.');
  }
  return analysisRunner;
};