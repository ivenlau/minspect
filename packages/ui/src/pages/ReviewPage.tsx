import {
  AlertCircle,
  Download,
  FileCode,
  Filter,
  MessageSquare,
  Search,
  Undo2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePoll } from '../api';
import { Badge, type BadgeLevel } from '../components/Badge';
import { ClickRow } from '../components/ClickRow';
import { DropdownPicker } from '../components/DropdownPicker';
import { EmptyState } from '../components/EmptyState';
import { Hunk } from '../components/Hunk';
import { RevertModal, type RevertTarget } from '../features/revert/RevertModal';
import type { ReviewResp, ReviewTurn } from '../features/session/types';
import { useLang } from '../i18n';
import styles from './ReviewPage.module.css';

const LEVEL_ORDER: Record<string, number> = { all: 0, info: 1, warn: 2, danger: 3 };

function topBadge(t: ReviewTurn): { level: BadgeLevel; label: string } | null {
  if (t.badges.length === 0) return null;
  // Sort danger > warn > info; within the same level just first wins.
  const sorted = [...t.badges].sort(
    (a, b) => (LEVEL_ORDER[b.level] ?? 0) - (LEVEL_ORDER[a.level] ?? 0),
  );
  const b = sorted[0];
  if (!b) return null;
  const level: BadgeLevel = b.level === 'info' ? 'info' : b.level;
  return { level, label: b.label };
}

function barColor(t: ReviewTurn): string {
  const top = topBadge(t);
  if (top?.level === 'danger') return 'var(--danger)';
  if (top?.level === 'warn') return 'var(--warn)';
  return 'rgba(88, 166, 255, 0.5)';
}

export interface ReviewPageProps {
  workspace: string;
  session: string;
}

interface FilterState {
  file: string;
  keyword: string;
  level: 'all' | 'info' | 'warn' | 'danger';
}

