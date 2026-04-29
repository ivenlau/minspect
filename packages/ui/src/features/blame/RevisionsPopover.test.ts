import { describe, expect, it } from 'vitest';
import { linesForEdit, _relTime as relTime } from './RevisionsPopover';

describe('linesForEdit', () => {
  const blame = [
    { line_no: 1, edit_id: 'e1' },
    { line_no: 2, edit_id: 'e2' },
    { line_no: 3, edit_id: 'e1' },
    { line_no: 4, edit_id: 'e3' },
    { line_no: 5, edit_id: 'e1' },
  ];
  it('returns all lines attributed to a given edit', () => {
    expect(linesForEdit(blame, 'e1')).toEqual([1, 3, 5]);
  });
  it('returns empty for an unknown edit id', () => {
    expect(linesForEdit(blame, 'nope')).toEqual([]);
  });
});

describe('relTime', () => {
  const now = new Date('2026-04-29T12:00:00Z').getTime();
  it('formats seconds', () => {
    expect(relTime(now - 5_000, now)).toBe('5s ago');
  });
  it('formats minutes', () => {
    expect(relTime(now - 2 * 60_000, now)).toBe('2m ago');
  });
  it('formats hours', () => {
    expect(relTime(now - 3 * 3_600_000, now)).toBe('3h ago');
  });
  it('yesterday for 1 day', () => {
    expect(relTime(now - 26 * 3_600_000, now)).toBe('yesterday');
  });
  it('returns Nd ago for 2..6 days', () => {
    expect(relTime(now - 3 * 86_400_000, now)).toBe('3d ago');
  });
  it('falls back to ISO-ish date for older entries', () => {
    expect(relTime(now - 30 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
