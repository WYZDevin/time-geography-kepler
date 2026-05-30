import { FeatureCollection } from '@/interfaces/data-interfaces';

/**
 * Module-level cache for large GeoJSON datasets.
 *
 * Large files (>LARGE_FILE_THRESHOLD) are stored here instead of in Redux.
 * Redux holds only a lightweight stub (id, name, featureCount, fieldNames).
 * The analysis engine reads the real data from here at run time.
 *
 * Lifetime: page session (cleared on reload). Entries are removed when the
 * corresponding DataSource is deleted from the Redux store.
 */
const _cache = new Map<string, FeatureCollection>();

export function setLargeFile(id: string, fc: FeatureCollection): void {
  _cache.set(id, fc);
}

export function getLargeFile(id: string): FeatureCollection | undefined {
  return _cache.get(id);
}

export function deleteLargeFile(id: string): void {
  _cache.delete(id);
}

export function hasLargeFile(id: string): boolean {
  return _cache.has(id);
}
