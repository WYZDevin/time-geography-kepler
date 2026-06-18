import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { setViewState, setMapStyle, pushAnchor, setAnimationProgress, setAnimationPlaying } from '@/stores/map-slice';
import { setAnchorA, setAnchorB, updateParams } from '@/stores/prism-explorer-slice';
import { addPin, removePin, type Pin } from '@/stores/pin-slice';
import { selectResearchAreaGeoJSON } from '@/stores/research-area-slice';
import { createDeckLayers } from '@/services/layer-factory';
import { ScatterplotLayer, LineLayer, GeoJsonLayer } from '@deck.gl/layers';
import { WebMercatorViewport } from '@deck.gl/core';
import type { FeatureCollection } from '@/interfaces/data-interfaces';
import type { MapViewState } from '@/interfaces/map-types';
import { Map } from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { MapLegend } from './map-legend';
import { MapControls } from './map-controls';
import { PrismIllustration } from './prism-illustration';
import { resolveMapStyleProp, skyGradientClass } from '@/utils/map-styles';
import 'maplibre-gl/dist/maplibre-gl.css';

type LngLatBounds = [[number, number], [number, number]];

/**
 * Bounding box of a polygon FeatureCollection (the research area). Walks nested
 * Polygon/MultiPolygon coordinate arrays down to [lng, lat] pairs. Returns null
 * when there are no finite coordinates.
 */
