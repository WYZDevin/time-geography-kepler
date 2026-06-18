import { FeatureCollection } from '@/interfaces/data-interfaces';
import { loadLargeFile } from './persistence-service';

/**
 * Module-level cache for large GeoJSON datasets.
 *
 * Large files (>LARGE_FILE_THRESHOLD) are stored here instead of in Redux.
 * Redux holds only a lightweight stub (id, name, featureCount, fieldNames).
 * The analysis engine reads the real data from here at run time.
 *
 * Lifetime: page session. On a cache miss the payload is rehydrated from
 * IndexedDB (it is persisted there on upload), so large datasets survive a
 * reload. Entries are removed when the corresponding DataSource is deleted.
 */
const _cache = new Map<string, FeatureCollection>();

export function setLargeFile(id: string, fc: FeatureCollection): void {
  _cache.set(id, fc);
}

export function getLargeFile(id: string): FeatureCollection | undefined {
  return _cache.get(id);
}

/**
 * Like getLargeFile, but on a miss rehydrates the payload from IndexedDB (where
 * uploads persist it) and repopulates the in-memory cache. Use this from async
 * run-time paths so large datasets keep working after a page reload.
 */
export async function ensureLargeFile(id: string): Promise<FeatureCollection | undefined> {
  const cached = _cache.get(id);
  if (cached) return cached;
  const fromDb = await loadLargeFile(id);
  if (fromDb) _cache.set(id, fromDb);
  return fromDb;
}

export function deleteLargeFile(id: string): void {
  _cache.delete(id);
}

export function hasLargeFile(id: string): boolean {
  return _cache.has(id);
}
