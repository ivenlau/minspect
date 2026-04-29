import { describe, expect, it } from 'vitest';
import { parseApplyPatch, toFileEdits } from './patch.js';

function first<T>(arr: T[]): T {
  const x = arr[0];
  if (!x) throw new Error('expected non-empty array');
  return x;
}

describe('parseApplyPatch', () => {
  it('parses a single Update File hunk', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: a.txt',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r).toHaveLength(1);
    const f = first(r);
    expect(f.kind).toBe('update');
    expect(f.file_path).toBe('a.txt');
    expect(f.before).toBe('old');
    expect(f.after).toBe('new');
  });

  it('parses context lines on both sides', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: a.txt',
      '@@',
      ' ctx1',
      '-old',
      '+new',
      ' ctx2',
      '*** End Patch',
    ].join('\n');
    const f = first(parseApplyPatch(patch));
    expect(f.before).toBe('ctx1\nold\nctx2');
    expect(f.after).toBe('ctx1\nnew\nctx2');
  });

  it('parses Add File: no before, after is the +content', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: new.txt',
      '+hello',
      '+world',
      '*** End Patch',
    ].join('\n');
    const f = first(parseApplyPatch(patch));
    expect(f.kind).toBe('add');
    expect(f.before).toBeNull();
    expect(f.after).toBe('hello\nworld');
  });

  it('parses Delete File: after is empty', () => {
    const patch = ['*** Begin Patch', '*** Delete File: gone.txt', '*** End Patch'].join('\n');
    const f = first(parseApplyPatch(patch));
    expect(f.kind).toBe('delete');
    expect(f.after).toBe('');
  });

  it('parses multiple files in one patch', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: a.txt',
      '@@',
      '-a',
      '+A',
      '*** Update File: b.txt',
      '@@',
      '-b',
      '+B',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r).toHaveLength(2);
    expect(r[0]?.file_path).toBe('a.txt');
    expect(r[1]?.file_path).toBe('b.txt');
  });

  it('handles missing End Patch gracefully', () => {
    const patch = '*** Begin Patch\n*** Update File: a.txt\n@@\n-x\n+y\n';
    const f = first(parseApplyPatch(patch));
    expect(f.before).toBe('x');
    expect(f.after).toBe('y');
  });

  it('toFileEdits shapes the output for the collector', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: a.txt',
      '@@',
      '-x',
      '+y',
      '*** End Patch',
    ].join('\n');
    const edits = toFileEdits(parseApplyPatch(patch));
    expect(edits).toEqual([{ file_path: 'a.txt', before_content: 'x', after_content: 'y' }]);
  });
});
