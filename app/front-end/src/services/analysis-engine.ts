import { SimpleTool, ToolRunMeta, ExecutionMode } from '@/interfaces/simple-tool';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { AttributeMapping } from '@/interfaces/attribute-mapping';
import { toolRegistry } from '@/utils/tool-registry';
import { backendApiService } from './backend-api-service';
import { normalizeBackendResponse } from './backend-normalizer';
import { ensureLargeFile } from './large-file-cache';
import * as turf from '@turf/turf';

export interface AnalysisRequest {
  toolId: string;
  data: FeatureCollection;
  options: Record<string, any>;
  attributes?: AttributeMapping;
  sourceDatasetIds?: string[];
  mode?: ExecutionMode;
  /** Optional polygon to clip backend output to (applied on the backend). */
  researchArea?: FeatureCollection;
}

export interface AnalysisResult {
  success: boolean;
  toolId: string;
  outputs: FeatureCollection[];
  metadata: {
    executionTime: number;
    featureCount: number;
    timestamp: string;
  };
  runMeta?: ToolRunMeta;
  error?: string;
}

function computeBbox(outputs: FeatureCollection[]): [number, number, number, number] | undefined {
  const allFeatures: GeoJSON.Feature[] = outputs.flatMap(fc => fc.features);
  if (allFeatures.length === 0) return undefined;
  try {
    const combined: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allFeatures };
    const box = turf.bbox(combined);
    return [box[0], box[1], box[2], box[3]];
  } catch {
    return undefined;
  }
}

/**
 * Pure analysis engine - knows nothing about UI
 */
