import React, { createContext, useContext, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../stores/store';
import { DataService, createDataService } from '../services/data-service';

interface AppContextType {
  dataService: DataService | null;
  isInitialized: boolean;
}

const AppContext = createContext<AppContextType>({
  dataService: null,
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
    isInitialized: false,
  });

  useEffect(() => {
    const initializeServices = async () => {
      try {
        console.log('Initializing application services...');

        // Initialize data service
        const dataService = createDataService(dispatch);
        console.log('✓ Data service initialized');

        // Tools are auto-initialized by /src/tools/index.ts
        // Analysis is handled by UnifiedAnalysisService
        console.log('✓ Services ready (tools auto-initialized, analysis handled by UnifiedAnalysisService)');

        setServices({
          dataService,
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

// Hook for accessing data service
export const useDataService = () => {
  const { dataService } = useAppContext();
  if (!dataService) {
    throw new Error('DataService not available. Make sure AppProvider is initialized.');
  }
  return dataService;
};