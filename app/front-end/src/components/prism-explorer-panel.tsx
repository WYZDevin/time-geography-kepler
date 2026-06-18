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
import { selectActiveResearchArea } from '@/stores/research-area-slice';
import { buildDescriptorForDataset, buildLineSegments, buildPrismSheetPaths } from './deck-adapter';
import { backendApiService } from '@/services/backend-api-service';
import { normalizeBackendResponse } from '@/services/backend-normalizer';
import type { FeatureCollection } from '@/interfaces/data-interfaces';
import type { MapDataset, DeckLayerDescriptor, SelectedAnchor } from '@/interfaces/map-types';
import { X, ArrowLeftRight, RotateCcw, Crosshair, Hammer } from 'lucide-react';
import { BackendProgress } from './custom-components/backend-progress';

const SPEED_PRESETS: Record<string, string> = {
  walking: 'Walking (5 km/h)',
  cycling: 'Cycling (15 km/h)',
  transit: 'Transit (30 km/h)',
  driving: 'Driving (60 km/h)',
  custom: 'Custom',
};

/** Identity of a buildable prism — anchors + params. Used to detect when the
 *  on-screen result has gone stale relative to the current configuration. */
const prismBuildKey = (a: SelectedAnchor, b: SelectedAnchor, params: PrismParams): string =>
  `${a.lng},${a.lat},${a.timestamp}|${b.lng},${b.lat},${b.timestamp}|${JSON.stringify(params)}`;

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
  const activeResearchArea = useAppSelector(selectActiveResearchArea);
  const computeIdRef = useRef(0);
  const [computeError, setComputeError] = useState<string | null>(null);
  // Key of the anchors/params last built, so we can tell when the on-screen
  // prism is stale. null = nothing built yet (button reads "Start Building").
  const [builtKey, setBuiltKey] = useState<string | null>(null);

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
        outputs = await computePASTA(anchorA, anchorB, params, mapDatasets, ownedDatasetIds, activeResearchArea);
      } else {
        outputs = await computeRoadNetworkSTP(anchorA, anchorB, params, mapDatasets, ownedDatasetIds, activeResearchArea);
      }

      // Stale guard
      if (id !== computeIdRef.current) return;

      const newDatasets: MapDataset[] = [];
      const newLayers: DeckLayerDescriptor[] = [];

      // Captured during the loop for the on-map prism sheets built after it:
      // the reachable-roads output plus the anchors' z heights — the prism's
      // original z band on the main map.
      let roadsForSheets: { fc: GeoJSON.FeatureCollection; datasetId: string } | null = null;
      let sheetZStart = 0;
      let sheetZEnd = 0;

      outputs.forEach((output, index) => {
        const dsType = (output.features[0]?.properties?._dataset_type as string) || '';
        // The PPA origin-points layer was a one-marker-per-GPS-sample stack
        // that obscured the reachable roads it was meant to anchor. The
        // backend still emits it (other consumers + tests read the dwell-
        // time summary off it), but we skip rendering it on the map.
        if (dsType === 'ppa-origin-points') return;
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

        // The single-height-per-edge 3D stack is superseded on the main map by
        // the discrete prism sheets built below (same forward∩backward cone
        // slicing as the Focused 3D View) — keep the layer available
        // (toggleable in the legend) but off by default.
        if (dsType === 'ppa-road-network') {
          descriptor.isVisible = false;
          roadsForSheets = { fc: cleanedOutput, datasetId };
        }

        if (dsType === 'prism-anchors') {
          for (const f of cleanedOutput.features) {
            const z = (f.properties?.z as number)
              ?? (f.geometry?.type === 'Point' ? ((f.geometry.coordinates[2] as number) ?? 0) : 0);
            if (f.properties?.anchor_role === 'start_anchor') sheetZStart = z;
            if (f.properties?.anchor_role === 'end_anchor') sheetZEnd = z;
          }
        }

        newLayers.push(descriptor);

        // Mirror the PPA reachable-roads output as a ground-projected sibling
        // (same geometry, z forced to 0) so the user can read road coverage
        // on the basemap alongside the stacked 3D layer.
        if (dsType === 'ppa-road-network') {
          const groundDsType = 'ppa-road-network-ground';
          const groundDatasetId = `prism-explorer-${groundDsType}-${id}`;
          const groundLabel = groundDsType;
          newDatasets.push({
            id: groundDatasetId,
            label: groundLabel,
            data: cleanedOutput,
            fieldSummary,
          });
          newLayers.push(
            buildDescriptorForDataset(groundDsType, null, groundDatasetId, groundLabel, cleanedOutput),
          );
        }
      });

      // The Focused 3D View's content on the regular map: the prism as
      // discrete forward∩backward cone sheets, kept at the ORIGINAL z scale
      // (anchor A at z_start, B at z_end) so it stays aligned with the
      // trajectory's time axis instead of being re-stretched like the dialog.
      let sheetSlices = 0;
      // Assertion needed: TS does not track the assignment inside the forEach
      // callback and would otherwise narrow roadsForSheets to null here.
      const sheetsSource = roadsForSheets as { fc: GeoJSON.FeatureCollection; datasetId: string } | null;
      if (sheetsSource) {
        const { paths, nSlices } = buildPrismSheetPaths(
          sheetsSource.fc, sheetZStart, sheetZEnd, Math.max(2, params.timeSlices),
        );
        if (paths.length) {
          sheetSlices = nSlices;
          newLayers.push({
            id: `prism-explorer-prism-sheets-${id}`,
            type: 'path',
            datasetId: sheetsSource.datasetId,
            label: 'Space-Time Prism (3D Sheets)',
            isVisible: true,
            opacity: 0.85,
            color: [220, 90, 60],
            config: {
              pathData: paths,
              widthScale: 3,
              widthMinPixels: 1.5,
              sheetFilter: true,
              depthTest: false,
            },
          });
        }
      }

      // Draw order: flat dwell surface at the bottom, ground roads above it,
      // then the 3D sheets / (hidden) stack and the anchors on top.
      newLayers.sort((a, b) => prismLayerRank(a.datasetId) - prismLayerRank(b.datasetId));

      dispatch(addDatasets(newDatasets));
      dispatch(addLayers(newLayers));
      // Align the animation steps with the sheet fractions i/(nSlices−1) so
      // discrete stepping lands exactly on a sheet.
      dispatch(setSliceCount(Math.max(1, sheetSlices > 0 ? sheetSlices - 1 : params.timeSlices)));
      dispatch(setAnimationProgress(1));
      dispatch(setAnimationPlaying(false));
      dispatch(
        setOwnedIds({
          datasetIds: newDatasets.map(d => d.id),
          layerIds: newLayers.map(l => l.id),
        }),
      );

      // Auto-center on the prism with a 3D tilt: the regular view now carries
      // the sliced prism alongside the flat dwell surface and ground roads.
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

      setBuiltKey(prismBuildKey(anchorA, anchorB, params));
      dispatch(setReady());
    } catch (err) {
      console.error('Prism explorer compute error:', err);
      if (id === computeIdRef.current) {
        setComputeError(err instanceof Error ? err.message : 'Computation failed');
        dispatch(setReady());
      }
    }
  }, [anchorA, anchorB, params, dispatch, ownedDatasetIds, ownedLayerIds, mapDatasets, activeResearchArea]);

  // PASTA mode is currently disabled — coerce any persisted Redux state
  // (e.g. a user who last opened the panel on the PASTA branch) back to
  // the PPA Road Network mode so the panel never lands on the disabled
  // PASTA codepath. Remove the coercion when PASTA is re-enabled.
  useEffect(() => {
    if (params.prismMode === 'pasta') {
      dispatch(updateParams({ prismMode: 'road-network-stp' }));
    }
  }, [params.prismMode, dispatch]);

  // -----------------------------------------------------------------------
  // Manual build only — the prism never auto-runs. Each compute hits the
  // backend, so it runs solely when the user clicks "Start Building". We just
  // track whether the current anchors/params have diverged from the last
  // build so the button can prompt a rebuild.
  // -----------------------------------------------------------------------
  const buildKey = anchorA && anchorB ? prismBuildKey(anchorA, anchorB, params) : null;
  const isStale = buildKey !== null && builtKey !== null && buildKey !== builtKey;

  // Forget the last build whenever a full anchor pair is no longer set (new
  // pair, replaced B, explorer reopened) so the next build reads "Start
  // Building" instead of "Rebuild".
  useEffect(() => {
    if (!anchorA || !anchorB) setBuiltKey(null);
  }, [anchorA, anchorB]);

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
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shrink-0">
        <span className="text-sm font-bold tracking-wide">Space-Time Prism Explorer</span>
        <button
          onClick={handleClose}
          className="p-1 hover:bg-white/20 rounded cursor-pointer"
          title="Close explorer"
          aria-label="Close explorer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
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

            {/* Prism mode — locked to PPA Road Network while PASTA is
                disabled. Re-enable the dropdown (drop `disabled` and the
                PASTA `<option disabled>` flag) when PASTA comes back. */}
            <label className="block">
              <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">Prism Mode</span>
              <select
                value={params.prismMode}
                onChange={e => dispatch(updateParams({ prismMode: e.target.value }))}
                disabled
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="road-network-stp">Road-Network Prism (A ↔ B)</option>
                <option value="pasta" disabled>PASTA – H3 Potential Path Area (disabled)</option>
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

        {/* Build trigger — the prism computes only when clicked; it never
            auto-runs. Disabled once a build matches the current config. */}
        {hasAnchors && mode !== 'computing' && (
          <div className="space-y-1.5">
            {isStale && (
              <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                Anchors or parameters changed — rebuild to update the prism.
              </p>
            )}
            <button
              onClick={() => computePrism()}
              disabled={builtKey !== null && !isStale}
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md px-3 py-2 transition-colors cursor-pointer"
            >
              <Hammer className="w-4 h-4" />
              {builtKey === null ? 'Start Building' : isStale ? 'Rebuild Prism' : 'Prism Up to Date'}
            </button>
          </div>
        )}

        {/* Computing indicator */}
        {mode === 'computing' && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
              <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              {params.prismMode === 'pasta'
              ? 'Computing H3 potential path area…'
              : params.prismMode === 'road-network-stp'
                ? 'Intersecting forward & backward cones…'
                : 'Computing space-time prism…'}
            </div>
            <BackendProgress
              label="The backend is still running…"
              barColor="bg-blue-500"
              trackColor="bg-blue-200/60 dark:bg-blue-900/40"
              textColor="text-blue-600 dark:text-blue-400"
            />
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
// Labeled parameter section — groups related controls under a small heading
// ---------------------------------------------------------------------------

function ParamSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
        {title}
      </div>
      {children}
    </div>
  );
}

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
  researchArea: FeatureCollection | null,
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
    undefined,
    researchArea ?? undefined,
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
      <ParamSection title="Travel speed">
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
      </ParamSection>

      {/* Time budget & activity */}
      <ParamSection title="Time budget">
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
      </ParamSection>

      {/* Resolution */}
      <ParamSection title="Resolution">
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
      </ParamSection>
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
      <ParamSection title="Travel speed">
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

        {/* Realistic-speed adjustment: free-flow class speeds overestimate
            urban travel; this scales them to real conditions. */}
        <label className="block">
          <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">Speed Realism</span>
          <select
            value={params.speedAdjustment}
            onChange={e => dispatch(updateParams({ speedAdjustment: e.target.value as PrismParams['speedAdjustment'] }))}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
          >
            <option value="off">Free-flow (posted/class speeds)</option>
            <option value="auto">Auto — calibrate from trajectory / time of day</option>
            <option value="manual">Manual factor</option>
          </select>
          <span className="text-xs text-gray-400 mt-0.5 block">
            Auto measures real speeds from the GPS trajectory; without usable
            movement data it falls back to a rush-hour/time-of-day factor.
          </span>
        </label>

        {params.speedAdjustment === 'manual' && (
          <label className="block">
            <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
              Speed Factor: ×{params.speedFactor.toFixed(2)}
            </span>
            <input
              type="range" min={0.25} max={1.5} step={0.05}
              value={params.speedFactor}
              onChange={e => dispatch(updateParams({ speedFactor: Number(e.target.value) }))}
              className="w-full accent-blue-600"
            />
            <span className="text-xs text-gray-400 mt-0.5 block">
              Real speed = factor × profile speed (0.55 ≈ urban rush hour)
            </span>
          </label>
        )}
      </ParamSection>

      {/* Time budget & 3-D structure */}
      <ParamSection title="Time budget">
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
            Time budget T = anchor B time − anchor A time. A road is in the prism
            when travel(A→x) + travel(x→B) + A ≤ T.
          </span>
        </label>

        {/* Time slices — number of stacked 3-D levels in the prism */}
        <label className="block">
          <span className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">
            Time Slices: {params.timeSlices}
          </span>
          <input
            type="range" min={2} max={30} step={1}
            value={params.timeSlices}
            onChange={e => dispatch(updateParams({ timeSlices: Number(e.target.value) }))}
            className="w-full accent-blue-600"
          />
          <span className="text-xs text-gray-400 mt-0.5 block">
            Vertical levels of the 3-D prism between A and B · the flat 2-D PPA is
            their projection
          </span>
        </label>
      </ParamSection>

      {/* Road network dataset */}
      <ParamSection title="Road network">
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
      </ParamSection>
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
    timeSlices: number;
    speedAdjustment: string;
    speedFactor: number;
  },
  mapDatasets: Record<string, MapDataset>,
  ownedDatasetIds: string[],
  researchArea: FeatureCollection | null,
): Promise<FeatureCollection[]> {
  const sourceData = buildPrismSourceData(mapDatasets, ownedDatasetIds);

  // Send all trajectory Point features so the backend can derive the global
  // bounds + time range, which only align the prism's Z scale with the
  // rendered trajectory height. The two-anchor prism itself depends only on
  // the two picked anchors (A and B) — no per-GPS-point sampling.
  const features = sourceData.features.filter(f => f.geometry?.type === 'Point');

  const options: Record<string, any> = {
    _anchorA: { lng: anchorA.lng, lat: anchorA.lat, alt: anchorA.alt, timestamp: anchorA.timestamp, label: anchorA.label },
    _anchorB: { lng: anchorB.lng, lat: anchorB.lat, alt: anchorB.alt, timestamp: anchorB.timestamp, label: anchorB.label },
    prismMode: 'gps-road-network',
    speedMode: params.speedMode,
    customSpeed: params.customSpeed,
    // Two-anchor network prism: T defaults to the anchor time window
    // (t_B − t_A) on the backend; a road point x is kept when
    // travel(A→x) + travel(x→B) + activity ≤ T.
    minActivityMinutes: params.minActivityMinutes,
    timeSlices: params.timeSlices,
    // Realistic-speed adjustment — 'off' keeps free-flow profile speeds.
    speedAdjustment: params.speedAdjustment,
    speedFactor: params.speedFactor,
  };
  if (params.roadNetworkDatasetId && mapDatasets[params.roadNetworkDatasetId]) {
    options.roadNetworkData = mapDatasets[params.roadNetworkDatasetId].data;
  }

  const raw = await backendApiService.executeTool(
    'space-time-prism',
    { type: 'FeatureCollection', features },
    options,
    { time: '_timestamp' },
    undefined,
    researchArea ?? undefined,
  );

  if (!raw?.success) {
    throw new Error(raw?.error ?? 'PPA road-network backend call failed');
  }

  return normalizeBackendResponse(raw, 'space-time-prism').outputs;
}

/** Main-map draw order for explorer layers (lower renders underneath). */
function prismLayerRank(datasetId: string): number {
  if (datasetId.includes('ppa-dwell-surface')) return 0;
  if (datasetId.includes('ppa-road-network-ground')) return 1;
  if (datasetId.includes('ppa-road-network')) return 2;
  if (datasetId.includes('prism-anchors')) return 4;
  return 3;
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