export function ReviewPage({ workspace, session }: ReviewPageProps) {
  const { t } = useLang();
  void workspace;
  const url = `/api/review?session=${encodeURIComponent(session)}`;
  const { data, error } = usePoll<ReviewResp>(url, 10_000);
  const [filter, setFilter] = useState<FilterState>({
    file: '',
    keyword: '',
    level: 'all',
  });
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);

  const turns = data?.turns ?? [];

  const matches = useMemo(() => {
    const fileNeedle = filter.file.toLowerCase();
    const kwNeedle = filter.keyword.toLowerCase();
    const minLevel = LEVEL_ORDER[filter.level] ?? 0;
    return turns.filter((turn) => {
      // File filter: at least one edit's path contains needle.
      if (fileNeedle && !turn.edits.some((e) => e.file_path.toLowerCase().includes(fileNeedle))) {
        return false;
      }
      // Keyword: search prompt / reasoning / final / any tool explanation.
      if (kwNeedle) {
        const blob = [
          turn.user_prompt ?? '',
          turn.agent_reasoning ?? '',
          turn.agent_final_message ?? '',
          ...turn.edits.map((e) => e.tool_call_explanation ?? ''),
        ]
          .join(' ')
          .toLowerCase();
        if (!blob.includes(kwNeedle)) return false;
      }
      // Level: at least one badge ≥ minLevel.
      if (minLevel > 0) {
        const has = turn.badges.some((b) => (LEVEL_ORDER[b.level] ?? 0) >= minLevel);
        if (!has) return false;
      }
      return true;
    });
  }, [turns, filter]);

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('common.failedToLoad', { what: 'review' })}
        subtitle={error.message}
      />
    );
  }

  return (
    <div className={styles.outer}>
      <aside className={styles.turnNav}>
        <div className={styles.turnNavHdr}>
          <span className={styles.turnNavTitle}>{t('review.turns')}</span>
          <span className={styles.turnNavSpacer} />
          <span className={styles.turnNavCount}>{turns.length}</span>
        </div>
        {turns.map((turn) => {
          const visible = matches.includes(turn);
          const top = topBadge(turn);
          return (
            <ClickRow
              key={turn.id}
              className={`${styles.turnNavRow} ${visible ? '' : styles.turnNavRowActive}`}
              onClick={() => {
                // Scroll the matching card into view if present.
                const el = document.getElementById(`turn-${turn.id}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span className={styles.turnNavBar} style={{ background: barColor(turn) }} />
              <span className={styles.turnNavIdx}>#{turn.idx}</span>
              <div className={styles.turnNavBody}>
                <span className={styles.turnNavPrompt}>
                  {turn.user_prompt.slice(0, 28) || '(no prompt)'}
                  {turn.user_prompt.length > 28 ? '…' : ''}
                </span>
                <div className={styles.turnNavMeta}>
                  <span>{turn.edits.length} edits</span>
                  {top && (
                    <span
                      style={{ color: top.level === 'danger' ? 'var(--danger)' : 'var(--warn)' }}
                    >
                      {top.level === 'danger' ? 'danger' : '⚠'}
                    </span>
                  )}
                </div>
              </div>
            </ClickRow>
          );
        })}
        {turns.length > matches.length && (
          <div className={styles.turnNavEllipsis}>
            {t('review.filteredOut', { n: turns.length - matches.length })}
          </div>
        )}
      </aside>

      <div className={styles.main}>
        <div className={styles.filter}>
          <div className={`${styles.filterInput} ${styles.narrow}`}>
            <Search size={12} />
            <input
              type="text"
              placeholder={t('review.filterFilePath')}
              value={filter.file}
              onChange={(e) => setFilter((f) => ({ ...f, file: e.target.value }))}
            />
          </div>
          <div className={`${styles.filterInput} ${styles.wide}`}>
            <Search size={12} />
            <input
              type="text"
              placeholder={t('review.filterKeyword')}
              value={filter.keyword}
              onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
            />
          </div>
          <DropdownPicker<FilterState['level']>
            value={filter.level}
            options={[
              { value: 'all', label: t('review.levelAll') },
              { value: 'info', label: t('review.levelInfo') },
              { value: 'warn', label: t('review.levelWarn') },
              { value: 'danger', label: t('review.levelDangerOnly') },
            ]}
            onChange={(v) => setFilter((f) => ({ ...f, level: v }))}
            ariaLabel={t('review.levelAll')}
          />
          <span className={styles.filterSpacer} />
          <span className={styles.filterResults}>
            {t('review.matchesCount', { n: matches.length, total: turns.length })}
          </span>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void exportReviewHtml(matches)}
          >
            <Download size={12} />
            <span>{t('review.export')}</span>
          </button>
        </div>

        <div className={styles.list}>
          {matches.length === 0 && (
            <EmptyState
              icon={turns.length === 0 ? MessageSquare : Filter}
              title={t(turns.length === 0 ? 'review.noTurnsTitle' : 'review.filterEmptyTitle')}
              subtitle={t(turns.length === 0 ? 'review.noTurnsSub' : 'review.filterEmptySub')}
            />
          )}
          {matches.map((turn) => (
            <TurnCard
              key={turn.id}
              turn={turn}
              onRevert={(id) => setRevertTarget({ kind: 'turn', id })}
            />
          ))}
        </div>

        {revertTarget && (
          <RevertModal target={revertTarget} onClose={() => setRevertTarget(null)} />
        )}
      </div>
    </div>
  );
}

// ----- TurnCard --------------------------------------------------------

function TurnCard({ turn, onRevert }: { turn: ReviewTurn; onRevert: (id: string) => void }) {
  const { t } = useLang();
  const top = topBadge(turn);
  const isDanger = top?.level === 'danger';
  const explanation =
    turn.edits.find((e) => e.tool_call_explanation)?.tool_call_explanation ?? null;
  const dur = turn.ended_at ? `${((turn.ended_at - turn.started_at) / 1000).toFixed(1)}s` : '—';
  const time = new Date(turn.started_at).toLocaleTimeString();

  return (
    <section
      id={`turn-${turn.id}`}
      className={`${styles.card} ${isDanger ? styles.cardDanger : ''}`}
    >
      <div className={styles.cardHdr}>
        <span className={styles.cardIdx}>#{turn.idx}</span>
        <span className={styles.cardPrompt}>
          {turn.user_prompt || t('sessionOverview.noPrompt')}
        </span>
        <div className={styles.cardHdrBadges}>
          {turn.badges.slice(0, 3).map((b) => (
            <Badge key={b.id} level={b.level} title={b.detail}>
              {b.label}
            </Badge>
          ))}
        </div>
        <button type="button" className={styles.btn} onClick={() => onRevert(turn.id)}>
          <Undo2 size={12} />
          <span>{t('review.revertTurn')}</span>
        </button>
      </div>
      <div className={styles.cardMeta}>
        <span>{t('review.turnMeta', { idx: turn.idx, edits: turn.edits.length })}</span>
        <span className={styles.cardMetaSpacer} />
        <span style={{ fontFamily: 'var(--font-mono)' }}>{t('review.durLine', { dur, time })}</span>
      </div>
      {explanation && (
        <div className={styles.cardExp}>
          <span className={styles.cardExpL}>{t('review.agentExplanation')}</span>
          <span className={styles.cardExpT}>{explanation}</span>
        </div>
      )}
      {turn.edits.map((e) => (
        <div key={e.id}>
          <div className={styles.cardEditHdr}>
            <FileCode size={12} className={styles.cardEditIcon} />
            <span className={styles.cardEditFile}>{e.file_path}</span>
            {e.tool_name && <span className={styles.cardEditTool}>{e.tool_name}</span>}
          </div>
          {e.hunks.map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: hunk index within an edit is stable
            <div key={i} style={{ marginTop: 6 }}>
              <Hunk hunk={h} />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

// ----- Export ----------------------------------------------------------

// Builds a self-contained HTML file from the currently-filtered turns and
// triggers a download. Handy for PR descriptions or pair-review chats.
async function exportReviewHtml(turns: ReviewTurn[]): Promise<void> {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      c === '&'
        ? '&amp;'
        : c === '<'
          ? '&lt;'
          : c === '>'
            ? '&gt;'
            : c === '"'
              ? '&quot;'
              : '&#39;',
    );
  const parts: string[] = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>minspect review export</title>',
    '<style>body{font:13px ui-monospace,Menlo,monospace;background:#0d1117;color:#e6edf3;margin:24px;}h2{margin:24px 0 8px;font-size:16px}.card{border:1px solid #30363d;border-radius:6px;padding:12px;margin:12px 0}.prompt{font-weight:500;margin-bottom:8px}.file{margin-top:8px;color:#58a6ff}.del{background:rgba(248,81,73,.12);color:#e6edf3;padding:0 6px}.add{background:rgba(63,185,80,.12);color:#e6edf3;padding:0 6px}pre{margin:4px 0;white-space:pre-wrap}</style></head><body>',
    `<h1>minspect review export (${turns.length} turns)</h1>`,
  ];
  for (const t of turns) {
    parts.push(`<div class="card"><div class="prompt">#${t.idx} ${esc(t.user_prompt)}</div>`);
    for (const e of t.edits) {
      parts.push(`<div class="file">${esc(e.file_path)}</div>`);
      for (const h of e.hunks) {
        if (h.old_text) parts.push(`<pre class="del">${esc(h.old_text)}</pre>`);
        if (h.new_text) parts.push(`<pre class="add">${esc(h.new_text)}</pre>`);
      }
    }
    parts.push('</div>');
  }
  parts.push('</body></html>');
  const blob = new Blob([parts.join('\n')], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `minspect-review-${Date.now()}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
