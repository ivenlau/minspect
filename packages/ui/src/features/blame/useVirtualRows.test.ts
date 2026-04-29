import { describe, expect, it } from 'vitest';
import { computeVisible } from './useVirtualRows';

describe('computeVisible', () => {
  const base = { rowHeight: 22, totalRows: 10_000, buffer: 10, clientHeight: 440 } as const;

  it('returns empty window when totalRows is 0', () => {
    expect(computeVisible({ ...base, totalRows: 0, scrollTop: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
    });
  });

  it('returns empty window when clientHeight is 0 (hidden container)', () => {
    expect(computeVisible({ ...base, clientHeight: 0, scrollTop: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
    });
  });

  it('at scrollTop 0, starts at 0 and covers clientHeight+buffer rows', () => {
    // clientHeight 440 / 22 = 20 visible; + 10 buffer = 30 end
    expect(computeVisible({ ...base, scrollTop: 0 })).toEqual({
      startIndex: 0,
      endIndex: 30,
    });
  });

  it('mid-scroll: start = floor(scrollTop/rh) - buffer, clamped to 0', () => {
    // scrollTop 220 → rawStart 10, start 10-10 = 0
    expect(computeVisible({ ...base, scrollTop: 220 })).toEqual({
      startIndex: 0,
      endIndex: 40, // rawEnd ceil((220+440)/22) = 30, +10 = 40
    });
    // scrollTop 1100 → rawStart 50, start 40; rawEnd ceil(1540/22)=70, end 80
    expect(computeVisible({ ...base, scrollTop: 1100 })).toEqual({
      startIndex: 40,
      endIndex: 80,
    });
  });

  it('clamps endIndex to totalRows near the bottom', () => {
    // Very deep scroll — end stays at totalRows.
    const scrollTop = 10_000 * 22 - 100;
    const res = computeVisible({ ...base, scrollTop });
    expect(res.endIndex).toBe(10_000);
    expect(res.startIndex).toBeGreaterThan(9900);
  });

  it('works for small files (totalRows < visible rows)', () => {
    const res = computeVisible({ ...base, totalRows: 5, scrollTop: 0 });
    expect(res).toEqual({ startIndex: 0, endIndex: 5 });
  });

  it('respects buffer parameter (0 buffer = strict visible window)', () => {
    const res = computeVisible({ ...base, buffer: 0, scrollTop: 0 });
    // 440 / 22 = 20 visible, no buffer
    expect(res).toEqual({ startIndex: 0, endIndex: 20 });
  });
});
