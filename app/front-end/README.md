# Space-Time Analytics Frontend

React, TypeScript, Vite, Redux, deck.gl, and maplibre-gl frontend for space-time trajectory analysis.

## What It Does

- Upload and manage GeoJSON/CSV trajectory datasets.
- Run browser-side analysis tools, with optional backend execution when the Flask API is available.
- Render 2D and 3D spatial outputs with deck.gl layers on a maplibre basemap.
- Animate time-aware outputs such as trajectories, STKDE, space-time cubes, prisms, and temporal road-network slices.

## Development

```bash
npm install
npm run dev
```

The Vite app defaults to `http://localhost:5173`.

Optional environment variables can be placed in `.env`:

```bash
VITE_APP_MODE=frontend
VITE_BACKEND_URL=http://localhost:8000
VITE_MAPBOX_TOKEN=
```

`VITE_MAPBOX_TOKEN` is only needed for the Mapbox satellite style. Without it, the satellite map falls back to Esri raster tiles.

## Verification

```bash
npm run build
npm test
npx playwright test
```

The Playwright tests start the Vite dev server automatically unless one is already running on `http://localhost:5173`.

## Key Directories

```text
src/
├── components/              React UI and map components
├── contexts/                App and color contexts
├── interfaces/              Shared TypeScript interfaces
├── services/                Analysis, backend API, visualization, and persistence services
├── stores/                  Redux slices
├── tools/                   Browser tool implementations
├── utils/                   Shared utility modules
└── visualization-templates/ Legacy visualization template configs
```

## Adding A Tool

1. Add a `SimpleTool` implementation under `src/tools/`.
2. Register it in `src/tools/index.ts` and `src/utils/tool-registry.ts` as needed.
3. If the tool can run on the backend, add the matching backend tool and normalizer support.
4. Add focused unit tests for the tool and, when the map behavior changes, update the Playwright smoke tests.
