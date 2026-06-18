// Basemap styles shared by the main map view and the focused prism view, keyed
// by the map slice's `mapStyle` value.

import type { StyleSpecification } from 'maplibre-gl';

const MAP_STYLES: Record<string, string> = {
  positron: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  'dark-matter': 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  satellite: getSatelliteStyleUrl(),
};

function getSatelliteStyleUrl(): string {
  const mapboxToken = (
    (import.meta.env.VITE_MAPBOX_API_KEY as string) ||
    (import.meta.env.VITE_MAPBOX_TOKEN as string) ||
    ''
  ).trim();

  if (mapboxToken) {
    return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12?access_token=${mapboxToken}`;
  }

  return JSON.stringify({
    version: 8,
    sources: {
      'esri-satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [
      {
        id: 'esri-satellite-layer',
        type: 'raster',
        source: 'esri-satellite',
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  });
}

/** mapStyle prop for react-map-gl's Map — a style URL, or a parsed inline style object. */
export function resolveMapStyleProp(mapStyle: string): string | StyleSpecification {
  const styleUrl = MAP_STYLES[mapStyle] ?? MAP_STYLES.positron;
  return styleUrl.startsWith('{') ? (JSON.parse(styleUrl) as StyleSpecification) : styleUrl;
}

/** Sky backdrop behind the transparent above-horizon region, matched to the basemap. */
export function skyGradientClass(mapStyle: string): string {
  return mapStyle === 'dark-matter'
    ? 'bg-gradient-to-b from-gray-950 to-gray-700'
    : 'bg-gradient-to-b from-muted to-background';
}
