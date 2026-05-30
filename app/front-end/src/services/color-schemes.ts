/**
 * Color Schemes for Visualization
 * Provides sequential, diverging, and categorical color palettes
 */

export interface ColorScheme {
  name: string;
  type: 'sequential' | 'diverging' | 'categorical';
  category: string;
  colors: string[];
}

/**
 * Sequential color schemes (light to dark, good for continuous data)
 */
export const SEQUENTIAL_SCHEMES: ColorScheme[] = [
  {
    name: 'ColorBrewer Blues-6',
    type: 'sequential',
    category: 'ColorBrewer',
    colors: ['#EFF3FF', '#C6DBEF', '#9ECAE1', '#6BAED6', '#3182BD', '#08519C'],
  },
  {
    name: 'ColorBrewer Greens-6',
    type: 'sequential',
    category: 'ColorBrewer',
    colors: ['#EDFBF5', '#B7E4C7', '#74C69D', '#52B788', '#40916C', '#2D6A4F'],
  },
  {
    name: 'ColorBrewer Reds-6',
    type: 'sequential',
    category: 'ColorBrewer',
    colors: ['#FEE5D9', '#FCBBA1', '#FC9272', '#FB6A4A', '#EF3B2C', '#CB181D'],
  },
  {
    name: 'ColorBrewer Purples-6',
    type: 'sequential',
    category: 'ColorBrewer',
    colors: ['#FCFBFD', '#EFE6F5', '#DADAEB', '#BCBDDC', '#9E9AC8', '#756BB1'],
  },
  {
    name: 'ColorBrewer YlOrRd-6',
    type: 'sequential',
    category: 'ColorBrewer',
    colors: ['#FFFFB2', '#FED976', '#FEB24C', '#FD8D3C', '#FC4E2A', '#E31A1C'],
  },
  {
    name: 'ColorBrewer YlGnBu-6',
    type: 'sequential',
    category: 'ColorBrewer',
    colors: ['#FFFFD9', '#EDFBDB', '#C7E9B4', '#7FCDBB', '#41B6C4', '#1D91C0'],
  },
  {
    name: 'Global Warming',
    type: 'sequential',
    category: 'Uber',
    colors: ['#5A1846', '#900C3F', '#C70039', '#E3611C', '#F1920E', '#FFC300'],
  },
  {
    name: 'Uber Pool',
    type: 'sequential',
    category: 'Uber',
    colors: ['#213E9A', '#3C5CB5', '#5E7BC4', '#8099D0', '#A3B8DC', '#C6D7E8'],
  },
];

/**
 * Diverging color schemes (two contrasting colors, good for showing deviation)
 */
export const DIVERGING_SCHEMES: ColorScheme[] = [
  {
    name: 'ColorBrewer RdYlBu-6',
    type: 'diverging',
    category: 'ColorBrewer',
    colors: ['#D73027', '#FC8D59', '#FEE090', '#E0F3F8', '#91BFDB', '#4575B4'],
  },
  {
    name: 'ColorBrewer RdYlGn-6',
    type: 'diverging',
    category: 'ColorBrewer',
    colors: ['#D73027', '#FC8D59', '#FEE08B', '#D9EF8B', '#91CF60', '#1A9850'],
  },
  {
    name: 'ColorBrewer PiYG-6',
    type: 'diverging',
    category: 'ColorBrewer',
    colors: ['#C51B7D', '#E9A3C9', '#FDE0EF', '#E6F5D0', '#A1D76A', '#4D9221'],
  },
  {
    name: 'Ice and Fire',
    type: 'diverging',
    category: 'Uber',
    colors: ['#0198BD', '#49E3CE', '#E8FEB5', '#FEEDB2', '#FEAD54', '#D50255'],
  },
  {
    name: 'Uber Viz Diverging',
    type: 'diverging',
    category: 'Uber',
    colors: ['#00939C', '#5DBABF', '#BAE1E2', '#F8C0AA', '#DD7755', '#C22E00'],
  },
];

/**
 * Categorical color schemes (distinct colors, good for categories)
 */
export const CATEGORICAL_SCHEMES: ColorScheme[] = [
  {
    name: 'ColorBrewer Set1-6',
    type: 'categorical',
    category: 'ColorBrewer',
    colors: ['#E41A1C', '#377EB8', '#4DAF4A', '#984EA3', '#FF7F00', '#FFFF33'],
  },
  {
    name: 'ColorBrewer Set2-6',
    type: 'categorical',
    category: 'ColorBrewer',
    colors: ['#66C2A5', '#FC8D62', '#8DA0CB', '#E78AC3', '#A6D854', '#FFD92F'],
  },
  {
    name: 'ColorBrewer Set3-6',
    type: 'categorical',
    category: 'ColorBrewer',
    colors: ['#8DD3C7', '#FFFFB3', '#BEBADA', '#FB8072', '#80B1D3', '#FDB462'],
  },
  {
    name: 'Uber Viz Categorical',
    type: 'categorical',
    category: 'Uber',
    colors: ['#12939A', '#DDB27C', '#88572C', '#FF991F', '#F15C17', '#223F9A'],
  },
  {
    name: 'Tableau 10',
    type: 'categorical',
    category: 'Tableau',
    colors: ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948'],
  },
];

/**
 * Get all color schemes
 */
export const ALL_COLOR_SCHEMES: ColorScheme[] = [
  ...SEQUENTIAL_SCHEMES,
  ...DIVERGING_SCHEMES,
  ...CATEGORICAL_SCHEMES,
];

/**
 * Get color scheme by name
 */
export const getColorScheme = (name: string): ColorScheme | undefined => {
  return ALL_COLOR_SCHEMES.find((scheme) => scheme.name === name);
};

/**
 * Get color schemes by type
 */
export const getColorSchemesByType = (
  type: 'sequential' | 'diverging' | 'categorical'
): ColorScheme[] => {
  return ALL_COLOR_SCHEMES.filter((scheme) => scheme.type === type);
};

/**
 * Convert hex colors to RGB array for deck.gl layers
 */
export const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : [0, 0, 0];
};

/**
 * Get default color scheme for a tool type
 */
export const getDefaultColorSchemeForTool = (toolId: string): ColorScheme => {
  const toolColorMap: Record<string, string> = {
    'time-geography': 'ColorBrewer YlOrRd-6',
    'buffer': 'Global Warming',
    'intersection': 'ColorBrewer Greens-6',
    'union': 'ColorBrewer Purples-6',
  };

  const schemeName = toolColorMap[toolId] || 'ColorBrewer Blues-6';
  return getColorScheme(schemeName) || SEQUENTIAL_SCHEMES[0];
};
