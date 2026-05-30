/**
 * Enhanced Visualization Service
 * Manages layer creation, templates, and color schemes for deck.gl
 */

import { FeatureCollection } from '@/interfaces/data-interfaces';
import { getColorScheme, getDefaultColorSchemeForTool, type ColorScheme } from './color-schemes';

// Import templates
import defaultTemplate from '../visualization-templates/default-geojson.json';
import bufferTemplate from '../visualization-templates/buffer-zones.json';
import trajectoryTemplate from '../visualization-templates/trajectory-3d.json';
import timeGeographyTemplate from '../visualization-templates/time-geography.json';
import intersectionTemplate from '../visualization-templates/intersection.json';
import unionTemplate from '../visualization-templates/union.json';
import trajectoryPointsTemplate from '../visualization-templates/trajectory-points.json';

export interface LayerConfig {
  id: string;
  type: string;
  config: any;
  visualChannels?: any;
}

export interface VisualizationOptions {
  colorScheme?: string | ColorScheme;
  opacity?: number;
  thickness?: number;
  filled?: boolean;
  enable3d?: boolean;
  elevationScale?: number;
  customColor?: [number, number, number];
}

const TEMPLATE_MAP: Record<string, any> = {
  'default': defaultTemplate,
  'buffer': bufferTemplate,
  'intersection': intersectionTemplate,
  'union': unionTemplate,
  'time-geography': timeGeographyTemplate,
  'trajectory-3d': trajectoryTemplate,
  'trajectory-points': trajectoryPointsTemplate,
};

export class EnhancedVisualizationService {
  /**
   * Creates layer configuration from tool output
   */
  createLayersFromToolOutput(
    toolId: string,
    datasets: FeatureCollection[],
    options?: VisualizationOptions
  ): LayerConfig[] {
    const layers: LayerConfig[] = [];

    // Get template for this tool
    const template = this.getTemplate(toolId);

    // Create layer for each dataset
    datasets.forEach((_dataset, index) => {
      const layerId = `${toolId}-${Date.now()}-${index}`;
      const layer = this.createLayerFromTemplate(
        layerId,
        toolId,
        template,
        options
      );
      layers.push(layer);
    });

    return layers;
  }

  /**
   * Create a single layer with custom options
   */
  createLayer(
    layerId: string,
    dataId: string,
    toolId: string,
    options?: VisualizationOptions
  ): LayerConfig {
    const template = this.getTemplate(toolId);
    return this.createLayerFromTemplate(layerId, dataId, template, options);
  }

  /**
   * Get visualization template for a tool
   */
  private getTemplate(toolId: string): any {
    // First try exact match
    if (TEMPLATE_MAP[toolId]) {
      return JSON.parse(JSON.stringify(TEMPLATE_MAP[toolId])); // Deep clone
    }

    // Try partial matches
    for (const [key, template] of Object.entries(TEMPLATE_MAP)) {
      if (toolId.toLowerCase().includes(key.toLowerCase())) {
        return JSON.parse(JSON.stringify(template));
      }
    }

    // Fall back to default
    return JSON.parse(JSON.stringify(defaultTemplate));
  }

  /**
   * Create layer from template with customizations
   */
  private createLayerFromTemplate(
    layerId: string,
    dataId: string,
    template: any,
    options?: VisualizationOptions
  ): LayerConfig {
    // Deep clone template
    const config = JSON.parse(JSON.stringify(template));

    // Set layer ID and data ID
    config.id = layerId;
    config.config.dataId = dataId;
    config.config.label = config.config.label || dataId;

    // Apply custom options
    if (options) {
      this.applyCustomOptions(config, options, dataId);
    }

    // Set up columns based on layer type
    this.setupLayerColumns(config);

    return config;
  }