export class AnalysisEngine {
  async execute(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    try {
      // Backend execution path
      if (request.mode === 'backend') {
        let backendData = request.data;
        const backendOptions = { ...request.options };

        // STC with env data: join env dataset to trajectory before sending to backend.
        // The full env GeoJSON may be 100+ MB; it is never stored in Redux/React state.
        // Instead it lives in large-file-cache, keyed by the dataset ID stored in
        // options.envDataset. We resolve it here and do the spatial-temporal join
        // so only the enriched trajectory (small) travels over the wire.
        if (
          request.toolId === 'space-time-cube' &&
          (backendOptions.envDataset || backendOptions.envField || backendOptions.envDatasetData)
        ) {
          const envDatasetId = backendOptions.envDataset as string | undefined;
          // Prefer cache lookup (large files); fall back to inline data (small files,
          // kept for backwards compatibility).
          const envData: FeatureCollection | undefined =
            (envDatasetId ? await ensureLargeFile(envDatasetId) : undefined) ??
            (backendOptions.envDatasetData as FeatureCollection | undefined);

          if (envData && envData.features.length > 0) {
            // Resolve the indicator field: use the explicit choice, otherwise the
            // first numeric property that isn't a coordinate/time helper (e.g.
            // noise_db). The field dropdown defaults to "None", so an env dataset
            // selected without a field would otherwise silently skip the join.
            let envField = ((backendOptions.envField as string) || '').trim();
            if (!envField) {
              const props = envData.features[0]?.properties ?? {};
              envField =
                Object.keys(props).find(
                  k =>
                    typeof props[k] === 'number' &&
                    !/^(hour|lat|lng|lon|latitude|longitude|x|y|z|time|timestamp|elevation|altitude)$/i.test(k),
                ) ?? '';
            }

            if (envField) {
              const timeField = (request.attributes?.time as string | undefined) ?? 'date_logged';
              backendData = _joinEnvToTrajectory(request.data, envData, envField, timeField);
              // Remove env references — backend only sees the enriched trajectory
              delete backendOptions.envDatasetData;
              delete backendOptions.envDataset;
              backendOptions.envField = 'env_exposure';
            } else {
              console.warn('[space-time-cube] env dataset has no numeric indicator field; skipping exposure join');
            }
          } else if (backendOptions.envDataset) {
            console.warn(
              '[space-time-cube] env dataset selected but its data was not found in cache; skipping exposure join',
            );
          }
        }

        const raw = await backendApiService.executeTool(
          request.toolId,
          backendData,
          backendOptions,
          request.attributes as Record<string, any> | undefined,
          request.sourceDatasetIds,
          request.researchArea,
        );
        if (!raw || !raw.success) {
          return {
            success: false,
            toolId: request.toolId,
            outputs: [],
            error: raw?.error || 'Backend execution failed',
            metadata: {
              executionTime: Date.now() - startTime,
              featureCount: 0,
              timestamp: new Date().toISOString(),
            },
          };
        }
        return normalizeBackendResponse(raw, request.toolId);
      }

      // Frontend execution path
      const tool = toolRegistry.getTool(request.toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${request.toolId}`);
      }

      // Execute analysis
      const outputs = await tool.analyze(
        request.data,
        request.options,
        request.attributes
      );

      // Calculate metadata
      const featureCount = outputs.reduce(
        (sum, fc) => sum + fc.features.length,
        0
      );

      const runMeta: ToolRunMeta = {
        toolName: tool.name,
        toolVersion: tool.version,
        runAt: startTime,
        sourceDatasetIds: request.sourceDatasetIds ?? [],
        params: { ...request.options },
        summary: {
          inputCount: request.data.features.length,
          outputCount: featureCount,
          bbox: computeBbox(outputs),
        },
      };

      return {
        success: true,
        toolId: request.toolId,
        outputs,
        metadata: {
          executionTime: Date.now() - startTime,
          featureCount,
          timestamp: new Date().toISOString()
        },
        runMeta,
      };

    } catch (error) {
      return {
        success: false,
        toolId: request.toolId,
        outputs: [],
        metadata: {
          executionTime: Date.now() - startTime,
          featureCount: 0,
          timestamp: new Date().toISOString()
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get all available tools (for UI)
   */
  getAvailableTools(): SimpleTool[] {
    return toolRegistry.getAllTools();
  }

  /**
   * Check if tool can process given data
   */
  canProcessData(toolId: string, data: FeatureCollection): boolean {
    const tool = toolRegistry.getTool(toolId);
    if (!tool) return false;

    // Basic validation
    return data.type === 'FeatureCollection' &&
           data.features.length > 0;
  }
}

export const createAnalysisEngine = () => new AnalysisEngine();

/**
 * Spatially join env dataset to trajectory points.
 *
 * For each trajectory point, finds the nearest env centroid within the same UTC
 * hour and attaches its value as `env_exposure`.  The env dataset must have either
 * a `hour` (integer 0-23) property OR a `timestamp` ISO string property.
 *
 * The brute-force nearest-neighbour search is O(N_traj × N_env_per_hour).
 * For typical inputs (< 2 000 trajectory points, ~45 000 env centroids per hour)
 * this completes in well under one second.
 */
/**
 * Hour-of-day (0-23) as written in the timestamp, independent of the runner's
 * timezone.  `new Date("2022-09-16 00:09:07")` parses naive strings as *local*
 * time, so `getUTCHours()` would shift the hour by the machine's UTC offset and
 * mismatch the env grid's hour buckets.  We read the clock-hour from the string
 * directly (handles "YYYY-MM-DD HH:MM" and "M/D/YYYY H:MM"), falling back to a
 * TZ-aware Date only for ISO strings that carry an explicit offset.
 */
function _naiveHourOfDay(ts: string): number {
  const m = /[ T](\d{1,2}):/.exec(ts);
  if (m) return parseInt(m[1], 10);
  const d = new Date(ts);
  return isNaN(d.getTime()) ? -1 : d.getUTCHours();
}

function _joinEnvToTrajectory(
  trajectory: FeatureCollection,
  envData: FeatureCollection,
  envField: string,
  timeField: string,
): FeatureCollection {
  // Build per-hour buckets from env data
  const byHour = new Map<number, { lons: number[]; lats: number[]; vals: number[] }>();

  for (const feat of envData.features) {
    const props = feat.properties ?? {};
    const coords = (feat.geometry as any)?.coordinates;
    if (!coords) continue;
    const val = props[envField] as number | undefined;
    if (val == null || isNaN(val)) continue;

    let hour: number;
    if (typeof props.hour === 'number') {
      hour = props.hour;
    } else if (props.timestamp) {
      hour = _naiveHourOfDay(props.timestamp as string);
    } else {
      continue;
    }

    let bucket = byHour.get(hour);
    if (!bucket) { bucket = { lons: [], lats: [], vals: [] }; byHour.set(hour, bucket); }
    bucket.lons.push(coords[0] as number);
    bucket.lats.push(coords[1] as number);
    bucket.vals.push(val);
  }

  const enriched = trajectory.features.map(feat => {
    const coords = (feat.geometry as any)?.coordinates;
    if (!coords) return feat;
    const lon = coords[0] as number;
    const lat = coords[1] as number;
    const ts = (feat.properties ?? {})[timeField] as string | undefined;
    const hour = ts ? _naiveHourOfDay(ts) : -1;

    let envExposure: number | null = null;
    const bucket = byHour.get(hour);
    if (bucket) {
      let minDist = Infinity;
      const { lons, lats, vals } = bucket;
      for (let i = 0; i < lons.length; i++) {
        const d = (lon - lons[i]) ** 2 + (lat - lats[i]) ** 2;
        if (d < minDist) { minDist = d; envExposure = vals[i]; }
      }
    }

    return { ...feat, properties: { ...(feat.properties ?? {}), env_exposure: envExposure } };
  });

  return { type: 'FeatureCollection', features: enriched };
}
