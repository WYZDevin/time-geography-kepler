import React, { createContext, useContext, ReactNode } from 'react';

// Define the types for our context
type ColorContextType = {
  getColorForType: (type: string) => string;
};

// Create the context with a default value
const ColorContext = createContext<ColorContextType | undefined>(undefined);

// Define the props for our provider component
interface ColorProviderProps {
  children: ReactNode;
}

/**
 * Provider component that wraps parts of the app that need access to the color context
 */
export const ColorProvider: React.FC<ColorProviderProps> = ({ children }) => {
  /**
   * Returns a color based on the input type
   * @param type - The type of element to color
   * @returns A hex color string
   */
  const getColorForType = (type: string): string => {
    const lowerType = type.toLowerCase();
    
    // Neutral colors for line types
    if (lowerType.includes('line')) {
      return '#6c757d'; // Neutral gray
    }
    
    // Light colors for aquarium types
    if (lowerType.includes('aquarium') || lowerType.includes('aquarim')) {
      return '#8ecae6'; // Light blue
    }
    
    // Strong colors for activity space
    if (lowerType.includes('activity space')) {
      return '#e63946'; // Strong red
    }
    
    // Default color if no match
    return '#495057'; // Dark gray as default
  };
  
  // The value that will be provided to consumers of this context
  const value = {
    getColorForType,
  };
  
  return (
    <ColorContext.Provider value={value}>
      {children}
    </ColorContext.Provider>
  );
};

/**
 * Hook to use the color context
 * @returns The color context
 * @throws Error if used outside of a ColorProvider
 */
export const useColor = (): ColorContextType => {
  const context = useContext(ColorContext);
  if (context === undefined) {
    throw new Error('useColor must be used within a ColorProvider');
  }
  return context;
};
