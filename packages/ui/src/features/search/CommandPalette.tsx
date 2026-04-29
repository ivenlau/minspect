import { FileCode, MessageSquare, Search, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJson } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { type StringKey, useLang } from '../../i18n';
import { hrefFor, navigate } from '../../router';
import styles from './CommandPalette.module.css';

export type SearchKind = 'prompt' | 'reasoning' | 'message' | 'explanation' | 'file_path';

export interface SearchResult {
  kind: SearchKind;
  source_id: string;
  session_id: string;
  workspace_id: string;
  content: string;
  snippet: string;
}

interface SearchResp {
  fts_available: boolean;
  query?: string;
  results: SearchResult[];
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

// Maps a result kind to a concrete route. prompts / reasoning / messages /
// explanations all land on the session's Review tab with an anchor to the
// turn (explanation lacks a direct turn_id so we fall back to review top).
// file_path opens Blame. Called on click.
function hrefForResult(r: SearchResult): string {
  const sessionTab = hrefFor({
    kind: 'session',
    workspace: r.workspace_id,
    session: r.session_id,
    tab: 'review',
  });
  switch (r.kind) {
    case 'prompt':
    case 'reasoning':
    case 'message':
      return `${sessionTab}#turn-${r.source_id}`;
    case 'explanation':
      return sessionTab;
    case 'file_path':
      return hrefFor({ kind: 'blame', workspace: r.workspace_id, file: r.content });
  }
}

function kindIcon(kind: SearchKind) {
  switch (kind) {
    case 'prompt':
      return MessageSquare;
    case 'reasoning':
    case 'message':
    case 'explanation':
      return Sparkles;
    case 'file_path':
      return FileCode;
  }
}

// Palette groups — translate the user-visible label per kind. Keep the
// internal function (instead of inlining t(...)) so call sites stay tidy.
function kindLabelKey(kind: SearchKind): StringKey {
  switch (kind) {
    case 'prompt':
      return 'palette.kind.prompt';
    case 'reasoning':
      return 'palette.kind.reasoning';
    case 'message':
      return 'palette.kind.message';
    case 'explanation':
      return 'palette.kind.explanation';
    case 'file_path':
      return 'palette.kind.file';
  }
}

const KIND_ORDER: SearchKind[] = ['prompt', 'explanation', 'file_path', 'reasoning', 'message'];

// Full-screen modal overlay. Debounced fetch on input change (200ms); ↑ / ↓
// navigates highlight; Enter opens; Esc closes. Rendered as a portal-like
// fixed-position panel so it sits above the normal three-pane layout.
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [ftsOk, setFtsOk] = useState(true);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Clear state when the palette transitions from closed → open.
  useEffect(() => {
    if (open) {
      setQ('');
      setResults([]);
      setActive(0);
      // Give React a tick to mount the input before focusing.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced search. Cancels in-flight request when the user keeps typing.
  useEffect(() => {
    if (!open) return;
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      getJson<SearchResp>(`/api/search?q=${encodeURIComponent(q)}&limit=20`, ctrl.signal)
        .then((r) => {
          setFtsOk(r.fts_available);
          setResults(r.results);
          setActive(0);
        })
        .catch((e) => {
          // AbortError is the normal cancel path, everything else is a real
          // failure worth surfacing in the dev console.
          if ((e as { name?: string }).name !== 'AbortError') {
            console.error('palette search failed', e);
          }
        });
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  // Group for display so prompts / files / reasoning don't mash together.
  const grouped = useMemo(() => {
    const map = new Map<SearchKind, SearchResult[]>();
    for (const r of results) {
      const list = map.get(r.kind) ?? [];
      list.push(r);
      map.set(r.kind, list);
    }
    return KIND_ORDER.filter((k) => map.has(k)).map((k) => ({
      kind: k,
      items: map.get(k) ?? [],
    }));
  }, [results]);

  // Flat order for arrow-key navigation.
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  const openResult = useCallback(
    (r: SearchResult) => {
      navigate(hrefForResult(r));
      onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive((i) => Math.min(flat.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((i) => Math.max(0, i - 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const target = flat[active];
          if (target) openResult(target);
        }
      }}
      role="presentation"
    >
      <div className={styles.panel}>
        <div className={styles.inputRow}>
          <Search size={14} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('palette.placeholder')}
          />
          <span className={styles.hint}>{t('palette.esc')}</span>
        </div>

        <div className={styles.body}>
          {!ftsOk && (
            <EmptyState
              icon={Search}
              compact
              title={t('palette.ftsUnavailableTitle')}
              subtitle={t('palette.ftsUnavailableSub')}
            />
          )}
          {ftsOk && q.trim() && flat.length === 0 && (
            <EmptyState icon={Search} compact title={t('palette.noMatches')} />
          )}
          {ftsOk && !q.trim() && (
            <div className={styles.tips}>
              <div>
                <kbd>↑</kbd> <kbd>↓</kbd> {t('palette.tipLine1Nav')} · <kbd>Enter</kbd>{' '}
                {t('palette.tipLine1Open')}
              </div>
              <div className={styles.tipsSub}>{t('palette.tipLine2')}</div>
            </div>
          )}
          {grouped.map((g) => (
            <div key={g.kind} className={styles.group}>
              <div className={styles.groupHdr}>{t(kindLabelKey(g.kind)).toUpperCase()}</div>
              {g.items.map((r) => {
                const Icon = kindIcon(r.kind);
                const idx = flat.indexOf(r);
                const isActive = idx === active;
                return (
                  <button
                    type="button"
                    key={`${r.kind}:${r.source_id}`}
                    className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => openResult(r)}
                  >
                    <Icon size={12} className={styles.rowIcon} />
                    <span className={styles.rowKind}>{t(kindLabelKey(r.kind))}</span>
                    <span
                      className={styles.rowSnippet}
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: snippet comes from the local collector's own sanitized output (only <mark> tags inserted by FTS5 snippet()); input is pre-sanitized upstream.
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                    <span className={styles.rowMeta}>
                      {r.session_id.slice(0, 8)} · {r.workspace_id.split(/[\\/]/).pop()}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
