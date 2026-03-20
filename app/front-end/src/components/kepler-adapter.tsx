import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { addDataToMap, removeDataset, wrapTo } from '@kepler.gl/actions';
import { processGeojson } from '@kepler.gl/processors';
import { AnalysisResult } from '@/services/analysis-engine';
import { createVisualizationService } from '@/services/visualization-service';
import { RootState } from '@/stores/store';
import { extractAxesContext, createSharedAxes } from '@/utils/axes-utils';

interface KeplerAdapterProps {
  result: AnalysisResult | null;
  onVisualizationComplete?: () => void;
  appendMode?: boolean; // Controls whether Kepler.gl preserves or replaces previous data
}

/**
 * Adapter component that converts analysis results to Kepler.gl visualizations
 */
export const KeplerAdapter: React.FC<KeplerAdapterProps> = ({
  result,
  onVisualizationComplete,
  appendMode = false
}) => {
  const dispatch = useDispatch();
  const visualizationService = useMemo(() => createVisualizationService(), []);
  const toolOptions = useSelector((state: RootState) => state.workflow.toolOptions);
  const keplerState = useSelector((state: RootState) => state.keplerGl.kepler);
  const keplerLayers = useMemo(() => (
    keplerState?.visState.layers.map((layer: any) => ({
      id: layer.id,
      type: layer.type,
      isValid: layer.isValid,
      error: layer.errorMessage ?? undefined
    })) ?? []
  ), [keplerState?.visState.layers]);
  const datasetSummaries = useMemo(() => {
    if (!keplerState?.visState.datasets) return [];
    return Object.entries(keplerState.visState.datasets).map(([id, dataset]: [string, any]) => ({
      id,
      label: dataset.label,
      fields: dataset.fields.map((f: any) => ({ name: f.name, type: f.type })),
      rows: dataset.allData?.length ?? dataset.dataContainer?.numRows?.() ?? 0
    }));
  }, [keplerState?.visState.datasets]);

  useEffect(() => {
    if (!result || !result.success) return;

    // Get visualization layers first to extract dataIds
    const layers = visualizationService.createLayersFromToolOutput(
      result.toolId,
      result.outputs
    );

    // Convert each output to Kepler dataset, using dataId from layer config if available
    const datasets = result.outputs.map((output, index) => {
      // Get corresponding layer config
      const layerConfig = layers[index];

      // Extract dataId from layer config, or fallback to default
      const datasetId = layerConfig?.config?.dataId || `${result.toolId}-${Date.now()}-${index}`;
      const datasetLabel = output.features[0]?.properties?._dataset_type ||
        `${result.toolId} Result ${index + 1}`;

      // Clean the data: remove internal fields from feature properties
      // These are only needed for extraction, not for rendering
      const cleanedOutput = {
        ...output,
        features: output.features.map(f => ({
          ...f,
          properties: Object.fromEntries(
            Object.entries(f.properties || {}).filter(([key]) =>
              !key.startsWith('_layer_config') && key !== '_dataset_type'
            )
          )
        }))
      };

      // Process GeoJSON using Kepler.gl's processor
      // Note: This creates non-serializable functions, but that's expected for Kepler.gl
      const processedData = processGeojson(cleanedOutput);

      // Return processed data in Kepler.gl's expected format
      return {
        info: {
          id: datasetId,
          label: datasetLabel
        },
        data: processedData
      };
    });

    // Generate shared 3D axes if requested
    if (toolOptions.showAxes !== false) {
      const axesContext = extractAxesContext(result.outputs);
      if (axesContext) {
        const { axes, labels } = createSharedAxes(axesContext, {
          timeBreaks: toolOptions.timeBreaks as 'auto' | '1h' | '4h' | '12h' | '24h' | undefined,
        });

        // Process axes through the same pipeline as tool outputs
        const axesOutputs = [axes, labels];
        const axesLayers = visualizationService.createLayersFromToolOutput('shared-axes', axesOutputs);

        axesOutputs.forEach((output, index) => {
          const layerConfig = axesLayers[index];
          const datasetId = layerConfig?.config?.dataId || `shared-axes-${index}`;
          const datasetLabel = output.features[0]?.properties?._dataset_type || 'Axes';

          const cleanedOutput = {
            ...output,
            features: output.features.map(f => ({
              ...f,
              properties: Object.fromEntries(
                Object.entries(f.properties || {}).filter(([key]) =>
                  !key.startsWith('_layer_config') && key !== '_dataset_type'
                )
              )
            }))
          };

          const processedData = processGeojson(cleanedOutput);
          datasets.push({
            info: { id: datasetId, label: datasetLabel },
            data: processedData
          });
          layers.push(axesLayers[index]);
        });
      }
    }

    // Create Kepler config with 3D tilt view by default
    const config = {
      visState: {
        layers
      },
      mapState: {
        pitch: 45,
        dragRotate: true,
      }
    };

    // In append mode, remove old axes datasets/layers before adding new ones
    // to prevent duplication (Kepler creates new layers even for same dataset IDs)
    if (appendMode) {
      dispatch(wrapTo('kepler', removeDataset('shared-axes')));
      dispatch(wrapTo('kepler', removeDataset('shared-axes-labels')));
    }

    // Dispatch to Kepler
    dispatch(addDataToMap({
      datasets: datasets as any, // Type compatibility fix for Kepler.gl
      options: {
        centerMap: true,
        readOnly: false,
        keepExistingConfig: appendMode // Instructs Kepler to either wipe or overlay
      },
      config
    }));

    onVisualizationComplete?.();

  }, [result, dispatch, visualizationService, toolOptions]); // onVisualizationComplete intentionally excluded from deps

  useEffect(() => {
    if (!keplerLayers.length) return;

    const invalidLayers = keplerLayers.filter(layer => !layer.isValid || layer.error);
    if (invalidLayers.length) {
      console.warn('[KeplerAdapter] Invalid layers detected:', invalidLayers);
      if (datasetSummaries.length) {
        console.warn('[KeplerAdapter] Dataset summaries:', datasetSummaries);
      }
    }
  }, [keplerLayers, datasetSummaries]);

  return null; // This is a logic component, no UI
};