  /**
   * Apply custom visualization options
   */
  private applyCustomOptions(
    config: any,
    options: VisualizationOptions,
    toolId: string
  ): void {
    const visConfig = config.config.visConfig || {};

    // Apply opacity
    if (options.opacity !== undefined) {
      visConfig.opacity = options.opacity;
      visConfig.strokeOpacity = Math.min(options.opacity + 0.2, 1);
    }

    // Apply thickness
    if (options.thickness !== undefined) {
      visConfig.thickness = options.thickness;
    }

    // Apply filled
    if (options.filled !== undefined) {
      visConfig.filled = options.filled;
    }

    // Apply 3D mode
    if (options.enable3d !== undefined) {
      visConfig.enable3d = options.enable3d;
    }

    // Apply elevation scale
    if (options.elevationScale !== undefined) {
      visConfig.elevationScale = options.elevationScale;
    }

    // Apply custom color
    if (options.customColor) {
      config.config.color = options.customColor;
    }

    // Apply color scheme
    if (options.colorScheme) {
      const scheme = typeof options.colorScheme === 'string'
        ? getColorScheme(options.colorScheme)
        : options.colorScheme;

      if (scheme) {
        visConfig.colorRange = {
          name: scheme.name,
          type: scheme.type,
          category: scheme.category,
          colors: scheme.colors,
        };
      }
    } else {
      // Use default color scheme for tool
      const defaultScheme = getDefaultColorSchemeForTool(toolId);
      if (defaultScheme && !visConfig.colorRange) {
        visConfig.colorRange = {
          name: defaultScheme.name,
          type: defaultScheme.type,
          category: defaultScheme.category,
          colors: defaultScheme.colors,
        };
      }
    }

    config.config.visConfig = visConfig;
  }

  /**
   * Setup layer columns based on layer type
   */
  private setupLayerColumns(config: any): void {
    switch (config.type) {
      case 'geojson':
        config.config.columns = { geojson: '_geojson' };
        break;
      case 'point':
        config.config.columns = {
          lat: 'latitude',
          lng: 'longitude',
          alt: 'altitude',
        };
        break;
      case 'line':
        config.config.columns = {
          lat0: 'start_lat',
          lng0: 'start_lng',
          lat1: 'end_lat',
          lng1: 'end_lng',
          alt0: 'start_alt',
          alt1: 'end_alt',
        };
        break;
      case 'arc':
        config.config.columns = {
          lat0: 'origin_lat',
          lng0: 'origin_lng',
          lat1: 'dest_lat',
          lng1: 'dest_lng',
        };
        break;
    }
  }

  /**
   * Update layer color scheme
   */
  updateLayerColorScheme(
    layer: LayerConfig,
    colorScheme: string | ColorScheme
  ): LayerConfig {
    const scheme = typeof colorScheme === 'string'
      ? getColorScheme(colorScheme)
      : colorScheme;

    if (!scheme) {
      return layer;
    }

    const updatedLayer = JSON.parse(JSON.stringify(layer));
    updatedLayer.config.visConfig.colorRange = {
      name: scheme.name,
      type: scheme.type,
      category: scheme.category,
      colors: scheme.colors,
    };

    return updatedLayer;
  }

  /**
   * Update layer visibility
   */
  updateLayerVisibility(layer: LayerConfig, isVisible: boolean): LayerConfig {
    const updatedLayer = JSON.parse(JSON.stringify(layer));
    updatedLayer.config.isVisible = isVisible;
    return updatedLayer;
  }

  /**
   * Update layer opacity
   */
  updateLayerOpacity(layer: LayerConfig, opacity: number): LayerConfig {
    const updatedLayer = JSON.parse(JSON.stringify(layer));
    updatedLayer.config.visConfig.opacity = Math.max(0, Math.min(1, opacity));
    return updatedLayer;
  }

  /**
   * Clone a layer with a new ID
   */
  cloneLayer(layer: LayerConfig, newId: string): LayerConfig {
    const clonedLayer = JSON.parse(JSON.stringify(layer));
    clonedLayer.id = newId;
    return clonedLayer;
  }
}

export const createVisualizationService = () => new EnhancedVisualizationService();
