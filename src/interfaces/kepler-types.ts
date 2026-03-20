/**
 * Type definitions for Kepler.gl state
 * These are minimal types to avoid 'unknown' errors while working with Kepler.gl state
 */

export interface KeplerMapStyle {
  styleType?: string;
  [key: string]: any;
}

export interface KeplerLayer {
  id: string;
  type: string;
  isValid: boolean;
  errorMessage?: string;
  [key: string]: any;
}

export interface KeplerField {
  name: string;
  type: string;
  [key: string]: any;
}

export interface KeplerDataset {
  label: string;
  fields: KeplerField[];
  allData?: any[];
  dataContainer?: {
    numRows?: () => number;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface KeplerVisState {
  layers: KeplerLayer[];
  datasets: Record<string, KeplerDataset>;
  [key: string]: any;
}

export interface KeplerInstanceState {
  mapStyle?: KeplerMapStyle;
  visState: KeplerVisState;
  [key: string]: any;
}

export interface KeplerGlState {
  kepler?: KeplerInstanceState;
  [key: string]: any;
}
