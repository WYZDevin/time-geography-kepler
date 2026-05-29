/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import {
  updateParams,
  swapAnchors,
  clearAnchorB,
  pickNewAnchors,
  setComputing,
  setReady,
  setOwnedIds,
  closeExplorer,
} from '@/stores/prism-explorer-slice';
import type { PrismParams } from '@/stores/prism-explorer-slice';
import {
  addDatasets,
  addLayers,
  removeDataset,
  removeLayers,
  setAnimationPlaying,
  setAnimationProgress,
  setSliceCount,
  setViewState,
} from '@/stores/map-slice';
import { buildDescriptorForDataset, buildLineSegments } from './deck-adapter';
import { backendApiService } from '@/services/backend-api-service';
import { normalizeBackendResponse } from '@/services/backend-normalizer';
import type { FeatureCollection } from '@/interfaces/data-interfaces';
import type { MapDataset, DeckLayerDescriptor, SelectedAnchor } from '@/interfaces/map-types';
import { X, ArrowLeftRight, RotateCcw, Crosshair } from 'lucide-react';

const SPEED_PRESETS: Record<string, string> = {
  walking: 'Walking (5 km/h)',
  cycling: 'Cycling (15 km/h)',
  transit: 'Transit (30 km/h)',
  driving: 'Driving (60 km/h)',
  custom: 'Custom',
};

/**
 * Prism Explorer — floating panel for interactive space-time prism exploration.
 * Renders on the map when the explorer mode is active.
 */
