import { useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { setViewState } from '@/stores/map-slice';
import { setAnimationPlaying, setAnimationProgress, setAnimationSpeed, setAnimationMode, setAnimationLoop } from '@/stores/map-slice';
import { updateSettings } from '@/stores/settings-slice';
import { togglePinMode, clearPins } from '@/stores/pin-slice';
import { closeExplorer } from '@/stores/prism-explorer-slice';
import { Plus, Minus, Compass, Sun, Moon, Globe, Play, Pause, RotateCcw, Repeat, Layers, AlignStartVertical, MapPin, X } from 'lucide-react';
import type { AnimationMode } from '@/interfaces/map-types';

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8] as const;

export const MapControls: React.FC = () => {
  const dispatch = useAppDispatch();
  const viewState = useAppSelector(s => s.map.viewState);
  const mapStyle = useAppSelector(s => s.settings.defaultMapStyle);
  const animation = useAppSelector(s => s.map.animation);
  const datasets = useAppSelector(s => s.map.datasets);
  const pinMode = useAppSelector(s => s.pin.pinMode);
  const pinCount = useAppSelector(s => s.pin.pins.length);

  // Toggle pin-point mode. Entering it disables the space-time prism explorer.
  const togglePins = () => {
    if (!pinMode) dispatch(closeExplorer());
    dispatch(togglePinMode());
  };

  // Show animation controls when ANY temporal data exists (trajectories, STKDE, prism).
  // Space-Time Cube is a static 3D view, so its layers are excluded — no animation player.
  const hasTemporalData = useAppSelector(s =>
    s.map.layers.some(l =>
      !l.datasetId.startsWith('space-time-cube') &&
      ((l.type === 'line' && l.config?.segmentData) ||
        l.config?.animateByTime === true)
    ),
  );

  // Derive min/max timestamps from all datasets
  const timeRange = useMemo(() => {
    let minT = Infinity;
    let maxT = -Infinity;
    for (const ds of Object.values(datasets)) {
      for (const f of ds.data.features) {
        const t = f.properties?._timestamp as number | undefined;
        if (typeof t === 'number' && isFinite(t)) {
          if (t < minT) minT = t;
          if (t > maxT) maxT = t;
        }
      }
    }
    if (!isFinite(minT) || !isFinite(maxT)) return null;
    return { min: minT, max: maxT };
  }, [datasets]);

  const slices = animation.sliceCount;
  const sliderStep = slices > 0 ? 1 / slices : 0.002;

  // Current slice index (1-based)
  const currentSlice = slices > 0
    ? Math.min(slices, Math.max(1, Math.ceil(animation.currentProgress * slices)))
    : 0;

  const zoomIn = () => dispatch(setViewState({ zoom: Math.min(viewState.zoom + 1, 20) }));
  const zoomOut = () => dispatch(setViewState({ zoom: Math.max(viewState.zoom - 1, 0) }));
  const resetBearing = () => dispatch(setViewState({ bearing: 0, pitch: 0 }));

  const cycleStyle = () => {
    const order: ('light' | 'dark' | 'satellite')[] = ['light', 'dark', 'satellite'];
    const next = order[(order.indexOf(mapStyle) + 1) % order.length];
    dispatch(updateSettings({ defaultMapStyle: next }));
  };

  const togglePlay = () => {
    if (animation.isPlaying) {
      dispatch(setAnimationPlaying(false));
    } else {
      if (animation.currentProgress >= 1) {
        dispatch(setAnimationProgress(0));
      }
      dispatch(setAnimationPlaying(true));
    }
  };

  const resetAnim = () => {
    dispatch(setAnimationPlaying(false));
    dispatch(setAnimationProgress(1));
  };

  const toggleMode = () => {
    const next: AnimationMode = animation.mode === 'progressive' ? 'window' : 'progressive';
    dispatch(setAnimationMode(next));
  };

  const toggleLoop = () => {
    dispatch(setAnimationLoop(!animation.loop));
  };

  // Current time label derived from progress + time range
  const currentTimeLabel = useMemo(() => {
    if (!timeRange) return null;
    const currentMs = timeRange.min + animation.currentProgress * (timeRange.max - timeRange.min);
    return formatTimestamp(currentMs);
  }, [timeRange, animation.currentProgress]);

  // Slice label — generic, not "Hour"
  const sliceLabel = slices > 0
    ? `Slice ${currentSlice} of ${slices}`
    : null;

  const styleIcon = mapStyle === 'dark'
    ? <Moon className="w-4 h-4" />
    : mapStyle === 'satellite'
      ? <Globe className="w-4 h-4" />
      : <Sun className="w-4 h-4" />;

  return (
    <>
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-1">
        <ControlButton onClick={zoomIn} title="Zoom in">
          <Plus className="w-4 h-4" />
        </ControlButton>
        <ControlButton onClick={zoomOut} title="Zoom out">
          <Minus className="w-4 h-4" />
        </ControlButton>
        <ControlButton onClick={resetBearing} title="Reset bearing & pitch">
          <Compass className="w-4 h-4" />
        </ControlButton>
        <ControlButton onClick={cycleStyle} title={`Map style: ${mapStyle}`}>
          {styleIcon}
        </ControlButton>
        <ControlButton
          onClick={togglePins}
          active={pinMode}
          title={pinMode ? 'Pin mode ON — click a feature to drop a pin, click a pin to remove it (prism disabled). Click to turn off.' : 'Pin mode: drop pins on features'}
        >
          <MapPin className="w-4 h-4" />
        </ControlButton>
        {pinCount > 0 && (
          <ControlButton onClick={() => dispatch(clearPins())} title={`Clear ${pinCount} pin${pinCount > 1 ? 's' : ''}`}>
            <X className="w-4 h-4" />
          </ControlButton>
        )}
      </div>

      {hasTemporalData && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 px-4 py-3 flex flex-col gap-2 min-w-[380px]">
          {/* Current time display + slice info + start/end range */}
          <div className="flex flex-col items-center gap-0.5">
            {currentTimeLabel && (
              <div className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-100 tracking-wide">
                {currentTimeLabel}
              </div>
            )}
            <div className="flex items-center gap-2">
              {sliceLabel && (
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  {sliceLabel}
                </span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                animation.mode === 'window'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
              }`}>
                {animation.mode === 'window' ? 'Slice' : 'Cumulative'}
              </span>
            </div>
            {timeRange && (
              <div className="flex justify-between w-full text-[10px] font-mono text-gray-400 dark:text-gray-500">
                <span>{formatTimestamp(timeRange.min)}</span>
                <span>{formatTimestamp(timeRange.max)}</span>
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2">
            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              title={animation.isPlaying ? 'Pause' : 'Play'}
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white cursor-pointer transition-colors"
            >
              {animation.isPlaying
                ? <Pause className="w-4 h-4" />
                : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            {/* Time slider — snaps to slices when sliceCount > 0 */}
            <input
              type="range"
              min={0}
              max={1}
              step={sliderStep}
              value={animation.currentProgress}
              onChange={e => {
                dispatch(setAnimationPlaying(false));
                dispatch(setAnimationProgress(parseFloat(e.target.value)));
              }}
              className="flex-1 accent-blue-600 cursor-pointer"
              title={sliceLabel
                ? sliceLabel
                : `Progress: ${Math.round(animation.currentProgress * 100)}%`}
            />

            {/* Mode toggle: progressive / window */}
            <button
              onClick={toggleMode}
              title={animation.mode === 'progressive'
                ? 'Cumulative mode (showing all up to current time) — click to switch to Slice mode'
                : 'Slice mode (showing only current time slice) — click to switch to Cumulative mode'}
              className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded cursor-pointer transition-colors ${
                animation.mode === 'window'
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}
            >
              {animation.mode === 'window'
                ? <Layers className="w-3.5 h-3.5" />
                : <AlignStartVertical className="w-3.5 h-3.5" />}
            </button>

            {/* Loop toggle */}
            <button
              onClick={toggleLoop}
              title={animation.loop ? 'Loop on — click to disable' : 'Loop off — click to enable'}
              className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded cursor-pointer transition-colors ${
                animation.loop
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>

            {/* Reset */}
            <button
              onClick={resetAnim}
              title="Reset (show all)"
              className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Speed selector row */}
          <div className="flex items-center justify-center gap-1">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1 uppercase tracking-wider">Speed</span>
            {SPEED_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => dispatch(setAnimationSpeed(s))}
                className={`text-xs font-medium px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  animation.speed === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Format a timestamp for display — always includes year.
 */
function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function ControlButton({
  onClick,
  title,
  children,
  active = false,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex items-center justify-center backdrop-blur-sm rounded-md shadow border cursor-pointer transition-colors ${
        active
          ? 'bg-emerald-500 hover:bg-emerald-600 border-emerald-600 text-white'
          : 'bg-white/90 dark:bg-gray-900/90 hover:bg-gray-100 dark:hover:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
      }`}
    >
      {children}
    </button>
  );
}
