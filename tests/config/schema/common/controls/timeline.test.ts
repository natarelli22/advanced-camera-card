import { describe, expect, it } from 'vitest';

import {
  timelineCoreConfigDefault,
  timelineCoreConfigSchema,
} from '../../../../../src/config/schema/common/controls/timeline';

describe('timelineCoreConfigSchema', () => {
  it('should parse with default chunk_hours', () => {
    const parsed = timelineCoreConfigSchema.parse({});
    expect(parsed.chunk_hours).toBe(24);
    expect(parsed.chunk_hours).toBe(timelineCoreConfigDefault.chunk_hours);
  });

  it('should accept number chunk_hours', () => {
    const parsed = timelineCoreConfigSchema.parse({
      chunk_hours: 12,
    });
    expect(parsed.chunk_hours).toBe(12);
  });

  it('should accept string chunk_hours with or without h suffix', () => {
    expect(timelineCoreConfigSchema.parse({ chunk_hours: '12h' }).chunk_hours).toBe(12);
    expect(timelineCoreConfigSchema.parse({ chunk_hours: '12H' }).chunk_hours).toBe(12);
    expect(timelineCoreConfigSchema.parse({ chunk_hours: '24' }).chunk_hours).toBe(24);
    expect(timelineCoreConfigSchema.parse({ chunk_hours: '  6h  ' }).chunk_hours).toBe(
      6,
    );
  });

  it('should reject out of range chunk_hours', () => {
    expect(() => timelineCoreConfigSchema.parse({ chunk_hours: 0 })).toThrow();
    expect(() => timelineCoreConfigSchema.parse({ chunk_hours: 25 })).toThrow();
    expect(() => timelineCoreConfigSchema.parse({ chunk_hours: '0h' })).toThrow();
    expect(() => timelineCoreConfigSchema.parse({ chunk_hours: '30h' })).toThrow();
    expect(() => timelineCoreConfigSchema.parse({ chunk_hours: 'invalid' })).toThrow();
  });
});
