import { describe, it, expect } from 'vitest';
import {
  epochToReadable,
  detectEpochColumns,
  csvToGeoJSON,
  READABLE_SUFFIX,
} from './csv-service';

// 1700000000000 ms === 1700000000 s === 2023-11-14 22:13:20 UTC
const MS = 1700000000000;
const SEC = 1700000000;

describe('epochToReadable', () => {
  it('formats a millisecond epoch as friendly UTC', () => {
    expect(epochToReadable(MS)).toBe('2023-11-14 22:13');
  });

  it('formats a second epoch as friendly UTC', () => {
    expect(epochToReadable(SEC)).toBe('2023-11-14 22:13');
  });

  it('returns null for values outside a plausible epoch range', () => {
    expect(epochToReadable(1000)).toBeNull(); // too small
    expect(epochToReadable(5e9)).toBeNull(); // between the seconds and ms windows
  });

  it('returns null for non-numeric input', () => {
    expect(epochToReadable('2022-09-16 00:09:07')).toBeNull();
    expect(epochToReadable(null)).toBeNull();
    expect(epochToReadable(NaN)).toBeNull();
  });
});

describe('detectEpochColumns', () => {
  const rows = [
    { lon: -79.6, lat: 43.5, ts_ms: MS, ts_s: SEC, label: 'home', speed: 12 },
    { lon: -79.5, lat: 43.4, ts_ms: MS + 60000, ts_s: SEC + 60, label: 'work', speed: 30 },
  ];

  it('detects both ms and seconds epoch columns', () => {
    expect(detectEpochColumns(rows)).toEqual(['ts_ms', 'ts_s']);
  });

  it('ignores non-epoch numeric and string columns', () => {
    const cols = detectEpochColumns(rows);
    expect(cols).not.toContain('speed');
    expect(cols).not.toContain('label');
    expect(cols).not.toContain('lat');
  });

  it('excludes columns passed in the exclude list', () => {
    expect(detectEpochColumns(rows, ['ts_ms'])).toEqual(['ts_s']);
  });

  it('skips a column whose readable sibling already exists', () => {
    const withReadable = rows.map(r => ({ ...r, [`ts_ms${READABLE_SUFFIX}`]: 'x' }));
    expect(detectEpochColumns(withReadable)).toEqual(['ts_s']);
  });

  it('returns an empty list for empty data', () => {
    expect(detectEpochColumns([])).toEqual([]);
  });
});

describe('csvToGeoJSON readable columns', () => {
  it('adds a readable sibling column for epoch timestamp columns', () => {
    const data = [
      { longitude: -79.6, latitude: 43.5, recorded_at: MS },
      { longitude: -79.5, latitude: 43.4, recorded_at: MS + 60000 },
    ];
    const { featureCollection } = csvToGeoJSON(data, {
      coordinateMapping: { longitude: 'longitude', latitude: 'latitude' },
    });

    const props = featureCollection.features[0].properties!;
    expect(props.recorded_at).toBe(MS); // original epoch preserved
    expect(props[`recorded_at${READABLE_SUFFIX}`]).toBe('2023-11-14 22:13');
  });

  it('leaves already-readable string timestamp columns untouched', () => {
    const data = [
      { longitude: -79.6, latitude: 43.5, date_logged: '2022-09-16 00:09:07' },
    ];
    const { featureCollection } = csvToGeoJSON(data, {
      coordinateMapping: { longitude: 'longitude', latitude: 'latitude' },
    });

    const props = featureCollection.features[0].properties!;
    expect(props.date_logged).toBe('2022-09-16 00:09:07');
    expect(props[`date_logged${READABLE_SUFFIX}`]).toBeUndefined();
  });
});
