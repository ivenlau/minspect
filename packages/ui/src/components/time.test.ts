import { describe, expect, it } from 'vitest';
import { fmtDateTime, fmtTimeOfDay } from './time';

describe('time formatting', () => {
  it('formats full datetime as YYYY-MM-DD HH:MM', () => {
    // 2026-08-21 12:23 local
    expect(fmtDateTime(new Date(2026, 7, 21, 12, 23).getTime())).toBe('2026-08-21 12:23');
  });

  it('pads single-digit month/day/hour/minute', () => {
    expect(fmtDateTime(new Date(2026, 0, 3, 4, 5).getTime())).toBe('2026-01-03 04:05');
    expect(fmtTimeOfDay(new Date(2026, 7, 21, 8, 9).getTime())).toBe('08:09');
  });

  it('formats time of day only when narrow', () => {
    expect(fmtTimeOfDay(new Date(2026, 7, 21, 12, 23).getTime())).toBe('12:23');
  });
});
