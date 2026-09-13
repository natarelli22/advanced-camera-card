import { describe, expect, it, vi } from 'vitest';

import { convertRangeToCacheFriendlyTimes } from '../../../src/camera-manager/utils/range-to-cache-friendly';

describe('convertRangeToCacheFriendlyTimes', () => {
  it('should return cache friendly within hour range', () => {
    expect(
      convertRangeToCacheFriendlyTimes({
        start: new Date('2023-04-29T14:01:02'),
        end: new Date('2023-04-29T14:11:03'),
      }),
    ).toEqual({
      start: new Date('2023-04-29T14:00:00'),
      end: new Date('2023-04-29T14:59:59.999'),
    });
  });

  it('should return cache friendly within day range', () => {
    expect(
      convertRangeToCacheFriendlyTimes({
        start: new Date('2023-04-29T14:01:02'),
        end: new Date('2023-04-29T15:11:03'),
      }),
    ).toEqual({
      start: new Date('2023-04-29T00:00:00'),
      end: new Date('2023-04-29T23:59:59.999'),
    });
  });

  it('should cap end date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-04-29T14:25'));
    expect(
      convertRangeToCacheFriendlyTimes(
        {
          start: new Date('2023-04-29T14:01:02'),
          end: new Date('2023-04-29T14:11:03'),
        },
        { endCap: true },
      ),
    ).toEqual({
      start: new Date('2023-04-29T14:00:00'),
      end: new Date('2023-04-29T14:25:59.999'),
    });
    vi.useRealTimers();
  });

  describe('chunkHours option', () => {
    it('should return 12h chunk for morning with chunkHours=12', () => {
      expect(
        convertRangeToCacheFriendlyTimes(
          {
            start: new Date('2023-04-29T08:00:00'),
            end: new Date('2023-04-29T11:00:00'),
          },
          { chunkHours: 12 },
        ),
      ).toEqual({
        start: new Date('2023-04-29T00:00:00'),
        end: new Date('2023-04-29T11:59:59.999'),
      });
    });

    it('should return 12h chunk for afternoon with chunkHours=12', () => {
      expect(
        convertRangeToCacheFriendlyTimes(
          {
            start: new Date('2023-04-29T14:00:00'),
            end: new Date('2023-04-29T17:00:00'),
          },
          { chunkHours: 12 },
        ),
      ).toEqual({
        start: new Date('2023-04-29T12:00:00'),
        end: new Date('2023-04-29T23:59:59.999'),
      });
    });

    it('should return full day if spanning across noon with chunkHours=12', () => {
      expect(
        convertRangeToCacheFriendlyTimes(
          {
            start: new Date('2023-04-29T11:00:00'),
            end: new Date('2023-04-29T13:00:00'),
          },
          { chunkHours: 12 },
        ),
      ).toEqual({
        start: new Date('2023-04-29T00:00:00'),
        end: new Date('2023-04-29T23:59:59.999'),
      });
    });

    it('should return full day with chunkHours=24', () => {
      expect(
        convertRangeToCacheFriendlyTimes(
          {
            start: new Date('2023-04-29T08:00:00'),
            end: new Date('2023-04-29T11:00:00'),
          },
          { chunkHours: 24 },
        ),
      ).toEqual({
        start: new Date('2023-04-29T00:00:00'),
        end: new Date('2023-04-29T23:59:59.999'),
      });
    });

    it('should apply chunkHours to today as well', () => {
      expect(
        convertRangeToCacheFriendlyTimes(
          {
            start: new Date('2026-09-13T08:00:00'),
            end: new Date('2026-09-13T10:00:00'),
          },
          { chunkHours: 12 },
        ),
      ).toEqual({
        start: new Date('2026-09-13T00:00:00'),
        end: new Date('2026-09-13T11:59:59.999'),
      });
    });

    it('should handle multiple days spanning with chunkHours', () => {
      expect(
        convertRangeToCacheFriendlyTimes(
          {
            start: new Date('2026-09-12T10:00:00'),
            end: new Date('2026-09-13T10:00:00'),
          },
          { chunkHours: 12 },
        ),
      ).toEqual({
        start: new Date('2026-09-12T00:00:00'),
        end: new Date('2026-09-13T23:59:59.999'),
      });
    });

    it('should handle single point in time', () => {
      const pt = new Date('2026-09-13T14:00:00');
      expect(
        convertRangeToCacheFriendlyTimes(
          {
            start: pt,
            end: pt,
          },
          { chunkHours: 12 },
        ),
      ).toEqual({
        start: new Date('2026-09-13T12:00:00'),
        end: new Date('2026-09-13T23:59:59.999'),
      });
    });
  });
});
