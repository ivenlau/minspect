import type { TreeNode } from '../../components/Tree';

export interface FlatFile {
  file_path: string;
  edit_count: number;
  last_edited: number;
  touch_count: number;
}

// Turn a flat file list into the recursive TreeNode shape consumed by the
// Tree primitive. Directories are synthesized from the path segments and
// sorted before files at each level (git / IDE convention).
export function buildFileTree(
  files: FlatFile[],
  buildHref: (filePath: string) => string,
): TreeNode[] {
  // Normalize to `/` for tree-building (parts need a single separator), but
  // keep the ORIGINAL file_path around so leaf nodes can link back to the
  // exact key stored in the DB. Windows paths have `\` in the DB — using
  // the normalized path in the href produces 0 blame rows on Windows.
  const normalized = files.map((f) => ({
    ...f,
    _parts: f.file_path.replace(/\\/g, '/').split('/').filter(Boolean),
  }));

  interface BuildNode {
    id: string;
    name: string;
    path: string; // tree-local path, slash-normalized (for display / node IDs)
    fullPath?: string; // original DB path, only set on leaf nodes
    isLeaf: boolean;
    edit_count?: number;
    children: Map<string, BuildNode>;
  }

  const root: BuildNode = {
    id: '',
    name: '',
    path: '',
    isLeaf: false,
    children: new Map(),
  };

  for (const f of normalized) {
    let cursor = root;
    const parts = f._parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? '';
      if (!part) continue;
      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join('/');
      let next = cursor.children.get(part);
      if (!next) {
        next = {
          id: pathSoFar,
          name: part,
          path: pathSoFar,
          fullPath: isLast ? f.file_path : undefined,
          isLeaf: isLast,
          edit_count: isLast ? f.edit_count : undefined,
          children: new Map(),
        };
        cursor.children.set(part, next);
      } else if (isLast) {
        next.isLeaf = true;
        next.edit_count = f.edit_count;
        next.fullPath = f.file_path;
      }
      cursor = next;
    }
  }

  // A chain of single-child directories collapses into one row (VSCode's
  // "compact folders" default). Implemented without parameter reassign so
  // Biome's `noParameterAssign` is happy.
  const collapse = (node: BuildNode): BuildNode => {
    let current = node;
    while (!current.isLeaf && current.children.size === 1) {
      const only = [...current.children.values()][0];
      if (!only) break;
      // Don't collapse if we'd eat the virtual root.
      if (current === root) return only;
      current = {
        id: only.id,
        name: `${current.name}/${only.name}`.replace(/^\//, ''),
        path: only.path,
        fullPath: only.fullPath,
        isLeaf: only.isLeaf,
        edit_count: only.edit_count,
        children: only.children,
      };
    }
    return current;
  };

  const toTreeNode = (n: BuildNode): TreeNode => {
    const collapsed = n === root ? n : collapse(n);
    const children: BuildNode[] = [...collapsed.children.values()]
      // Directories before files, then alpha within each group.
      .sort((a, b) => {
        if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
    const node: TreeNode = {
      id: collapsed.id,
      label: collapsed.name,
      icon: collapsed.isLeaf ? 'file' : 'folder',
    };
    if (children.length > 0) node.children = children.map(toTreeNode);
    if (collapsed.isLeaf) {
      // Use the ORIGINAL DB path for the href. The display label still
      // shows the slash-normalized name; only routing uses the raw key.
      node.href = buildHref(collapsed.fullPath ?? collapsed.path);
      node.meta = `${collapsed.edit_count ?? 0}`;
    }
    return node;
  };

  // Flatten the virtual root: return its children as top-level tree nodes.
  return [...root.children.values()]
    .sort((a, b) => {
      if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
      return a.name.localeCompare(b.name);
    })
    .map(toTreeNode);
}
