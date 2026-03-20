import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { backendApiService } from '@/services/backend-api-service';
import { setBackendStatus, setBackendTools } from '@/stores/settings-slice';

const HEALTH_CHECK_INTERVAL_MS = 30_000;

/**
 * Initializes the backend connection on mount:
 * 1. Checks health and dispatches status
 * 2. If healthy, fetches tool list
 * 3. Sets up a periodic health re-check every 30 seconds
 */
export function useBackendInit() {
  const dispatch = useDispatch();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkBackend = async (fetchToolList: boolean) => {
      const healthy = await backendApiService.checkHealth();
      if (cancelled) return;

      dispatch(setBackendStatus(healthy));

      if (healthy && fetchToolList) {
        const tools = await backendApiService.fetchTools();
        if (!cancelled && tools) {
          dispatch(setBackendTools(tools));
        }
      }

      if (!healthy) {
        dispatch(setBackendTools([]));
      }
    };

    // Initial check — fetch tool list on first connection
    checkBackend(true);

    // Periodic health-only re-check
    intervalRef.current = setInterval(() => {
      checkBackend(false);
    }, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [dispatch]);
}