function researchAreaBounds(fc: FeatureCollection | null): LngLatBounds | null {
  if (!fc || fc.features.length === 0) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const visit = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === 'number') {
      const [lng, lat] = node as number[];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    if (Array.isArray(node)) for (const child of node) visit(child);
  };
  for (const f of fc.features) {
    const geom = f.geometry as { coordinates?: unknown } | null;
    if (geom?.coordinates) visit(geom.coordinates);
  }
  if (!isFinite(minLng) || !isFinite(minLat)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

/**
 * View state that frames `bounds` within a `width`×`height` viewport, flattened
 * to a top-down view so the boundary reads clearly. Returns null if the
 * viewport has no size yet.
 */
function fitViewToBounds(bounds: LngLatBounds, width: number, height: number): Partial<MapViewState> | null {
  if (width <= 0 || height <= 0) return null;
  try {
    const { longitude, latitude, zoom } = new WebMercatorViewport({ width, height })
      .fitBounds(bounds, { padding: 48 });
    return {
      longitude,
      latitude,
      zoom: Math.min(Math.max(zoom, 1), 18),
      pitch: 0,
      bearing: 0,
      transitionDuration: 600,
    };
  } catch {
    return null;
  }
}

// Keys to hide from tooltip (internal/visual-only properties)
const TOOLTIP_HIDDEN_KEYS = new Set([
  '_geojson', '_layer_config', '_dataset_type', '_original_index',
  '_sequence', '_time_progress', '_is_stay_point', '_stay_cluster',
]);

interface HoverInfo {
  x: number;
  y: number;
  properties: Record<string, unknown>;
}

interface DeckMapViewProps {
  width: number;
  height: number;
}

export const DeckMapView: React.FC<DeckMapViewProps> = ({ width, height }) => {
  const dispatch = useAppDispatch();
  const { viewState, mapStyle, datasets, layers: layerDescriptors, animation } = useAppSelector(s => s.map);
  const settingsMapStyle = useAppSelector(s => s.settings.defaultMapStyle);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  // Sync settings map style → map slice
  const effectiveStyle = settingsMapStyle === 'satellite' ? 'satellite'
    : settingsMapStyle === 'dark' ? 'dark-matter'
    : 'positron';

  useEffect(() => {
    if (effectiveStyle !== mapStyle) {
      dispatch(setMapStyle(effectiveStyle as 'positron' | 'dark-matter' | 'satellite'));
    }
  }, [effectiveStyle, mapStyle, dispatch]);

  // Track running progress in a ref to avoid stale closures in rAF
  const progressRef = useRef(animation.currentProgress);
  progressRef.current = animation.currentProgress;
  const accumRef = useRef(0);

  // Track loop setting in a ref so rAF closure sees latest value
  const loopRef = useRef(animation.loop);
  loopRef.current = animation.loop;

  // Animation loop — steps through discrete time slices when sliceCount > 0
  useEffect(() => {
    if (!animation.isPlaying) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const speed = animation.speed;
    const slices = animation.sliceCount;
    accumRef.current = 0;

    const tick = (now: number) => {
      if (lastTickRef.current === 0) lastTickRef.current = now;
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      if (slices > 0) {
        // Discrete stepping: 1 slice per (baseDuration / sliceCount / speed) seconds
        // baseDuration = max(sliceCount * 0.3, 5) seconds at 1x → ≥0.3s per slice
        const baseDuration = Math.max(slices * 0.3, 5);
        const secsPerSlice = baseDuration / slices / speed;
        accumRef.current += dt;

        if (accumRef.current >= secsPerSlice) {
          accumRef.current -= secsPerSlice;
          const stepSize = 1 / slices;
          const next = progressRef.current + stepSize;
          if (next >= 1) {
            if (loopRef.current) {
              dispatch(setAnimationProgress(0));
            } else {
              dispatch(setAnimationProgress(1));
              dispatch(setAnimationPlaying(false));
              return;
            }
          } else {
            dispatch(setAnimationProgress(next));
          }
        }
      } else {
        // Smooth continuous: 10 seconds to traverse 0→1 at 1x
        const step = (dt / 10) * speed;
        const next = progressRef.current + step;
        if (next >= 1) {
          if (loopRef.current) {
            dispatch(setAnimationProgress(0));
          } else {
            dispatch(setAnimationProgress(1));
            dispatch(setAnimationPlaying(false));
            return;
          }
        } else {
          dispatch(setAnimationProgress(next));
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    lastTickRef.current = 0;
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [animation.isPlaying, animation.speed, animation.sliceCount, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prism explorer state (must be before layers memo that references these)
  const prismMode = useAppSelector(s => s.prismExplorer.mode);
  const prismAnchorA = useAppSelector(s => s.prismExplorer.anchorA);
  const prismAnchorB = useAppSelector(s => s.prismExplorer.anchorB);
  const isExplorerActive = prismMode !== 'idle';

  // Pin-point mode
  const pinMode = useAppSelector(s => s.pin.pinMode);
  const pins = useAppSelector(s => s.pin.pins);

  // Spread a plain copy — Immer freezes Redux state objects, but deck.gl's
  // controller mutates viewState (adds `padding`, `transitionDuration`, etc.)
  // maxPitch 85 lifts deck.gl's 60° default; 85 is MapLibre's hard ceiling.
  const mutableViewState = useMemo(() => ({ ...viewState, maxPitch: 85 }), [viewState]);

  // Build deck.gl layers from descriptors (ephemeral, not stored)
  const baseLayers = useMemo(
    () => createDeckLayers(layerDescriptors, datasets, animation.currentProgress, animation.mode, animation.sliceCount),
    [layerDescriptors, datasets, animation.currentProgress, animation.mode, animation.sliceCount],
  );

  // Overlay layers for prism explorer anchor markers + provisional A→B line
  const explorerOverlayLayers = useMemo(() => {
    if (!isExplorerActive) return [];
    const overlays: any[] = [];

    // Anchor A marker + vertical stem
    if (prismAnchorA) {
      overlays.push(
        new LineLayer({
          id: 'prism-anchor-a-stem',
          data: [prismAnchorA],
          getSourcePosition: (d: any) => [d.lng, d.lat, 0],
          getTargetPosition: (d: any) => [d.lng, d.lat, d.alt ?? 0],
          getColor: [220, 50, 50, 160],
          getWidth: 2,
          widthUnits: 'pixels' as const,
          pickable: false,
        }),
        new ScatterplotLayer({
          id: 'prism-anchor-a-marker',
          data: [prismAnchorA],
          getPosition: (d: any) => [d.lng, d.lat, d.alt ?? 0],
          getFillColor: [220, 50, 50, 220],
          getLineColor: [255, 255, 255, 255],
          getRadius: 60,
          radiusUnits: 'meters' as const,
          radiusMinPixels: 8,
          radiusMaxPixels: 20,
          filled: true,
          stroked: true,
          lineWidthUnits: 'pixels' as const,
          getLineWidth: 3,
          pickable: false,
        }),
      );
    }

    // Anchor B marker + vertical stem
    if (prismAnchorB) {
      overlays.push(
        new LineLayer({
          id: 'prism-anchor-b-stem',
          data: [prismAnchorB],
          getSourcePosition: (d: any) => [d.lng, d.lat, 0],
          getTargetPosition: (d: any) => [d.lng, d.lat, d.alt ?? 0],
          getColor: [50, 100, 220, 160],
          getWidth: 2,
          widthUnits: 'pixels' as const,
          pickable: false,
        }),
        new ScatterplotLayer({
          id: 'prism-anchor-b-marker',
          data: [prismAnchorB],
          getPosition: (d: any) => [d.lng, d.lat, d.alt ?? 0],
          getFillColor: [50, 100, 220, 220],
          getLineColor: [255, 255, 255, 255],
          getRadius: 60,
          radiusUnits: 'meters' as const,
          radiusMinPixels: 8,
          radiusMaxPixels: 20,
          filled: true,
          stroked: true,
          lineWidthUnits: 'pixels' as const,
          getLineWidth: 3,
          pickable: false,
        }),
      );
    }

    return overlays;
  }, [isExplorerActive, prismAnchorA, prismAnchorB]);

  // Dropped pins: a head at the feature's elevation with a stem down to the
  // ground (z = 0) and a ground contact dot. depthTest:false keeps them visible
  // through 3D geometry (cubes, prisms) they may sit inside.
  const pinOverlayLayers = useMemo(() => {
    if (pins.length === 0) return [];
    return [
      new LineLayer({
        id: 'pins-stem',
        data: pins,
        getSourcePosition: (d: Pin) => [d.lng, d.lat, d.alt ?? 0],
        getTargetPosition: (d: Pin) => [d.lng, d.lat, 0],
        getColor: [16, 185, 129, 220],
        getWidth: 2.5,
        widthUnits: 'pixels' as const,
        widthMinPixels: 1.5,
        pickable: false,
        parameters: { depthTest: false },
      }),
      new ScatterplotLayer({
        id: 'pins-head',
        data: pins,
        getPosition: (d: Pin) => [d.lng, d.lat, d.alt ?? 0],
        getFillColor: [16, 185, 129, 240],
        getLineColor: [255, 255, 255, 255],
        getRadius: 55,
        radiusUnits: 'meters' as const,
        radiusMinPixels: 7,
        radiusMaxPixels: 18,
        filled: true,
        stroked: true,
        lineWidthUnits: 'pixels' as const,
        getLineWidth: 2.5,
        pickable: true,
        parameters: { depthTest: false },
      }),
      new ScatterplotLayer({
        id: 'pins-ground',
        data: pins,
        getPosition: (d: Pin) => [d.lng, d.lat, 0],
        getFillColor: [16, 185, 129, 120],
        getRadius: 28,
        radiusUnits: 'meters' as const,
        radiusMinPixels: 3,
        radiusMaxPixels: 9,
        filled: true,
        stroked: false,
        pickable: false,
      }),
    ];
  }, [pins]);

  // Research area boundary overlay — a stroked, lightly-filled polygon drawn
  // beneath analysis output so the user can see the clip region.
  const researchArea = useAppSelector(selectResearchAreaGeoJSON);
  const researchAreaEnabled = useAppSelector(s => s.researchArea.enabled);
  const researchAreaVisible = useAppSelector(s => s.researchArea.visible);

  // When the research area is set or changed, frame it: fit the camera to the
  // boundary so the user immediately sees the area they defined. We remember the
  // last-fitted bounds and skip the initial mount (adopt a persisted area
  // without yanking the camera), so the zoom only fires on a genuine change.
  const fittedAreaSig = useRef<string | null>(null);
  const areaFitInitialized = useRef(false);
  useEffect(() => {
    const bounds = researchAreaBounds(researchArea);
    const sig = bounds ? bounds.flat().map(n => n.toFixed(5)).join(',') : null;
    if (!areaFitInitialized.current) {
      areaFitInitialized.current = true;
      fittedAreaSig.current = sig;
      return;
    }
    if (!sig || sig === fittedAreaSig.current) return;
    const view = bounds && fitViewToBounds(bounds, width, height);
    if (!view) return; // viewport not sized yet — retry when width/height land
    fittedAreaSig.current = sig;
    dispatch(setViewState(view));
  }, [researchArea, width, height, dispatch]);

  const researchAreaOverlayLayers = useMemo(() => {
    if (!researchAreaVisible || !researchArea || researchArea.features.length === 0) return [];
    const active = researchAreaEnabled;
    return [
      new GeoJsonLayer({
        id: 'research-area-boundary',
        data: researchArea as any,
        stroked: true,
        filled: true,
        getFillColor: active ? [16, 185, 129, 25] : [120, 120, 120, 15],
        getLineColor: active ? [16, 185, 129, 220] : [120, 120, 120, 160],
        getLineWidth: 2,
        lineWidthUnits: 'pixels' as const,
        lineWidthMinPixels: 2,
        pickable: false,
        parameters: { depthTest: false },
      }),
    ];
  }, [researchArea, researchAreaEnabled, researchAreaVisible]);

  const deckLayers = useMemo(
    () => [...researchAreaOverlayLayers, ...baseLayers, ...explorerOverlayLayers, ...pinOverlayLayers],
    [researchAreaOverlayLayers, baseLayers, explorerOverlayLayers, pinOverlayLayers],
  );

  const mapStyleProp = resolveMapStyleProp(mapStyle);

  const onViewStateChange = useCallback(
    (params: { viewState: Record<string, unknown> }) => {
      const vs = params.viewState;
      dispatch(setViewState({
        longitude: vs.longitude as number,
        latitude: vs.latitude as number,
        zoom: vs.zoom as number,
        pitch: vs.pitch as number,
        bearing: vs.bearing as number,
      }));
    },
    [dispatch],
  );

  const onHover = useCallback((info: { x: number; y: number; object?: unknown }) => {
    if (!info.object) {
      setHoverInfo(null);
      return;
    }

    // Extract properties from different layer types
    const obj = info.object as Record<string, unknown>;
    let properties: Record<string, unknown> | null = null;

    if (obj.properties && typeof obj.properties === 'object') {
      // GeoJSON feature (GeoJsonLayer, ScatterplotLayer)
      properties = obj.properties as Record<string, unknown>;
    } else if (obj.source && obj.properties) {
      // Line segment with attached properties (LineLayer)
      properties = obj.properties as Record<string, unknown>;
    } else if (obj.source && obj.target) {
      // Line segment without properties (axes)
      return;
    }

    if (!properties || Object.keys(properties).length === 0) {
      setHoverInfo(null);
      return;
    }

    // PPA reachable-roads segments carry ~25 backend bookkeeping fields
    // (raw seconds, edge IDs, multiple dwell quantiles, etc.). End users
    // only care about: which road, how long it takes to reach it, how
    // much time is left to do something there, and which sample it came
    // from. Detect the segment by its PPA-specific signature and replace
    // the dump with a curated, already-humanised map.
    if ('edge_id' in properties && 'activity_sec_min' in properties) {
      const ppa = buildPpaTooltipProps(properties);
      if (Object.keys(ppa).length === 0) {
        setHoverInfo(null);
      } else {
        setHoverInfo({ x: info.x, y: info.y, properties: ppa });
      }
      return;
    }

    // Space-Time Cube voxels: surface the environmental exposure value (mean
    // env_value aggregated into the cell) front and centre, alongside the point
    // count and slice time. The raw feature otherwise dumps z, slice index,
    // extrusion height and time-order bookkeeping into the tooltip. Detected by
    // the cell signature (time_slice_index + count) because deck-adapter strips
    // _dataset_type from feature properties before rendering.
    if ('time_slice_index' in properties && 'count' in properties) {
      const cube = buildCubeTooltipProps(properties);
      if (Object.keys(cube).length === 0) {
        setHoverInfo(null);
      } else {
        setHoverInfo({ x: info.x, y: info.y, properties: cube });
      }
      return;
    }

    // Filter out internal keys
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(properties)) {
      if (!TOOLTIP_HIDDEN_KEYS.has(k) && !k.startsWith('_layer_') && v != null) {
        filtered[k] = v;
      }
    }

    if (Object.keys(filtered).length === 0) {
      setHoverInfo(null);
      return;
    }

    setHoverInfo({ x: info.x, y: info.y, properties: filtered });
  }, []);

  // Legacy anchors (workflow-based prism)
  const selectedAnchors = useAppSelector(s => s.map.selectedAnchors);

  // Click handler — routes to explorer or legacy anchors
  const onClick = useCallback((info: { object?: unknown; coordinate?: number[] }) => {
    const obj = info.object as Record<string, unknown> | undefined;

    // Clicking an existing pin removes just that pin (works in any mode).
    const clickedLayerId = (info as { layer?: { id?: string } }).layer?.id;
    if (clickedLayerId === 'pins-head' && typeof obj?.id === 'string') {
      dispatch(removePin(obj.id));
      return;
    }

    const props = ((obj?.properties ?? {}) as Record<string, unknown>);

    let lng: number | undefined;
    let lat: number | undefined;
    let alt = 0;
    let timestamp = 0;
    let label = 'Map Click';

    if (props.latitude != null && props.longitude != null) {
      lat = props.latitude as number;
      lng = props.longitude as number;
      alt = (props._height as number) ?? 0;
      timestamp = (props._timestamp as number) ?? 0;
      const stayId = props._stay_id as number | undefined;
      label = stayId != null
        ? `Stay #${stayId}`
        : timestamp
          ? `Point at ${new Date(timestamp).toLocaleTimeString()}`
          : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    // Pin-point mode: drop a pin at the clicked feature (or raw ground point)
    // and anchor it to the ground. The space-time prism is disabled here.
    if (pinMode) {
      let plng = lng;
      let plat = lat;
      let palt = alt;
      if ((plng == null || plat == null) && info.coordinate && info.coordinate.length >= 2) {
        plng = info.coordinate[0];
        plat = info.coordinate[1];
        palt = 0;
      }
      if (plng != null && plat != null) {
        dispatch(addPin({
          lng: plng,
          lat: plat,
          alt: palt,
          label: label === 'Map Click' ? `${plat.toFixed(4)}, ${plng.toFixed(4)}` : label,
        }));
      }
      return;
    }

    // When setting prism explorer anchors, fall back to the raw map coordinate
    // so the user can click anywhere on the map (not just on GPS point features).
    if ((lng == null || lat == null) && (prismMode === 'selectingA' || prismMode === 'selectingB')) {
      if (info.coordinate && info.coordinate.length >= 2) {
        lng = info.coordinate[0];
        lat = info.coordinate[1];
        label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }
    }

    if (lng == null || lat == null) return;

    if (prismMode === 'selectingA') {
      dispatch(setAnchorA({ lng, lat, alt, timestamp, label }));
    } else if (prismMode === 'selectingB') {
      dispatch(setAnchorB({ lng, lat, alt, timestamp, label }));
    } else {
      dispatch(pushAnchor({ lng, lat, alt, timestamp, label }));
    }
  }, [dispatch, prismMode, pinMode]);

  // Backdrop for the transparent above-horizon region at high pitch — the map
  // paints no sky, so the container background shows through. Follows the
  // basemap (not the app theme): the map style setting only restyles the map.
  const skyClass = skyGradientClass(mapStyle);

  return (
    <div
      className={`relative ${skyClass}`}
      style={{ width, height }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <DeckGL
        width={width}
        height={height}
        viewState={mutableViewState}
        onViewStateChange={onViewStateChange}
        onHover={onHover}
        onClick={onClick}
        layers={deckLayers}
        controller={{ dragRotate: true }}
      >
        <Map
          mapStyle={mapStyleProp}
          style={{ width, height }}
          maxPitch={85}
        />
      </DeckGL>
      <MapControls />
      <MapLegend />
      <PrismIllustration />
      {!isExplorerActive && selectedAnchors.length > 0 && <AnchorSelectionBadge anchors={selectedAnchors} />}
      {hoverInfo && <MapTooltip info={hoverInfo} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tooltip component
// ---------------------------------------------------------------------------

function MapTooltip({ info }: { info: HoverInfo }) {
  const entries = Object.entries(info.properties);
  if (entries.length === 0) return null;

  return (
    <div
      className="absolute z-20 pointer-events-none bg-gray-900/90 text-white text-xs rounded-lg shadow-lg px-3 py-2 max-w-xs"
      style={{
        left: info.x + 12,
        top: info.y + 12,
      }}
    >
      <table className="border-collapse">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td className="pr-3 py-0.5 text-gray-400 font-medium whitespace-nowrap align-top">
                {formatKey(key)}
              </td>
              <td className="py-0.5 text-gray-100 break-all max-w-[180px]">
                {formatValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anchor selection badge (shows A/B picks for Space-Time Prism)
// ---------------------------------------------------------------------------

function AnchorSelectionBadge({ anchors }: { anchors: { lng: number; lat: number; alt: number; timestamp: number; label: string }[] }) {
  const dispatch = useAppDispatch();

  const handleBuildPrism = () => {
    dispatch(updateParams({ prismMode: 'network', showPPA: true, showAxes: true }));
    dispatch(setAnchorA(anchors[0]));
    dispatch(setAnchorB(anchors[1]));
  };

  return (
    <div className="absolute top-4 right-4 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-lg shadow-lg border border-blue-300 px-4 py-3 max-w-64">
      <div className="text-xs font-bold text-blue-700 dark:text-blue-300 mb-2 uppercase tracking-wide">
        Prism Anchors
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold flex-shrink-0">A</span>
          <span className="text-gray-700 dark:text-gray-300 truncate">
            {anchors[0]?.label ?? 'Click a point on the map'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold flex-shrink-0">B</span>
          <span className="text-gray-700 dark:text-gray-300 truncate">
            {anchors.length >= 2
              ? anchors[1].label
              : anchors.length === 1
                ? 'Click another point'
                : '—'}
          </span>
        </div>
      </div>
      {anchors.length >= 2 && (
        <button
          type="button"
          onClick={handleBuildPrism}
          className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          Build Space-Time Prism
        </button>
      )}
    </div>
  );
}

function buildPpaTooltipProps(properties: Record<string, unknown>): Record<string, unknown> {
  // PPA-only fields: the two quantities the PPA engine actually computes
  // per reachable segment. Everything else (road type, GPS sampling
  // timestamps, cluster bookkeeping) is intentionally omitted.
  const out: Record<string, unknown> = {};

  const dwellMin = formatSecondsAsMin(properties.activity_sec_mid);
  if (dwellMin) out['Dwell time'] = dwellMin;

  const travelMin = formatSecondsAsMin(properties.travel_sec_mid);
  if (travelMin) out['Travel time'] = travelMin;

  return out;
}

function buildCubeTooltipProps(properties: Record<string, unknown>): Record<string, unknown> {
  // Space-Time Cube cells carry a handful of useful fields among internal
  // bookkeeping. Show the exposure value (mean env_value) when an environment
  // dataset was joined, plus the point count and the slice time.
  const out: Record<string, unknown> = {};

  const exposure = properties.env_value;
  if (typeof exposure === 'number' && Number.isFinite(exposure)) {
    out['Exposure'] = exposure.toFixed(2);
  }

  const count = properties.count;
  if (typeof count === 'number' && Number.isFinite(count)) {
    out['Points'] = count;
  }

  const timeValue = properties.time_value;
  if (typeof timeValue === 'string') {
    const d = new Date(timeValue);
    if (!isNaN(d.getTime())) out['Time'] = d.toLocaleString();
  }

  return out;
}

function formatSecondsAsMin(value: unknown): string | null {
  const secs = Number(value);
  if (!Number.isFinite(secs) || secs < 0) return null;
  const mins = secs / 60;
  if (mins < 1) return `${Math.round(secs)} s`;
  if (mins < 10) return `${mins.toFixed(1)} min`;
  return `${Math.round(mins)} min`;
}

function formatKey(key: string): string {
  // Convert _snake_case to Title Case
  return key
    .replace(/^_+/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(4);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  return str.length > 60 ? str.slice(0, 57) + '...' : str;
}
