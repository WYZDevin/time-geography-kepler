/**
 * Layer Management Panel
 * Provides UI for controlling layer visibility, opacity, and order
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Layers,
  Eye,
  EyeOff,
  Trash2,
  ChevronUp,
  ChevronDown,
  Palette,
  Settings,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { LayerConfig } from '../../services/visualization-service-enhanced';
import {
  SEQUENTIAL_SCHEMES,
  DIVERGING_SCHEMES,
  CATEGORICAL_SCHEMES,
  type ColorScheme,
} from '../../services/color-schemes';

interface LayerPanelProps {
  layers: LayerConfig[];
  onLayerVisibilityToggle?: (layerId: string, visible: boolean) => void;
  onLayerOpacityChange?: (layerId: string, opacity: number) => void;
  onLayerDelete?: (layerId: string) => void;
  onLayerReorder?: (layerId: string, direction: 'up' | 'down') => void;
  onLayerColorSchemeChange?: (layerId: string, scheme: ColorScheme) => void;
  className?: string;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  onLayerVisibilityToggle,
  onLayerOpacityChange,
  onLayerDelete,
  onLayerReorder,
  onLayerColorSchemeChange,
  className = '',
}) => {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());

  const toggleExpanded = (layerId: string) => {
    const newExpanded = new Set(expandedLayers);
    if (newExpanded.has(layerId)) {
      newExpanded.delete(layerId);
    } else {
      newExpanded.add(layerId);
    }
    setExpandedLayers(newExpanded);
  };

  const getLayerTypeIcon = (type: string) => {
    switch (type) {
      case 'geojson':
        return '🗺️';
      case 'point':
        return '📍';
      case 'line':
        return '📏';
      case 'arc':
        return '🌉';
      default:
        return '🔷';
    }
  };

  const getLayerColor = (layer: LayerConfig): string => {
    const color = layer.config?.color || [100, 100, 100];
    return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  };

  if (layers.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="w-4 h-4" />
            Layers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-sm text-gray-500">
            No layers available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers className="w-4 h-4" />
          Layers
          <Badge variant="outline" className="ml-auto">
            {layers.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {layers.map((layer, index) => (
          <div
            key={layer.id}
            className="border rounded-md p-2 space-y-2 hover:bg-gray-50 transition-colors"
          >
            {/* Layer Header */}
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full border"
                style={{ backgroundColor: getLayerColor(layer) }}
              />
              <span className="text-xs" title={layer.type}>
                {getLayerTypeIcon(layer.type)}
              </span>
              <span className="text-sm font-medium flex-1 truncate">
                {layer.config?.label || layer.id}
              </span>

              {/* Visibility Toggle */}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() =>
                  onLayerVisibilityToggle?.(
                    layer.id,
                    !layer.config?.isVisible
                  )
                }
              >
                {layer.config?.isVisible ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3 text-gray-400" />
                )}
              </Button>

              {/* Settings Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <Settings className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => toggleExpanded(layer.id)}
                  >
                    <Settings className="w-3 h-3 mr-2" />
                    {expandedLayers.has(layer.id)
                      ? 'Hide Settings'
                      : 'Show Settings'}
                  </DropdownMenuItem>
                  {index > 0 && onLayerReorder && (
                    <DropdownMenuItem
                      onClick={() => onLayerReorder(layer.id, 'up')}
                    >
                      <ChevronUp className="w-3 h-3 mr-2" />
                      Move Up
                    </DropdownMenuItem>
                  )}
                  {index < layers.length - 1 && onLayerReorder && (
                    <DropdownMenuItem
                      onClick={() => onLayerReorder(layer.id, 'down')}
                    >
                      <ChevronDown className="w-3 h-3 mr-2" />
                      Move Down
                    </DropdownMenuItem>
                  )}
                  {onLayerDelete && (
                    <DropdownMenuItem
                      onClick={() => onLayerDelete(layer.id)}
                      className="text-red-600"
                    >
                      <Trash2 className="w-3 h-3 mr-2" />
                      Delete Layer
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Expanded Settings */}
            {expandedLayers.has(layer.id) && (
              <div className="space-y-2 pt-2 border-t">
                {/* Opacity Slider */}
                {onLayerOpacityChange && (
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">
                      Opacity: {Math.round((layer.config?.visConfig?.opacity || 0.8) * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round((layer.config?.visConfig?.opacity || 0.8) * 100)}
                      onChange={(e) =>
                        onLayerOpacityChange(
                          layer.id,
                          parseInt(e.target.value) / 100
                        )
                      }
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                )}

                {/* Color Scheme */}
                {onLayerColorSchemeChange && (
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">
                      Color Scheme
                    </label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-7 text-xs justify-start"
                        >
                          <Palette className="w-3 h-3 mr-1" />
                          {layer.config?.visConfig?.colorRange?.name ||
                            'Select Scheme'}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-64 overflow-auto">
                        <div className="px-2 py-1 text-xs font-semibold text-gray-500">
                          Sequential
                        </div>
                        {SEQUENTIAL_SCHEMES.map((scheme) => (
                          <DropdownMenuItem
                            key={scheme.name}
                            onClick={() =>
                              onLayerColorSchemeChange(layer.id, scheme)
                            }
                            className="text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex gap-0.5">
                                {scheme.colors.slice(0, 5).map((color, i) => (
                                  <div
                                    key={i}
                                    className="w-3 h-3 rounded-sm"
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                              <span className="text-xs">{scheme.name}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <div className="px-2 py-1 text-xs font-semibold text-gray-500 border-t mt-1">
                          Diverging
                        </div>
                        {DIVERGING_SCHEMES.map((scheme) => (
                          <DropdownMenuItem
                            key={scheme.name}
                            onClick={() =>
                              onLayerColorSchemeChange(layer.id, scheme)
                            }
                            className="text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex gap-0.5">
                                {scheme.colors.slice(0, 5).map((color, i) => (
                                  <div
                                    key={i}
                                    className="w-3 h-3 rounded-sm"
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                              <span className="text-xs">{scheme.name}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <div className="px-2 py-1 text-xs font-semibold text-gray-500 border-t mt-1">
                          Categorical
                        </div>
                        {CATEGORICAL_SCHEMES.map((scheme) => (
                          <DropdownMenuItem
                            key={scheme.name}
                            onClick={() =>
                              onLayerColorSchemeChange(layer.id, scheme)
                            }
                            className="text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex gap-0.5">
                                {scheme.colors.slice(0, 5).map((color, i) => (
                                  <div
                                    key={i}
                                    className="w-3 h-3 rounded-sm"
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                              <span className="text-xs">{scheme.name}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}

                {/* Layer Info */}
                <div className="text-xs text-gray-500 pt-1 border-t">
                  Type: {layer.type}
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
