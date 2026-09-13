import { describe, expect, it } from 'vitest';

import {
  thumbnailControlsBaseDefaults,
  thumbnailsControlBaseSchema,
  thumbnailsControlSchema,
} from '../../../../../src/config/schema/common/controls/thumbnails';

describe('thumbnailsControlBaseSchema', () => {
  it('should parse with default chunk_hours', () => {
    const parsed = thumbnailsControlBaseSchema.parse({});
    expect(parsed.chunk_hours).toBe(24);
    expect(parsed.chunk_hours).toBe(thumbnailControlsBaseDefaults.chunk_hours);
  });

  it('should accept number chunk_hours', () => {
    const parsed = thumbnailsControlBaseSchema.parse({
      chunk_hours: 12,
    });
    expect(parsed.chunk_hours).toBe(12);
  });

  it('should accept string chunk_hours with or without h suffix', () => {
    expect(thumbnailsControlBaseSchema.parse({ chunk_hours: '12h' }).chunk_hours).toBe(
      12,
    );
    expect(thumbnailsControlBaseSchema.parse({ chunk_hours: '12H' }).chunk_hours).toBe(
      12,
    );
    expect(thumbnailsControlBaseSchema.parse({ chunk_hours: '24' }).chunk_hours).toBe(
      24,
    );
    expect(
      thumbnailsControlBaseSchema.parse({ chunk_hours: '  6h  ' }).chunk_hours,
    ).toBe(6);
  });

  it('should reject out of range chunk_hours', () => {
    expect(() => thumbnailsControlBaseSchema.parse({ chunk_hours: 0 })).toThrow();
    expect(() => thumbnailsControlBaseSchema.parse({ chunk_hours: 25 })).toThrow();
    expect(() => thumbnailsControlBaseSchema.parse({ chunk_hours: '0h' })).toThrow();
    expect(() => thumbnailsControlBaseSchema.parse({ chunk_hours: '30h' })).toThrow();
    expect(() =>
      thumbnailsControlBaseSchema.parse({ chunk_hours: 'invalid' }),
    ).toThrow();
  });
});

describe('thumbnailsControlSchema', () => {
  it('should parse with default mode and chunk_hours', () => {
    const parsed = thumbnailsControlSchema.parse({});
    expect(parsed.mode).toBe('right');
    expect(parsed.chunk_hours).toBe(24);
  });
});
