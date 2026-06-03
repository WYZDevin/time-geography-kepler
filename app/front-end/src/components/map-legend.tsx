import { useAppDispatch, useAppSelector } from '@/stores/store';
import { updateLayer } from '@/stores/map-slice';
import { startExplorer } from '@/stores/prism-explorer-slice';
import { ColorPicker } from './ui/color-picker';
import { exportViewAsGeoJSON } from '@/services/export-service';
import { Eye, EyeOff, ChevronDown, ChevronRight, Diamond, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DeckLayerDescriptor, MapDataset } from '@/interfaces/map-types';

const LINE_TYPES = new Set(['line', 'path', 'geojson']);

// Above this many trajectories the per-user list is collapsed behind a summary
// row by default (still expandable + searchable); at or below it the list shows
// inline, since a handful of distinct colors is readable at a glance.
const INLINE_USER_LIMIT = 12;
// Safety cap on how many user rows we mount at once when expanded, so a dataset
// with thousands of trajectories can't flood the DOM. The filter narrows it.
const MAX_RENDERED_USERS = 200;

const rgbaToCss = (rgba: number[] | undefined, fallback: string): string =>
  Array.isArray(rgba) ? `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})` : fallback;

// Pick up to n evenly-spaced colors from the list, for the summary swatch.
function sampleColors(colors: string[], n: number): string[] {
  if (colors.length <= n) return colors;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(colors[Math.round((i * (colors.length - 1)) / (n - 1))]);
  }
  return out;
}

/**
 * Legend entry for the 3D Trajectory layer when it is split by user.
 *
 * Few users  → inline list of colored "User N" rows (as before).
 * Many users → a single "Trajectories (N)" summary row with a multi-hue swatch
 *              and a visibility toggle; expanding reveals a searchable,
 *              height-capped list so a specific user can still be looked up.
 */
