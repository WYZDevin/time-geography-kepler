export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  transitionDuration?: number;
}

export interface DeckLayerDescriptor {
  id: string;
  type: 'geojson' | 'scatterplot' | 'path' | 'text' | 'column' | 'line';
  datasetId: string;
  label: string;
  isVisible: boolean;
  opacity: number;
  color: [number, number, number];
  config: Record<string, unknown>;
  visualChannels?: Record<string, unknown>;
}

export interface MapDataset {
  id: string;
  label: string;
  data: GeoJSON.FeatureCollection;
  fieldSummary: { name: string; type: string }[];
}

export interface SelectedAnchor {
  lng: number;
  lat: number;
  alt: number;
  timestamp: number;
  label: string;
}

export type AnimationMode = 'progressive' | 'window';

export interface AnimationState {
  /** Whether the time animation is currently playing */
  isPlaying: boolean;
  /** Current time progress (0 = start, 1 = end of time range) */
  currentProgress: number;
  /** Playback speed multiplier (e.g. 0.5, 1, 2, 4) */
  speed: number;
  /** Number of discrete time slices (auto-computed: 1 per hour). 0 = smooth. */
  sliceCount: number;
  /** progressive = show 0..T, window = show only features at slice T */
  mode: AnimationMode;
  /** Whether to restart from 0 when reaching the end */
  loop: boolean;
}

export interface MapState {
  viewState: MapViewState;
  mapStyle: 'positron' | 'dark-matter' | 'satellite';
  datasets: Record<string, MapDataset>;
  layers: DeckLayerDescriptor[];
  /** For Space-Time Prism: user-clicked anchor points (max 2) */
  selectedAnchors: SelectedAnchor[];
  /** Time-based animation controls for 3D trajectory */
  animation: AnimationState;
}
