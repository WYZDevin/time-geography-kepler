import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveToolCapabilities } from './execution-resolver';

// Mock the tool registry — only the getTool call matters for resolution
vi.mock('@/utils/tool-registry', () => ({
  toolRegistry: {
    getTool: vi.fn(),
  },
}));

import { toolRegistry } from '@/utils/tool-registry';

const mockFrontendTool = (policy: string, defaultMode?: string) => ({
  id: 'test-tool',
  capabilities: {
    executionPolicy: policy,
    defaultMode,
  },
});

const mockBackendTool = (id: string, policy: string) => ({
  id,
  name: id,
  executionPolicy: policy,
});

describe('resolveToolCapabilities', () => {
  beforeEach(() => {
    vi.mocked(toolRegistry.getTool).mockReturnValue(undefined as any);
  });

  it('returns frontend_only when tool exists only in frontend', () => {
    vi.mocked(toolRegistry.getTool).mockReturnValue(mockFrontendTool('frontend_only') as any);

    const result = resolveToolCapabilities('test-tool', false, []);
    expect(result.canRunFrontend).toBe(true);
    expect(result.canRunBackend).toBe(false);
    expect(result.effectivePolicy).toBe('frontend_only');
    expect(result.defaultMode).toBe('frontend');
    expect(result.isDisabled).toBe(false);
  });

  it('returns backend_only when tool exists only in backend', () => {
    const backendTools = [mockBackendTool('test-tool', 'backend_only')];

    const result = resolveToolCapabilities('test-tool', true, backendTools as any);
    expect(result.canRunFrontend).toBe(false);
    expect(result.canRunBackend).toBe(true);
    expect(result.effectivePolicy).toBe('backend_only');
    expect(result.defaultMode).toBe('backend');
  });

  it('returns hybrid when tool exists in both frontend and backend', () => {
    vi.mocked(toolRegistry.getTool).mockReturnValue(mockFrontendTool('hybrid', 'backend') as any);
    const backendTools = [mockBackendTool('test-tool', 'hybrid')];

    const result = resolveToolCapabilities('test-tool', true, backendTools as any);
    expect(result.canRunFrontend).toBe(true);
    expect(result.canRunBackend).toBe(true);
    expect(result.effectivePolicy).toBe('hybrid');
    expect(result.defaultMode).toBe('backend');
  });

  it('does not promote a frontend_only tool to hybrid when a backend tool has the same id', () => {
    vi.mocked(toolRegistry.getTool).mockReturnValue(mockFrontendTool('frontend_only') as any);
    const backendTools = [mockBackendTool('test-tool', 'hybrid')];

    const result = resolveToolCapabilities('test-tool', true, backendTools as any);
    expect(result.canRunFrontend).toBe(true);
    expect(result.canRunBackend).toBe(false);
    expect(result.effectivePolicy).toBe('frontend_only');
    expect(result.defaultMode).toBe('frontend');
  });

  it('treats a backend_only frontend stub as server-only', () => {
    vi.mocked(toolRegistry.getTool).mockReturnValue(mockFrontendTool('backend_only') as any);
    const backendTools = [mockBackendTool('test-tool', 'backend_only')];

    const result = resolveToolCapabilities('test-tool', true, backendTools as any);
    expect(result.canRunFrontend).toBe(false);
    expect(result.canRunBackend).toBe(true);
    expect(result.effectivePolicy).toBe('backend_only');
    expect(result.defaultMode).toBe('backend');
  });

  it('disables backend_only tool when backend is offline', () => {
    const backendTools = [mockBackendTool('test-tool', 'backend_only')];

    const result = resolveToolCapabilities('test-tool', false, backendTools as any);
    expect(result.canRunBackend).toBe(false);
    expect(result.isDisabled).toBe(true);
  });

  it('falls back to frontend_only when tool is unknown', () => {
    const result = resolveToolCapabilities('unknown-tool', false, []);
    expect(result.canRunFrontend).toBe(false);
    expect(result.canRunBackend).toBe(false);
    expect(result.effectivePolicy).toBe('frontend_only');
    expect(result.isDisabled).toBe(false);
  });

  it('defaults to frontend mode for hybrid tool without explicit defaultMode', () => {
    vi.mocked(toolRegistry.getTool).mockReturnValue(mockFrontendTool('hybrid') as any);
    const backendTools = [mockBackendTool('test-tool', 'hybrid')];

    const result = resolveToolCapabilities('test-tool', true, backendTools as any);
    expect(result.defaultMode).toBe('frontend');
  });
});
