import {
  endOfDay,
  endOfHour,
  endOfMinute,
  isSameDay,
  startOfDay,
  startOfHour,
} from 'date-fns';

import type { DateRange } from '../range';
import { capEndDate } from './cap-end-date';

export const convertRangeToCacheFriendlyTimes = (
  range: DateRange,
  options?: {
    endCap?: boolean;
    chunkHours?: number;
  },
): DateRange => {
  let cacheableStart: Date;
  let cacheableEnd: Date;

  if (options?.chunkHours !== undefined) {
    if (isSameDay(range.start, range.end)) {
      const chunkHours = Math.max(1, Math.min(24, options.chunkHours));
      const chunkMs = chunkHours * 60 * 60 * 1000;
      const dayStart = startOfDay(range.start);
      const dayEnd = endOfDay(range.end);
      const dayStartMs = dayStart.getTime();

      const startOffsetMs = Math.max(0, range.start.getTime() - dayStartMs);
      const startChunkIndex = Math.floor(startOffsetMs / chunkMs);
      cacheableStart = new Date(dayStartMs + startChunkIndex * chunkMs);

      const endOffsetMs =
        range.end.getTime() === range.start.getTime()
          ? startOffsetMs
          : Math.max(0, range.end.getTime() - 1 - dayStartMs);
      const endChunkIndex = Math.floor(endOffsetMs / chunkMs);
      const chunkEndMs = dayStartMs + (endChunkIndex + 1) * chunkMs - 1;
      cacheableEnd = new Date(Math.min(chunkEndMs, dayEnd.getTime()));
    } else {
      cacheableStart = startOfDay(range.start);
      cacheableEnd = endOfDay(range.end);
    }
  } else {
    const widthSeconds = (range.end.getTime() - range.start.getTime()) / 1000;
    if (widthSeconds <= 60 * 60) {
      cacheableStart = startOfHour(range.start);
      cacheableEnd = endOfHour(range.end);
    } else {
      cacheableStart = startOfDay(range.start);
      cacheableEnd = endOfDay(range.end);
    }
  }

  if (options?.endCap) {
    cacheableEnd = endOfMinute(capEndDate(cacheableEnd));
  }

  return {
    start: cacheableStart,
    end: cacheableEnd,
  };
};
