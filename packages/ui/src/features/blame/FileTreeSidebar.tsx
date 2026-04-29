import { FileText, Search, X } from 'lucide-react';
import { type ChangeEvent, useMemo, useState } from 'react';
import { usePoll } from '../../api';
import { ClickRow } from '../../components/ClickRow';
import { EmptyState } from '../../components/EmptyState';
import { Tree } from '../../components/Tree';
import { useLang } from '../../i18n';
import { hrefFor, navigate } from '../../router';
import styles from './FileTreeSidebar.module.css';
import { type FlatFile, buildFileTree } from './buildFileTree';

export interface FileTreeSidebarProps {
  workspace: string;
  activeFile?: string | null;
}

interface Resp {
  files: FlatFile[];
}

function pathTail(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function FileTreeSidebar({ workspace, activeFile }: FileTreeSidebarProps) {
  const { t } = useLang();
  const url = `/api/workspaces/${encodeURIComponent(workspace)}/files`;
  const { data } = usePoll<Resp>(url, 5000);
  const files = data?.files ?? [];
  const [query, setQuery] = useState('');

  // Search semantics: substring match against the normalized file path —
  // case-insensitive, forward slashes. When the query is empty we render
  // the tree as usual; otherwise render a flat list of matches (shows the
  // full relative path as the row label so users can disambiguate files
  // with the same basename under different directories).
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return files.filter((f) => f.file_path.toLowerCase().replace(/\\/g, '/').includes(q));
  }, [files, q]);

  const nodes = useMemo(
    () => buildFileTree(files, (fp) => hrefFor({ kind: 'blame', workspace, file: fp })),
    [files, workspace],
  );

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{pathTail(workspace).toUpperCase()}</span>
      </div>
      <div className={styles.searchRow}>
        <Search size={12} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder={t('filetree.filterPlaceholder')}
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => setQuery('')}
            aria-label={t('common.clear')}
            title={t('filetree.clear')}
          >
            <X size={11} />
          </button>
        )}
      </div>
      {files.length === 0 ? (
        <EmptyState icon={FileText} compact title={t('filetree.noFiles')} />
      ) : q ? (
        matches.length === 0 ? (
          <EmptyState icon={Search} compact title={t('filetree.noMatches')} />
        ) : (
          <div className={styles.matchList}>
            {matches.map((f) => {
              const href = hrefFor({ kind: 'blame', workspace, file: f.file_path });
              const isActive = activeFile === f.file_path;
              return (
                <ClickRow
                  key={f.file_path}
                  className={`${styles.matchRow} ${isActive ? styles.matchRowActive : ''}`}
                  onClick={() => navigate(href)}
                  title={f.file_path}
                >
                  <span className={styles.matchPath}>{f.file_path}</span>
                  <span className={styles.matchMeta}>{f.edit_count}</span>
                </ClickRow>
              );
            })}
          </div>
        )
      ) : (
        <Tree nodes={nodes} selectedId={activeFile ?? undefined} />
      )}
    </div>
  );
}
