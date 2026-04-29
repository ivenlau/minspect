import { describe, expect, it } from 'vitest';
import { buildFileTree } from './buildFileTree';

const href = (f: string) => `#/f/${encodeURIComponent(f)}`;

describe('buildFileTree', () => {
  it('returns empty tree for empty input', () => {
    expect(buildFileTree([], href)).toEqual([]);
  });

  it('builds a single-file tree (no nesting)', () => {
    const tree = buildFileTree(
      [{ file_path: 'README.md', edit_count: 3, last_edited: 1, touch_count: 1 }],
      href,
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toBe('README.md');
    expect(tree[0]?.icon).toBe('file');
    expect(tree[0]?.href).toBe(href('README.md'));
    expect(tree[0]?.meta).toBe('3');
  });

  it('groups files by directory and puts folders before files', () => {
    const tree = buildFileTree(
      [
        { file_path: 'README.md', edit_count: 1, last_edited: 1, touch_count: 1 },
        { file_path: 'src/a.ts', edit_count: 5, last_edited: 2, touch_count: 2 },
        { file_path: 'src/b.ts', edit_count: 2, last_edited: 3, touch_count: 1 },
      ],
      href,
    );
    // Folder `src` comes first, then `README.md`.
    expect(tree.map((n) => n.label)).toEqual(['src', 'README.md']);
    const src = tree[0];
    expect(src?.children).toHaveLength(2);
    expect(src?.children?.[0]?.label).toBe('a.ts');
    expect(src?.children?.[1]?.label).toBe('b.ts');
  });

  it('normalizes backslashes and collapses single-child directories', () => {
    const tree = buildFileTree(
      [
        {
          file_path: 'packages\\collector\\src\\api.ts',
          edit_count: 7,
          last_edited: 1,
          touch_count: 1,
        },
      ],
      href,
    );
    // With only one path, every level collapses into a single row.
    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toContain('packages');
    expect(tree[0]?.label).toContain('api.ts');
    expect(tree[0]?.icon).toBe('file');
  });

  it('does NOT collapse directories that have multiple children', () => {
    const tree = buildFileTree(
      [
        { file_path: 'pkg/a/x.ts', edit_count: 1, last_edited: 1, touch_count: 1 },
        { file_path: 'pkg/b/y.ts', edit_count: 1, last_edited: 1, touch_count: 1 },
      ],
      href,
    );
    // `pkg` has 2 children (a, b), so it stays as a distinct level.
    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toBe('pkg');
    expect(tree[0]?.children).toHaveLength(2);
  });

  it('leaf href uses the original DB path, not the slash-normalized one', () => {
    // Windows file_path has backslashes; the tree normalizes for layout but
    // the href must round-trip back to the exact key stored in the DB,
    // otherwise /api/blame returns empty on Windows.
    const windowsPath = 'C:\\Users\\me\\repo\\src\\api.ts';
    const tree = buildFileTree(
      [{ file_path: windowsPath, edit_count: 1, last_edited: 1, touch_count: 1 }],
      (fp) => `#/f/${encodeURIComponent(fp)}`,
    );
    // Walk down to the single leaf (compact-folders collapses to one row).
    let cur = tree[0];
    while (cur?.children && cur.children.length > 0) {
      cur = cur.children[0];
    }
    expect(cur?.href).toBe(`#/f/${encodeURIComponent(windowsPath)}`);
  });

  it('meta is the edit_count as string on leaf nodes', () => {
    const tree = buildFileTree(
      [{ file_path: 'x.ts', edit_count: 42, last_edited: 1, touch_count: 1 }],
      href,
    );
    expect(tree[0]?.meta).toBe('42');
  });
});
