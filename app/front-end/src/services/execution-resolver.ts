/**
 * Pure functions for resolving what execution modes are available for a tool,
 * plus a React hook that pulls state from Redux.
 */
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/stores/store';
import { toolRegistry } from '@/utils/tool-registry';
import { ExecutionMode, ExecutionPolicy } from '@/interfaces/simple-tool';
import { BackendToolInfo } from '@/stores/settings-slice';

export interface ResolvedCapabilities {
  canRunFrontend: boolean;
  canRunBackend: boolean;
  effectivePolicy: ExecutionPolicy;
  defaultMode: ExecutionMode;
  isDisabled: boolean;
}

/**
 * Resolve what execution options are available for a given tool.
 */
export function resolveToolCapabilities(
  toolId: string,
  backendAvailable: boolean,
  backendTools: BackendToolInfo[],
): ResolvedCapabilities {
  const frontendTool = toolRegistry.getTool(toolId);
  const backendTool = backendTools.find(t => t.id === toolId);
  const frontendPolicy = frontendTool?.capabilities.executionPolicy;
  const backendPolicy = backendTool?.executionPolicy as ExecutionPolicy | undefined;

  const canRunFrontend = !!frontendTool && frontendPolicy !== 'backend_only';
  const canRunBackend =
    backendAvailable &&
    !!backendTool &&
    frontendPolicy !== 'frontend_only' &&
    backendPolicy !== 'frontend_only';

  // The frontend registry is the UI contract. A backend tool with the same id
  // must not promote a frontend_only visualization into a backend option.
  let effectivePolicy: ExecutionPolicy;
  if (frontendTool) {
    effectivePolicy = frontendPolicy!;
  } else if (backendTool) {
    effectivePolicy = backendPolicy!;
  } else {
    effectivePolicy = 'frontend_only';
  }

  // Default mode
  let defaultMode: ExecutionMode = 'frontend';
  if (effectivePolicy === 'backend_only') {
    defaultMode = 'backend';
  } else if (effectivePolicy === 'hybrid' && frontendTool?.capabilities.defaultMode) {
    defaultMode = frontendTool.capabilities.defaultMode;
  }

  // Disabled when backend_only tool but backend is offline
  const isDisabled = effectivePolicy === 'backend_only' && !canRunBackend;

  return {
    canRunFrontend,
    canRunBackend,
    effectivePolicy,
    defaultMode,
    isDisabled,
  };
}

/**
 * React hook that resolves capabilities for a tool from Redux state.
 */
export function useResolvedCapabilities(toolId: string | null): ResolvedCapabilities {
  const backendAvailable = useSelector((state: RootState) => state.settings.backendAvailable);
  const backendTools = useSelector((state: RootState) => state.settings.backendTools);

  return useMemo(
    () =>
      toolId
        ? resolveToolCapabilities(toolId, backendAvailable, backendTools)
        : {
            canRunFrontend: false,
            canRunBackend: false,
            effectivePolicy: 'frontend_only' as const,
            defaultMode: 'frontend' as const,
            isDisabled: true,
          },
    [toolId, backendAvailable, backendTools],
  );
}