const TrajectoryLegendEntry: React.FC<{
  layer: DeckLayerDescriptor;
  dataset: MapDataset | undefined;
  onToggleVisible: () => void;
}> = ({ layer, dataset, onToggleVisible }) => {
  const layerColor = `rgb(${layer.color[0]}, ${layer.color[1]}, ${layer.color[2]})`;

  const users = useMemo(() => {
    const seen = new Map<string, number[] | undefined>();
    for (const f of dataset?.data.features ?? []) {
      const userId = f.properties?._user_id as string | undefined;
      if (userId === undefined) continue;
      if (!seen.has(userId)) seen.set(userId, f.properties?.color_rgba as number[] | undefined);
    }
    return Array.from(seen, ([id, rgba]) => ({ id, color: rgbaToCss(rgba, layerColor) }));
  }, [dataset?.data.features, layerColor]);

  const many = users.length > INLINE_USER_LIMIT;
  const [expanded, setExpanded] = useState(!many);
  const [query, setQuery] = useState('');

  const swatchStyle = useMemo(() => {
    const sample = sampleColors(users.map(u => u.color), 6);
    return sample.length > 1
      ? { backgroundImage: `linear-gradient(90deg, ${sample.join(', ')})` }
      : { backgroundColor: sample[0] ?? layerColor };
  }, [users, layerColor]);

  if (users.length === 0) return null;

  const q = query.trim().toLowerCase();
  const filtered = q ? users.filter(u => u.id.toLowerCase().includes(q)) : users;
  const shown = filtered.slice(0, MAX_RENDERED_USERS);
  const dim = layer.isVisible ? 1 : 0.3;

  return (
    <div className="rounded">
      {/* Summary header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div
          className="w-3 h-3 rounded-sm border border-gray-300 flex-shrink-0"
          style={{ ...swatchStyle, opacity: dim }}
        />
        <button
          className="p-0 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 flex-shrink-0"
          onClick={() => setExpanded(e => !e)}
          title={expanded ? 'Collapse users' : 'Show users'}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <span
          className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate"
          style={{ opacity: layer.isVisible ? 1 : 0.5 }}
        >
          Trajectories <span className="text-gray-400">({users.length})</span>
        </span>
        <button
          className="p-0.5 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 flex-shrink-0"
          onClick={onToggleVisible}
          title={layer.isVisible ? 'Hide layer' : 'Show layer'}
        >
          {layer.isVisible
            ? <Eye className="w-3.5 h-3.5" />
            : <EyeOff className="w-3.5 h-3.5 text-gray-300" />}
        </button>
      </div>

      {/* Per-user breakdown */}
      {expanded && (
        <div className="ml-5 pr-1 pb-1">
          {many && (
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter users…"
              className="w-full text-[10px] border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 mb-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          )}
          <div className="max-h-40 overflow-y-auto">
            {shown.map(u => (
              <div
                key={u.id}
                className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <div
                  className="w-3 h-3 rounded-sm border border-gray-300 flex-shrink-0"
                  style={{ backgroundColor: u.color, opacity: dim }}
                />
                <span
                  className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate"
                  style={{ opacity: layer.isVisible ? 1 : 0.5 }}
                >
                  User {u.id}
                </span>
              </div>
            ))}
            {filtered.length > shown.length && (
              <div className="px-1 py-1 text-[10px] text-gray-400">
                +{filtered.length - shown.length} more — refine the filter
              </div>
            )}
            {filtered.length === 0 && (
              <div className="px-1 py-1 text-[10px] text-gray-400">No users match “{query}”.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const MapLegend: React.FC = () => {
  const dispatch = useAppDispatch();
  const layers = useAppSelector(s => s.map.layers);
  const datasets = useAppSelector(s => s.map.datasets);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const prismMode = useAppSelector(s => s.prismExplorer.mode);
  const pinMode = useAppSelector(s => s.pin.pinMode);
  // The space-time prism is disabled while pin-point mode is active.
  const showPrismButton = prismMode === 'idle' && !pinMode;

  if (layers.length === 0) {
    return showPrismButton ? (
      <div className="absolute bottom-4 left-4 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3">
        <button
          onClick={() => dispatch(startExplorer())}
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded px-3 py-1.5 transition-colors"
          title="Open Space-Time Prism Explorer"
        >
          <Diamond className="w-3.5 h-3.5" />
          Start Prism Explorer
        </button>
      </div>
    ) : null;
  }

  return (
    <div className="absolute bottom-32 left-4 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-72 max-h-80 overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
          Layers ({layers.length})
        </span>
        {showPrismButton && (
          <button
            onClick={() => dispatch(startExplorer())}
            className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded px-2 py-0.5 transition-colors"
            title="Open Space-Time Prism Explorer"
          >
            <Diamond className="w-3 h-3" />
            Prism Explorer
          </button>
        )}
      </div>

      <div className="p-1">
        {layers.map(layer => {
          // 3D Trajectory split by user: render a collapsible, searchable
          // per-user legend. Single-trajectory runs (no _user_id) fall through
          // to the normal layer row below.
          if (
            layer.datasetId === 'time-geography-trajectory' &&
            datasets[layer.datasetId]?.data.features[0]?.properties?._user_id !== undefined
          ) {
            return (
              <TrajectoryLegendEntry
                key={layer.id}
                layer={layer}
                dataset={datasets[layer.datasetId]}
                onToggleVisible={() =>
                  dispatch(updateLayer({ id: layer.id, changes: { isVisible: !layer.isVisible } }))
                }
              />
            );
          }
          const isExpanded = expandedId === layer.id;
          return (
            <div key={layer.id} className="rounded hover:bg-gray-50 dark:hover:bg-gray-800">
              {/* Layer row */}
              <div className="flex items-center gap-2 px-2 py-1.5">
                {/* Color swatch */}
                <div
                  className="w-3 h-3 rounded-sm border border-gray-300 flex-shrink-0"
                  style={{
                    backgroundColor: `rgb(${layer.color[0]}, ${layer.color[1]}, ${layer.color[2]})`,
                    opacity: layer.isVisible ? 1 : 0.3,
                  }}
                />

                {/* Expand toggle */}
                <button
                  className="p-0 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 flex-shrink-0"
                  onClick={() => setExpandedId(isExpanded ? null : layer.id)}
                >
                  {isExpanded
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />}
                </button>

                {/* Label */}
                <span
                  className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate"
                  style={{ opacity: layer.isVisible ? 1 : 0.5 }}
                >
                  {layer.label}
                </span>

                {/* Visibility toggle */}
                <button
                  className="p-0.5 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 flex-shrink-0"
                  onClick={() =>
                    dispatch(updateLayer({ id: layer.id, changes: { isVisible: !layer.isVisible } }))
                  }
                >
                  {layer.isVisible
                    ? <Eye className="w-3.5 h-3.5" />
                    : <EyeOff className="w-3.5 h-3.5 text-gray-300" />}
                </button>
              </div>

              {/* Expanded controls */}
              {isExpanded && (
                <div className="px-3 pb-2 pt-1 space-y-2 border-t border-gray-100 dark:border-gray-700 ml-5">
                  {/* Opacity slider */}
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">
                      Opacity: {Math.round(layer.opacity * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(layer.opacity * 100)}
                      onChange={e =>
                        dispatch(
                          updateLayer({
                            id: layer.id,
                            changes: { opacity: parseInt(e.target.value) / 100 },
                          }),
                        )
                      }
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Thickness — line / path / geojson only */}
                  {LINE_TYPES.has(layer.type) && (() => {
                    const thickness = (layer.config.thickness as number) ?? (layer.config.widthScale as number) ?? 2;
                    const setThickness = (val: number) => {
                      const clamped = Math.max(0.1, val);
                      dispatch(updateLayer({
                        id: layer.id,
                        changes: { config: { ...layer.config, thickness: clamped, widthScale: clamped } },
                      }));
                    };
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-[10px] text-gray-500">Thickness</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              value={thickness}
                              onChange={e => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val)) setThickness(val);
                              }}
                              className="w-12 text-[10px] border border-gray-200 rounded px-1.5 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            <span className="text-[10px] text-gray-400">px</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="10"
                          step="0.1"
                          value={thickness}
                          onChange={e => setThickness(parseFloat(e.target.value))}
                          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    );
                  })()}

                  {/* Color picker */}
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-gray-500">Color</label>
                    <ColorPicker
                      color={layer.color}
                      onChange={color =>
                        dispatch(updateLayer({ id: layer.id, changes: { color } }))
                      }
                    />
                  </div>

                  {/* Export — plain GeoJSON for use in other software */}
                  {(() => {
                    const dataset = datasets[layer.datasetId];
                    const featureCount = dataset?.data.features.length ?? 0;
                    return (
                      <button
                        disabled={featureCount === 0}
                        onClick={() => {
                          if (!dataset) return;
                          const safeName = layer.label.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';
                          const date = new Date().toISOString().slice(0, 10);
                          exportViewAsGeoJSON(dataset.data, `${safeName}-${date}.geojson`);
                        }}
                        className="flex items-center gap-1 w-full text-[10px] font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed border-none rounded px-2 py-1 cursor-pointer transition-colors"
                        title="Download this layer as a GeoJSON file"
                      >
                        <Download className="w-3 h-3" />
                        Export GeoJSON
                      </button>
                    );
                  })()}

                  {/* Layer info */}
                  <div className="text-[10px] text-gray-400">
                    Type: {layer.type}
                    {layer.config.extruded ? ' (3D)' : ''}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
