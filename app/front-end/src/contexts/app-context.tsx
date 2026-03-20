import React, { createContext, useContext, useEffect, useState } from 'react';
import { AnalysisEngine, createAnalysisEngine } from '../services/analysis-engine';
import { VisualizationService, createVisualizationService } from '../services/visualization-service';
// Import tools to trigger auto-initialization
console.log('AppContext: About to import tools module...');
import '../tools';
console.log('AppContext: Tools module imported');

interface AppContextType {
  analysisEngine: AnalysisEngine | null; // Pure analysis
  visualizationService: VisualizationService | null; // Pure visualization
  isInitialized: boolean;
}

const AppContext = createContext<AppContextType>({
  analysisEngine: null,
  visualizationService: null,
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
  const [services, setServices] = useState<AppContextType>({
    analysisEngine: null,
    visualizationService: null,
    isInitialized: false,
  });

  useEffect(() => {
    const initializeServices = async () => {
      try {
        console.log('Initializing application services...');

        // Initialize pure analysis engine
        const analysisEngine = createAnalysisEngine();
        console.log('✓ Analysis engine initialized');

        // Initialize visualization service
        const visualizationService = createVisualizationService();
        console.log('✓ Visualization service initialized');

        // Tools are auto-initialized by /src/tools/index.ts
        console.log('✓ Services ready (tools auto-initialized)');

        setServices({
          analysisEngine,
          visualizationService,
          isInitialized: true,
        });

        console.log('🚀 Application services initialized successfully');

      } catch (error) {
        console.error('Failed to initialize application services:', error);
        setServices(prev => ({ ...prev, isInitialized: false }));
      }
    };

    initializeServices();
  }, []);

  return (
    <AppContext.Provider value={services}>
      {children}
    </AppContext.Provider>
  );
};

// DataService is removed - use Redux directly via useAppDispatch/useAppSelector

// Hook for accessing pure analysis engine
export const useAnalysisEngine = () => {
  const { analysisEngine } = useAppContext();
  if (!analysisEngine) {
    throw new Error('AnalysisEngine not available. Make sure AppProvider is initialized.');
  }
  return analysisEngine;
};

// Hook for accessing visualization service
export const useVisualizationService = () => {
  const { visualizationService } = useAppContext();
  if (!visualizationService) {
    throw new Error('VisualizationService not available. Make sure AppProvider is initialized.');
  }
  return visualizationService;
};