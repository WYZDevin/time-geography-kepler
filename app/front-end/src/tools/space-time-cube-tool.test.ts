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
    expect(keys).toContain('cellSizeMeters');
    expect(keys).toContain('showAxes');
    expect(keys).toContain('timeBreaks');
  });

  it('exposes time-slicing controls (count, method, duration, anchor)', () => {
    const schema = tool.getOptionSchema();
    const keys = schema.map(s => s.key);
    expect(keys).toContain('timeSlices');
    expect(keys).toContain('timeSliceMethod');
    expect(keys).toContain('sliceDurationHours');
    expect(keys).toContain('sliceAnchor');

    const method = schema.find(s => s.key === 'timeSliceMethod');
    expect(method?.options?.map(o => o.value)).toEqual([
      'equal_interval',
      'equal_count',
      'fixed_duration',
    ]);

    // The method drives the rest: it comes first, and dependent controls only
    // show for the methods they apply to.
    expect(keys.indexOf('timeSliceMethod')).toBeLessThan(keys.indexOf('timeSlices'));
    const count = schema.find(s => s.key === 'timeSlices');
    expect(count?.visibleWhen).toEqual({
      key: 'timeSliceMethod',
      oneOf: ['equal_interval', 'equal_count'],
    });
    const duration = schema.find(s => s.key === 'sliceDurationHours');
    expect(duration?.visibleWhen).toEqual({ key: 'timeSliceMethod', oneOf: ['fixed_duration'] });
    expect(duration?.defaultValue).toBe(24); // meaningful default: daily slices
    const anchor = schema.find(s => s.key === 'sliceAnchor');
    expect(anchor?.type).toBe('datetime'); // native picker, no free-text parsing
    expect(anchor?.visibleWhen).toEqual({ key: 'timeSliceMethod', oneOf: ['fixed_duration'] });
  });

  it('throws when analyze() is called (backend-only stub)', async () => {
    await expect(tool.analyze()).rejects.toThrow('This tool requires backend execution');
  });
});
