import { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useAppSelector } from '../../stores/store';
import {
  selectResearchAreaSources,
  selectResearchAreaEnabled,
  selectResearchAreaVisible,
  addResearchAreaSource,
  removeResearchAreaSource,
  clearResearchArea,
  setResearchAreaEnabled,
  setResearchAreaVisible,
} from '../../stores/research-area-slice';
import type { FeatureCollection } from '@/interfaces/data-interfaces';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { useDropzone } from 'react-dropzone';
import { MapPinned, Upload, Trash2, Loader2, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';

const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);

/**
 * Parse an uploaded .geojson file into a FeatureCollection of polygons.
 * Accepts a FeatureCollection, a single Feature, or a bare geometry, and
 * rejects anything without polygon geometry (a research area must enclose).
 */
async function parseResearchAreaFile(file: File): Promise<{ geojson: FeatureCollection; name: string }> {
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.json') && !fileName.endsWith('.geojson')) {
    throw new Error(`${file.name}: please upload a .json or .geojson file.`);
  }

  const text = await file.text();
  if (!text.trim()) throw new Error(`${file.name}: file is empty.`);

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file.name}: invalid JSON (${e instanceof Error ? e.message : 'parse error'}).`);
  }

  // Normalize to a feature array.
  let features: any[];
  if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    features = parsed.features;
  } else if (parsed?.type === 'Feature') {
    features = [parsed];
  } else if (POLYGON_TYPES.has(parsed?.type)) {
    features = [{ type: 'Feature', geometry: parsed, properties: {} }];
  } else {
    throw new Error(`${file.name}: expected a GeoJSON polygon, Feature, or FeatureCollection.`);
  }

  const polygons = features.filter((f) => POLYGON_TYPES.has(f?.geometry?.type));
  if (polygons.length === 0) {
    throw new Error(`${file.name}: no Polygon/MultiPolygon features found.`);
  }

  return {
    geojson: { type: 'FeatureCollection', features: polygons },
    name: file.name.replace(/\.[^/.]+$/, ''),
  };
}

export const ResearchAreaControl: React.FC = () => {
  const dispatch = useDispatch();
  const sources = useAppSelector(selectResearchAreaSources);
  const enabled = useAppSelector(selectResearchAreaEnabled);
  const visible = useAppSelector(selectResearchAreaVisible);
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const totalPolygons = sources.reduce((sum, s) => sum + s.featureCount, 0);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setErrors([]);
      setIsLoading(true);
      const failures: string[] = [];
      // Parse files in parallel, then add the ones that succeed.
      const results = await Promise.all(
        files.map(async (file) => {
          try {
            return await parseResearchAreaFile(file);
          } catch (e) {
            failures.push(e instanceof Error ? e.message : `${file.name}: failed to load.`);
            return null;
          }
        }),
      );
      for (const result of results) {
        if (result) {
          dispatch(
            addResearchAreaSource({
              id: crypto.randomUUID(),
              name: result.name,
              geojson: result.geojson,
            }),
          );
        }
      }
      setErrors(failures);
      setIsLoading(false);
    },
    [dispatch],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/json': ['.json', '.geojson'] },
    multiple: true,
  });

  const hasSources = sources.length > 0;

  return (
    <Card className="border-emerald-200">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPinned className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold">Research Area</h3>
          </div>
          {hasSources && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-gray-600 hover:bg-gray-100"
                onClick={() => dispatch(setResearchAreaVisible(!visible))}
                title={visible ? 'Hide research area on map' : 'Show research area on map'}
              >
                {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-red-600 hover:bg-red-50"
                onClick={() => {
                  dispatch(clearResearchArea());
                  setErrors([]);
                }}
              >
                Clear all
              </Button>
            </div>
          )}
        </div>

        {hasSources && (
          <>
            <div className="space-y-1.5">
              {sources.map((src) => (
                <div
                  key={src.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-emerald-900 truncate">{src.name}</div>
                    <div className="text-xs text-emerald-700">
                      {src.featureCount} polygon{src.featureCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-red-600 hover:bg-red-100 shrink-0"
                    onClick={() => dispatch(removeResearchAreaSource(src.id))}
                    title={`Remove ${src.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => dispatch(setResearchAreaEnabled(e.target.checked))}
                className="rounded"
              />
              Clip analysis output to {sources.length === 1 ? 'this area' : 'these areas'}
            </label>
            <p className="text-xs text-gray-500">
              Applies to tools run on the backend. Output is kept where it intersects any uploaded
              area ({totalPolygons} polygon{totalPolygons === 1 ? '' : 's'} total).
            </p>
          </>
        )}

        {/* Upload zone — always shown so more files can be added. */}
        <div
          {...getRootProps()}
          className={`cursor-pointer p-3 border-2 border-dashed rounded-lg text-center transition-colors ${
            isDragActive ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-1">
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
            ) : (
              <Upload className="w-5 h-5 text-gray-500" />
            )}
            <div className="text-sm font-medium">
              {hasSources ? 'Add more boundary polygons' : 'Upload boundary polygons'}
            </div>
            <div className="text-xs text-gray-500">One or more GeoJSON polygons (.json, .geojson)</div>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((err, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-red-600">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{err}</span>
              </div>
            ))}
          </div>
        )}

        {hasSources && enabled && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700">
            <CheckCircle className="w-3.5 h-3.5" />
            Clipping enabled
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ResearchAreaControl;
