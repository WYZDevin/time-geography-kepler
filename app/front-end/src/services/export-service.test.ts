/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { toAnalysisFeatureCollection } from './export-service';
import type { FeatureCollection } from '@/interfaces/data-interfaces';

const fc = (features: any[]): FeatureCollection =>
  ({ type: 'FeatureCollection', features } as FeatureCollection);

describe('toAnalysisFeatureCollection', () => {
  it('strips the synthetic z from all geometry types', () => {
    const out = toAnalysisFeatureCollection(fc([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2, 500] }, properties: {} },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2, 500], [3, 4, 600]] }, properties: {} },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[1, 2, 500], [3, 4, 500], [1, 4, 500], [1, 2, 500]]] },
        properties: {},
      },
    ]));
    expect((out.features[0].geometry as any).coordinates).toEqual([1, 2]);
    expect((out.features[1].geometry as any).coordinates).toEqual([[1, 2], [3, 4]]);
    expect((out.features[2].geometry as any).coordinates[0].every((c: number[]) => c.length === 2)).toBe(true);
  });

  it('drops renderer-internal fields and keeps analysis fields', () => {
    const out = toAnalysisFeatureCollection(fc([{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: {
        _dataset_type: 'ppa-road-network',
        _layer_config: 'prism-3d',
        _height: 1200,
        _time_order: 0.4,
        _time_progress: 0.4,
        z: 1200,
        color_rgba: [215, 25, 28, 230],
        density: 0.72,
        edge_id: 17,
        highway: 'primary',
        forward_sec: 120,
      },
    }]));
    expect(out.features[0].properties).toEqual({
      density: 0.72,
      edge_id: 17,
      highway: 'primary',
      forward_sec: 120,
    });
  });

  it('renames meaningful internal fields and derives time_iso', () => {
    const out = toAnalysisFeatureCollection(fc([{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: {
        _timestamp: 1704103200000,
        _user_id: 'p1',
        _confidence: 95,
        _ppa_total_area_km2: 3.4,
      },
    }]));
    expect(out.features[0].properties).toEqual({
      timestamp_ms: 1704103200000,
      time_iso: '2024-01-01T10:00:00.000Z',
      user_id: 'p1',
      confidence_level: 95,
      ppa_area_km2: 3.4,
    });
  });

  it('exports stay-point attributes under plain names', () => {
    const out = toAnalysisFeatureCollection(fc([{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2, 300] },
      properties: {
        _is_stay_point: true,
        _stay_id: 0,
        _stay_label: 'home',
        _stay_duration: 5400,
        _stay_point_count: 12,
        latitude: 2,
        longitude: 1,
      },
    }]));
    expect(out.features[0].properties).toEqual({
      stay_id: 0,
      stay_label: 'home',
      stay_duration_sec: 5400,
      stay_point_count: 12,
      latitude: 2,
      longitude: 1,
    });
  });

  it('drops grid renderer fields (z_axis, side_length) but keeps cell attributes', () => {
    const out = toAnalysisFeatureCollection(fc([{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[1, 2, 800], [3, 4, 800], [1, 4, 800], [1, 2, 800]]] },
      properties: {
        z_axis: 800,
        side_length: 0.02,
        classification: 2,
        time_slice_index: 4,
        time_value: '2024-01-01T10:00:00+00:00',
        count: 7,
        env_value: 41.2,
      },
    }]));
    expect(out.features[0].properties).toEqual({
      classification: 2,
      time_slice_index: 4,
      time_value: '2024-01-01T10:00:00+00:00',
      count: 7,
      env_value: 41.2,
    });
  });

  it('drops the dwell_sec_* aliases but keeps activity_sec_*', () => {
    const out = toAnalysisFeatureCollection(fc([{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: {
        activity_sec_min: 60,
        activity_sec_mid: 90,
        activity_sec_max: 120,
        dwell_sec_min: 60,
        dwell_sec_mid: 90,
        dwell_sec_max: 120,
      },
    }]));
    expect(out.features[0].properties).toEqual({
      activity_sec_min: 60,
      activity_sec_mid: 90,
      activity_sec_max: 120,
    });
  });

  it('writes provenance as top-level foreign members', () => {
    const out = toAnalysisFeatureCollection(fc([]), {
      label: 'PPA Reachable Roads',
      datasetType: 'ppa-road-network',
      tool: 'space-time-prism',
    }) as any;
    expect(out.name).toBe('PPA Reachable Roads');
    expect(out.dataset_type).toBe('ppa-road-network');
    expect(out.tool).toBe('space-time-prism');
    expect(typeof out.exported_at).toBe('string');
    expect(out.type).toBe('FeatureCollection');
  });
});