export const PrismExplorerPanel: React.FC = () => {
  const dispatch = useAppDispatch();
  const { mode, anchorA, anchorB, params, ownedDatasetIds, ownedLayerIds } = useAppSelector(
    s => s.prismExplorer,
  );
  const mapDatasets = useAppSelector(s => s.map.datasets);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const computeIdRef = useRef(0);
  const [computeError, setComputeError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Compute prism & push results to map store
  // -----------------------------------------------------------------------
  const computePrism = useCallback(async () => {
    if (!anchorA || !anchorB) return;

    const id = ++computeIdRef.current;
    setComputeError(null);
    dispatch(setComputing());

    // Remove previous explorer layers
    if (ownedDatasetIds.length) {
      ownedDatasetIds.forEach(dsId => dispatch(removeDataset(dsId)));
    }
    if (ownedLayerIds.length) {
      dispatch(removeLayers(ownedLayerIds));
    }

    try {
      let outputs: FeatureCollection[];

      if (params.prismMode === 'pasta') {
        outputs = await computePASTA(anchorA, anchorB, params, mapDatasets, ownedDatasetIds);
      } else {
        outputs = await computeRoadNetworkSTP(anchorA, anchorB, params, mapDatasets, ownedDatasetIds);
      }

      // Stale guard
      if (id !== computeIdRef.current) return;

      const newDatasets: MapDataset[] = [];
      const newLayers: DeckLayerDescriptor[] = [];

      outputs.forEach((output, index) => {
        const dsType = (output.features[0]?.properties?._dataset_type as string) || '';
        const datasetId = `prism-explorer-${dsType || index}-${id}`;
        const datasetLabel = dsType || `Prism Result ${index + 1}`;

        const cleanedOutput: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: output.features.map(f => ({
            type: 'Feature' as const,
            geometry: f.geometry,
            properties: Object.fromEntries(
              Object.entries(f.properties || {}).filter(
                ([k]) => !k.startsWith('_layer_config') && k !== '_dataset_type',
              ),
            ),
          })),
        };

        const fieldSummary = Object.entries(output.features[0]?.properties || {})
          .filter(([k]) => !k.startsWith('_layer_config') && k !== '_dataset_type')
          .map(([name, val]) => ({
            name,
            type: typeof val === 'number' ? 'real' : typeof val === 'boolean' ? 'boolean' : 'string',
          }));

        newDatasets.push({ id: datasetId, label: datasetLabel, data: cleanedOutput, fieldSummary });

        const descriptor = buildDescriptorForDataset(dsType, null, datasetId, datasetLabel, cleanedOutput);

        // For trajectory descriptors, build the line segments
        if (descriptor.type === 'line' && !descriptor.config.segmentData) {
          descriptor.config.segmentData = buildLineSegments(cleanedOutput);
        }

        newLayers.push(descriptor);
      });

      dispatch(addDatasets(newDatasets));
      dispatch(addLayers(newLayers));
      dispatch(setSliceCount(Math.max(1, params.timeSlices)));
      dispatch(setAnimationProgress(1));
      dispatch(setAnimationPlaying(false));
      dispatch(
        setOwnedIds({
          datasetIds: newDatasets.map(d => d.id),
          layerIds: newLayers.map(l => l.id),
        }),
      );

      // Auto-center map on prism with 3D tilt for visibility
      if (anchorA && anchorB) {
        const centerLng = (anchorA.lng + anchorB.lng) / 2;
        const centerLat = (anchorA.lat + anchorB.lat) / 2;
        const lngSpan = Math.abs(anchorA.lng - anchorB.lng);
        const latSpan = Math.abs(anchorA.lat - anchorB.lat);
        const maxSpan = Math.max(lngSpan, latSpan, 0.001);
        const zoom = Math.min(16, Math.max(8, Math.floor(Math.log2(360 / maxSpan)) - 1));
        dispatch(setViewState({
          longitude: centerLng,
          latitude: centerLat,
          zoom,
          pitch: 62,
          bearing: -25,
        }));
      }

      dispatch(setReady());
    } catch (err) {
      console.error('Prism explorer compute error:', err);
      if (id === computeIdRef.current) {
        setComputeError(err instanceof Error ? err.message : 'Computation failed');
        dispatch(setReady());
      }
    }
  }, [anchorA, anchorB, params, dispatch, ownedDatasetIds, ownedLayerIds, mapDatasets]);

  // -----------------------------------------------------------------------
  // Auto-compute on anchor selection or param change (debounced)
  // -----------------------------------------------------------------------
  const anchorKey = anchorA && anchorB
    ? `${anchorA.lng},${anchorA.lat},${anchorA.timestamp}|${anchorB.lng},${anchorB.lat},${anchorB.timestamp}`
    : null;

  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!anchorKey) return;
    setComputeError(null);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      computePrism();
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [anchorKey, paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Cleanup owned layers when explorer closes
  // -----------------------------------------------------------------------
  useEffect(() => {
    return () => {
      // Will fire when component unmounts (explorer closes)
    };
  }, []);

  const handleClose = () => {
    ownedDatasetIds.forEach(dsId => dispatch(removeDataset(dsId)));
    if (ownedLayerIds.length) dispatch(removeLayers(ownedLayerIds));
    dispatch(closeExplorer());
  };

  if (mode === 'idle') return null;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const isSelecting = mode === 'selectingA' || mode === 'selectingB';
  const hasAnchors = !!anchorA && !!anchorB;

  return (
    <div className="absolute top-4 right-4 z-20 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-xl shadow-xl border border-blue-300 dark:border-blue-700 w-80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <span className="text-sm font-bold tracking-wide">Space-Time Prism Explorer</span>
        <button onClick={handleClose} className="p-1 hover:bg-white/20 rounded cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Anchor status */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Anchor Points
          </div>

          <AnchorRow
            letter="A"
            color="bg-red-500"
            anchor={anchorA}
            isActive={mode === 'selectingA'}
          />
          <AnchorRow
            letter="B"
            color="bg-blue-500"
            anchor={anchorB}
            isActive={mode === 'selectingB'}
          />

          {isSelecting && (
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-lg px-3 py-2">
              <Crosshair className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" />
              <span>
                Click a point on the map to set <strong>Anchor {mode === 'selectingA' ? 'A' : 'B'}</strong>
              </span>
            </div>
          )}

          {hasAnchors && (
            <div className="flex gap-2">
              <button
                onClick={() => dispatch(swapAnchors())}
                className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-2 py-1 cursor-pointer"
              >
                <ArrowLeftRight className="w-3 h-3" /> Swap
              </button>
              <button
                onClick={() => dispatch(clearAnchorB())}
                className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-2 py-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" /> Replace B
              </button>
              <button
                onClick={() => dispatch(pickNewAnchors())}
                className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-2 py-1 cursor-pointer"
              >
                <Crosshair className="w-3 h-3" /> New pair
              </button>
            </div>
          )}
        </div>

        {/* Divider */}
        {hasAnchors && <hr className="border-gray-200 dark:border-gray-700" />}

        {/* Parameters (visible once both anchors set) */}
        {hasAnchors && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Parameters
            </div>

            {/* Prism mode */}
            <label className="block">
              <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">Prism Mode</span>
              <select
                value={params.prismMode}
                onChange={e => dispatch(updateParams({ prismMode: e.target.value }))}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              >
                <option value="road-network-stp">PPA Road Network (per-GPS-point)</option>
                <option value="pasta">PASTA – H3 Potential Path Area</option>
              </select>
            </label>

            {params.prismMode === 'pasta' ? (
              <PastaParams params={params} dispatch={dispatch} anchorA={anchorA} anchorB={anchorB} />
            ) : (
              <PPARoadNetworkParams
                params={params}
                dispatch={dispatch}
                mapDatasets={mapDatasets}
              />
            )}
          </div>
        )}

        {/* Computing indicator */}
        {mode === 'computing' && (
          <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
            <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            {params.prismMode === 'pasta'
            ? 'Computing H3 potential path area…'
            : params.prismMode === 'road-network-stp'
              ? 'Clipping road network…'
              : 'Computing space-time prism…'}
          </div>
        )}

        {/* Error message */}
        {computeError && (
          <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
            {computeError}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Anchor row sub-component
// ---------------------------------------------------------------------------

function AnchorRow({
  letter,
  color,
  anchor,
  isActive,
}: {
  letter: string;
  color: string;
  anchor: { label: string; lng: number; lat: number; timestamp: number } | null;
  isActive: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 transition-colors ${
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-400'
          : 'bg-gray-50 dark:bg-gray-800'
      }`}
    >
      <span
        className={`w-5 h-5 rounded-full ${color} text-white text-xs flex items-center justify-center font-bold flex-shrink-0`}
      >
        {letter}
      </span>
      <span className="text-gray-700 dark:text-gray-300 truncate text-xs">
        {anchor ? anchor.label : isActive ? 'Click on the map...' : 'Not selected'}
      </span>
    </div>
  );
}

async function computePASTA(
  anchorA: SelectedAnchor,
  anchorB: SelectedAnchor,
  params: PrismParams,
  mapDatasets: Record<string, MapDataset>,
  ownedDatasetIds: string[],
): Promise<FeatureCollection[]> {
  const sourceData = buildPrismSourceData(mapDatasets, ownedDatasetIds);

  const tMin = Math.min(anchorA.timestamp, anchorB.timestamp);
  const tMax = Math.max(anchorA.timestamp, anchorB.timestamp);
  const hasTimeRange = tMin > 0 && tMax > 0 && tMin !== tMax;

  const trajectoryFeatures = sourceData.features.filter(f => {
    if (f.geometry?.type !== 'Point') return false;
    if (!hasTimeRange) return true;
    const ts = f.properties?._timestamp as number;
    return typeof ts === 'number' && ts >= tMin && ts <= tMax;
  });

  const raw = await backendApiService.executeTool(
    'space-time-prism',
    { type: 'FeatureCollection', features: trajectoryFeatures },
    {
      analysisMode: 'pasta',
      anchorA: { lng: anchorA.lng, lat: anchorA.lat, timestamp: anchorA.timestamp },
      anchorB: { lng: anchorB.lng, lat: anchorB.lat, timestamp: anchorB.timestamp },
      speedMode: params.speedMode,
      customSpeed: params.customSpeed,
      durationMinutes: params.durationMinutes,
      minActivitySeconds: params.minActivityMinutes * 60,
      h3Resolution: params.h3Resolution,
    },
    { time: '_timestamp' },
  );
  if (!raw?.success) throw new Error(raw?.error ?? 'PASTA backend call failed');
  return normalizeBackendResponse(raw, 'pasta').outputs;
}

const H3_RESOLUTION_LABELS: Record<number, string> = {
  7: '~1.2 km',
  8: '~460 m',
  9: '~174 m',
  10: '~66 m',
  11: '~25 m',
};

function PastaParams({
  params,
  dispatch,
  anchorA,
  anchorB,
}: {
  params: PrismParams;
  dispatch: ReturnType<typeof useAppDispatch>;
  anchorA: SelectedAnchor | null;
  anchorB: SelectedAnchor | null;
}) {
  const hasTimestamps =
    !!anchorA && !!anchorB &&
    anchorA.timestamp > 0 && anchorB.timestamp > 0 &&
    anchorA.timestamp !== anchorB.timestamp;

  const budgetMin = hasTimestamps
    ? Math.abs(anchorB!.timestamp - anchorA!.timestamp) / 60_000
    : null;

  return (
    <>
      {/* Travel speed */}
      <label className="block">
        <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">Travel Speed</span>
        <select
          value={params.speedMode}
          onChange={e => dispatch(updateParams({ speedMode: e.target.value }))}
          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
        >
          {Object.entries(SPEED_PRESETS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </label>

      {params.speedMode === 'custom' && (
        <label className="block">
          <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
            Custom Speed: {params.customSpeed} km/h
          </span>
          <input
            type="range" min={1} max={120} step={1}
            value={params.customSpeed}
            onChange={e => dispatch(updateParams({ customSpeed: Number(e.target.value) }))}
            className="w-full accent-blue-600"
          />
        </label>
      )}

      {/* Time budget */}
      {hasTimestamps ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5">
          Time budget: <span className="font-medium text-gray-700 dark:text-gray-200">{budgetMin!.toFixed(1)} min</span> (from anchor timestamps)
        </div>
      ) : (
        <label className="block">
          <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
            Time Budget: {params.durationMinutes} min
          </span>
          <input
            type="range" min={10} max={240} step={5}
            value={params.durationMinutes}
            onChange={e => dispatch(updateParams({ durationMinutes: Number(e.target.value) }))}
            className="w-full accent-blue-600"
          />
        </label>
      )}

      {/* Min activity duration */}
      <label className="block">
        <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
          Min Activity Duration: {params.minActivityMinutes} min
        </span>
        <input
          type="range" min={1} max={30} step={1}
          value={params.minActivityMinutes}
          onChange={e => dispatch(updateParams({ minActivityMinutes: Number(e.target.value) }))}
          className="w-full accent-blue-600"
        />
      </label>

      {/* H3 resolution */}
      <label className="block">
        <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
          H3 Resolution: {params.h3Resolution} ({H3_RESOLUTION_LABELS[params.h3Resolution] ?? ''}  cell edge)
        </span>
        <input
          type="range" min={7} max={11} step={1}
          value={params.h3Resolution}
          onChange={e => dispatch(updateParams({ h3Resolution: Number(e.target.value) }))}
          className="w-full accent-blue-600"
        />
        <span className="text-xs text-gray-400 mt-0.5 block">
          Coarser (7) = fewer cells, faster · Finer (11) = more detail, slower
        </span>
      </label>
    </>
  );
}

function PPARoadNetworkParams({
  params,
  dispatch,
  mapDatasets,
}: {
  params: PrismParams;
  dispatch: ReturnType<typeof useAppDispatch>;
  mapDatasets: Record<string, MapDataset>;
}) {
  return (
    <>
      {/* Travel speed */}
      <label className="block">
        <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">Travel Speed</span>
        <select
          value={params.speedMode}
          onChange={e => dispatch(updateParams({ speedMode: e.target.value }))}
          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
        >
          {Object.entries(SPEED_PRESETS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </label>

      {params.speedMode === 'custom' && (
        <label className="block">
          <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
            Custom Speed: {params.customSpeed} km/h
          </span>
          <input
            type="range" min={1} max={120} step={1}
            value={params.customSpeed}
            onChange={e => dispatch(updateParams({ customSpeed: Number(e.target.value) }))}
            className="w-full accent-blue-600"
          />
        </label>
      )}

      {/* Min activity duration A */}
      <label className="block">
        <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
          Min Activity Time A: {params.minActivityMinutes} min
        </span>
        <input
          type="range" min={0} max={120} step={1}
          value={params.minActivityMinutes}
          onChange={e => dispatch(updateParams({ minActivityMinutes: Number(e.target.value) }))}
          className="w-full accent-blue-600"
        />
        <span className="text-xs text-gray-400 mt-0.5 block">
          Total budget T is derived from the GPS sampling cadence; one-way cutoff R = (T − A) / 2.
        </span>
      </label>

      {/* Max origins cap */}
      <label className="block">
        <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
          Max GPS Origins: {params.maxOrigins}
        </span>
        <input
          type="range" min={5} max={120} step={1}
          value={params.maxOrigins}
          onChange={e => dispatch(updateParams({ maxOrigins: Number(e.target.value) }))}
          className="w-full accent-blue-600"
        />
        <span className="text-xs text-gray-400 mt-0.5 block">
          Fewer = faster · More = denser stack between anchors
        </span>
      </label>

      {/* Road network dataset */}
      <label className="block">
        <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
          Road Network Dataset
        </span>
        <select
          value={params.roadNetworkDatasetId}
          onChange={e => dispatch(updateParams({ roadNetworkDatasetId: e.target.value }))}
          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
        >
          <option value="">Auto-download from OSM</option>
          {Object.values(mapDatasets)
            .filter(ds => !ds.id.startsWith('prism-explorer') && !ds.id.startsWith('shared-axes'))
            .map(ds => (
              <option key={ds.id} value={ds.id}>{ds.label}</option>
            ))
          }
        </select>
        <span className="text-xs text-gray-400 mt-0.5 block">
          Pick a loaded road LineString dataset, or leave empty
        </span>
      </label>
    </>
  );
}

async function computeRoadNetworkSTP(
  anchorA: SelectedAnchor,
  anchorB: SelectedAnchor,
  params: {
    speedMode: string;
    customSpeed: number;
    roadNetworkDatasetId: string;
    minActivityMinutes: number;
    maxOrigins: number;
  },
  mapDatasets: Record<string, MapDataset>,
  ownedDatasetIds: string[],
): Promise<FeatureCollection[]> {
  const sourceData = buildPrismSourceData(mapDatasets, ownedDatasetIds);

  // Send all trajectory Point features (not just the anchor window) so the
  // backend can derive the full trajectory's bounds + time range. The PPA
  // engine filters internally to the anchor sub-window when picking origin
  // GPS points, but it uses the global bounds/range to align the Z scale
  // with the rendered trajectory's _height field.
  const features = sourceData.features.filter(f => f.geometry?.type === 'Point');

  const options: Record<string, any> = {
    _anchorA: { lng: anchorA.lng, lat: anchorA.lat, alt: anchorA.alt, timestamp: anchorA.timestamp, label: anchorA.label },
    _anchorB: { lng: anchorB.lng, lat: anchorB.lat, alt: anchorB.alt, timestamp: anchorB.timestamp, label: anchorB.label },
    prismMode: 'gps-road-network',
    speedMode: params.speedMode,
    customSpeed: params.customSpeed,
    // PPA-engine parameters per PPA_ESTIMATION.md.
    // totalBudgetMinutes is intentionally omitted — the backend derives T
    // from the trajectory's GPS sampling cadence so that anchors picked on
    // the trajectory are always reachable.
    minActivityMinutes: params.minActivityMinutes,
    maxOrigins: params.maxOrigins,
  };
  if (params.roadNetworkDatasetId && mapDatasets[params.roadNetworkDatasetId]) {
    options.roadNetworkData = mapDatasets[params.roadNetworkDatasetId].data;
  }

  const raw = await backendApiService.executeTool(
    'space-time-prism',
    { type: 'FeatureCollection', features },
    options,
    { time: '_timestamp' },
  );

  if (!raw?.success) {
    throw new Error(raw?.error ?? 'PPA road-network backend call failed');
  }

  return normalizeBackendResponse(raw, 'space-time-prism').outputs;
}

function buildPrismSourceData(
  datasets: Record<string, MapDataset>,
  ownedDatasetIds: string[],
): GeoJSON.FeatureCollection {
  const owned = new Set(ownedDatasetIds);
  const features: GeoJSON.Feature[] = [];

  for (const dataset of Object.values(datasets)) {
    if (
      owned.has(dataset.id) ||
      dataset.id.startsWith('shared-axes') ||
      dataset.id.startsWith('prism-explorer')
    ) {
      continue;
    }

    for (const feature of dataset.data.features) {
      features.push({
        type: 'Feature' as const,
        geometry: feature.geometry,
        properties: {
          ...(feature.properties ?? {}),
          _source_dataset_id: dataset.id,
          _source_dataset_label: dataset.label,
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}
