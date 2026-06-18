/**
 * Thin HTTP client for the Flask backend.
 * Never throws on network errors — returns null/false instead.
 */

export interface BackendToolInfo {
  id: string;
  name: string;
  version: string;
  executionPolicy: string;
}

class BackendApiService {
  private _baseUrl: string;
  private _available = false;

  constructor() {
    this._baseUrl = ((import.meta.env.VITE_BACKEND_URL as string | undefined) ?? '').trim();
    // Strip trailing slash
    this._baseUrl = this._baseUrl.replace(/\/+$/, '');
  }

  get isAvailable(): boolean {
    return this._available;
  }

  set available(value: boolean) {
    this._available = value;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this._baseUrl}/api/v1/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      this._available = res.ok;
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  async fetchTools(): Promise<BackendToolInfo[] | null> {
    try {
      const res = await fetch(`${this._baseUrl}/api/v1/tools`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.tools ?? []) as BackendToolInfo[];
    } catch {
      return null;
    }
  }

  async executeTool(
    toolId: string,
    data: any,
    options: Record<string, any>,
    attributes?: Record<string, any>,
    sourceDatasetIds?: string[],
    researchArea?: any
  ): Promise<any | null> {
    try {
      const res = await fetch(`${this._baseUrl}/api/v1/tools/${toolId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data,
          options,
          attributes: attributes ?? {},
          sourceDatasetIds: sourceDatasetIds ?? [],
          ...(researchArea ? { researchArea } : {}),
        }),
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        return errorBody ?? { success: false, error: `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }
}

export const backendApiService = new BackendApiService();
