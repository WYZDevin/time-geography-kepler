import { FeatureCollection } from '@/interfaces/data-interfaces';

export interface LayerConfig {
  id: string;
  type: string;
  config: any;
  visualChannels?: any;
}

export class VisualizationService {
  /**
   * Creates layer configuration from tool output
   */
  createLayersFromToolOutput(
    toolId: string,
    datasets: FeatureCollection[],
    options?: Record<string, any>
  ): LayerConfig[] {
    const layers: LayerConfig[] = [];

    // Create layer for each dataset
    datasets.forEach((dataset, index) => {
      // Check if dataset has embedded layer config in feature properties
      const embeddedConfig = this.extractEmbeddedLayerConfig(dataset);

      if (embeddedConfig) {
        // Use embedded layer configuration from tool
        layers.push(embeddedConfig);
      } else {
        // Fallback to default template
        const template = this.getDefaultTemplate(toolId);
        const layerId = `${toolId}-${Date.now()}-${index}`;
        const layer = this.createLayerFromTemplate(
          layerId,
          toolId,
          template,
          options
        );
        layers.push(layer);
      }
    });

    return layers;
  }

  /**
   * Extract embedded layer configuration from feature properties
   * Tools can embed layer configs in feature properties as _layer_config
   */
  private extractEmbeddedLayerConfig(dataset: FeatureCollection): LayerConfig | null {
    if (!dataset.features || dataset.features.length === 0) {
      return null;
    }

    // Check first feature for _layer_config property
    const firstFeature = dataset.features[0];
    if (firstFeature.properties && '_layer_config' in firstFeature.properties) {
      const layerConfig = firstFeature.properties._layer_config;
      if (layerConfig && typeof layerConfig === 'object') {
        return layerConfig as LayerConfig;
      }
    }

    return null;
  }

  private getDefaultTemplate(toolId: string): any {
    // Return default geojson layer template
    return {
      type: 'geojson',
      config: {
        dataId: toolId,
        label: toolId,
        color: [18, 147, 154],
        isVisible: true,
      }
    };
  }

  private createLayerFromTemplate(
    layerId: string,
    dataId: string,
    template: any,
    options?: Record<string, any>
  ): LayerConfig {
    // Base configuration from template
    const config = {
      ...template,
      id: layerId,
      config: {
        ...template.config,
        dataId: dataId,
      }
    };
    
    // Apply tool-specific customizations
    switch (template.type) {
      case 'geojson':
        config.config.columns = { geojson: '_geojson' };
        break;
      case 'point':
        config.config.columns = {
          lat: 'latitude',
          lng: 'longitude'
        };
        break;
      case 'line':
        config.config.columns = {
          lat: 'latitude',
          lng: 'longitude',
          alt: options?.altitudeField || null
        };
        break;
    }
    
    return config;
  }
}

export const createVisualizationService = () => new VisualizationService();