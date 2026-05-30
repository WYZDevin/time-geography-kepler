import { useAppDispatch, useAppSelector } from '@/stores/store';
import { updateLayer } from '@/stores/map-slice';
import { startExplorer } from '@/stores/prism-explorer-slice';
import { ColorPicker } from './ui/color-picker';
import { exportViewAsGeoJSON } from '@/services/export-service';
import { Eye, EyeOff, ChevronDown, ChevronRight, Diamond, Download } from 'lucide-react';
import { useState } from 'react';

const LINE_TYPES = new Set(['line', 'path', 'geojson']);

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
          // 3D Trajectory: show one colored entry per user instead of a single layer row.
          if (layer.datasetId === 'time-geography-trajectory') {
            const dataset = datasets[layer.datasetId];
            const userColors = new Map<string, number[] | undefined>();
            for (const f of dataset?.data.features ?? []) {
              const userId = f.properties?._user_id as string | undefined;
              if (userId === undefined) continue;
              if (!userColors.has(userId)) {
                userColors.set(userId, f.properties?.color_rgba as number[] | undefined);
              }
            }
            if (userColors.size > 0) {
              const layerColor = `rgb(${layer.color[0]}, ${layer.color[1]}, ${layer.color[2]})`;
              return Array.from(userColors).map(([userId, rgba]) => {
                const color = Array.isArray(rgba)
                  ? `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})`
                  : layerColor;
                return (
                  <div
                    key={`${layer.id}-user-${userId}`}
                    className="rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <div
                        className="w-3 h-3 rounded-sm border border-gray-300 flex-shrink-0"
                        style={{
                          backgroundColor: color,
                          opacity: layer.isVisible ? 1 : 0.3,
                        }}
                      />
                      <span
                        className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate"
                        style={{ opacity: layer.isVisible ? 1 : 0.5 }}
                      >
                        User {userId}
                      </span>
                    </div>
                  </div>
                );
              });
            }
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
