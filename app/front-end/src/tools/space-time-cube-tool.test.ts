import { describe, it, expect } from 'vitest';
import { SpaceTimeCubeTool } from './space-time-cube-tool';

describe('SpaceTimeCubeTool', () => {
  const tool = new SpaceTimeCubeTool();

  it('has correct metadata', () => {
    expect(tool.id).toBe('space-time-cube');
    expect(tool.category).toBe('analysis');
    expect(tool.capabilities.executionPolicy).toBe('backend_only');
  });

  it('declares attributeMapping with time field', () => {
    expect(tool.attributeMapping).toBeDefined();
    expect(tool.attributeMapping!.time).toBe('timestamp');
  });

  it('returns option schema with showAxes and timeBreaks', () => {
    const schema = tool.getOptionSchema();
    const keys = schema.map(s => s.key);
    expect(keys).toContain('showAxes');
    expect(keys).toContain('timeBreaks');
  });

  it('throws when analyze() is called (backend-only stub)', async () => {
    const data = { type: 'FeatureCollection' as const, features: [] };
    await expect(tool.analyze(data, {})).rejects.toThrow('This tool requires backend execution');
  });
});
