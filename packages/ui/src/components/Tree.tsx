import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useCallback, useState } from 'react';
import styles from './Tree.module.css';

export interface TreeNode {
  id: string;
  label: string;
  icon?: 'folder' | 'file' | 'none';
  children?: TreeNode[];
  meta?: ReactNode;
  href?: string; // if set, clicking the row navigates
  initiallyOpen?: boolean;
}

export interface TreeProps {
  nodes: TreeNode[];
  selectedId?: string;
  onSelect?: (node: TreeNode) => void;
}

export function Tree({ nodes, selectedId, onSelect }: TreeProps) {
  return (
    <div className={styles.tree} role="tree">
      {nodes.map((n) => (
        <TreeRow key={n.id} node={n} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  selectedId?: string;
  onSelect?: (node: TreeNode) => void;
}

function TreeRow({ node, depth, selectedId, onSelect }: TreeRowProps) {
  const [open, setOpen] = useState(node.initiallyOpen ?? depth === 0);
  const hasChildren = !!node.children && node.children.length > 0;
  const selected = node.id === selectedId;

  const handleClick = useCallback(() => {
    if (hasChildren) setOpen((v) => !v);
    onSelect?.(node);
    if (node.href) window.location.hash = node.href;
  }, [hasChildren, node, onSelect]);

  const paddingLeft = 12 + depth * 16;
  const children = node.children ?? [];

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <>
      <button
        type="button"
        className={`${styles.row} ${selected ? styles.selected : ''}`}
        // Depth-driven indent. The `.row` class supplies baseline padding;
        // `paddingLeft` here overrides only the left value. Previously this
        // was paired with `all: 'unset'` which wiped the override — every
        // row ended up flush-left regardless of depth.
        style={{ paddingLeft }}
        onClick={handleClick}
        onKeyDown={handleKey}
        aria-pressed={selected}
        aria-expanded={hasChildren ? open : undefined}
      >
        {hasChildren ? (
          <ChevronRight className={`${styles.chev} ${open ? styles.chevOpen : ''}`} />
        ) : (
          <span className={styles.leafIndent} />
        )}
        {renderIcon(node, hasChildren, open, selected)}
        <span className={styles.label}>{node.label}</span>
        {node.meta != null && <span className={styles.meta}>{node.meta}</span>}
      </button>
      {hasChildren &&
        open &&
        children.map((c) => (
          <TreeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

function renderIcon(node: TreeNode, hasChildren: boolean, open: boolean, selected: boolean) {
  const cls = `${styles.icon} ${selected ? styles.iconAccent : ''}`;
  if (node.icon === 'none') return null;
  if (hasChildren || node.icon === 'folder') {
    return open ? <FolderOpen className={cls} /> : <Folder className={cls} />;
  }
  return <File className={cls} />;
}
