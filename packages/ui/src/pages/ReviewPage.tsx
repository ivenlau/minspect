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
      {turn.edits.length === 0 && turn.agent_final_message && (
        <div className={styles.cardExp}>
          <span className={styles.cardExpL}>{t('blame.inspector.finalMessage')}</span>
          <span className={styles.cardExpT}>{turn.agent_final_message}</span>
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
// triggers a download. Reads CSS variable values at runtime so the export
// matches the current theme (dark / light).
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

  const splitLines = (s: string | null | undefined): string[] => {
    if (!s) return [];
    const lines = s.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };

  // Read current theme values from the document root.
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();

  const badgeColor = (level: string): { bg: string; fg: string } => {
    if (level === 'danger') return { bg: v('--danger'), fg: '#fff' };
    if (level === 'warn') return { bg: v('--warn'), fg: '#0d1117' };
    if (level === 'success') return { bg: v('--success'), fg: '#0d1117' };
    return { bg: v('--bg-2'), fg: v('--text-0') }; // info / muted
  };

  // CSS with tokens resolved to the current theme's computed values.
  const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: ${v('--bg-0')}; color: ${v('--text-0')}; font-family: ${v('--font-sans')}; font-size: ${v('--fs-13')}; line-height: 1.45; -webkit-font-smoothing: antialiased; }

/* layout */
.main { min-width: 0; display: flex; flex-direction: column; background: ${v('--bg-0')}; min-height: 100vh; }
.list { flex: 1; overflow: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; }
.listHdr { font-size: ${v('--fs-18')}; font-weight: 600; color: ${v('--text-0')}; padding: 4px 0 8px; }

/* card */
.card { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: ${v('--radius-6')}; border: 1px solid ${v('--border')}; background: ${v('--bg-1')}; }
.cardDanger { border-color: ${v('--danger')}; }
.cardHdr { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cardIdx { padding: 3px 8px; background: ${v('--bg-2')}; border-radius: ${v('--radius-3')}; font-family: ${v('--font-mono')}; font-size: ${v('--fs-11')}; font-weight: 600; color: ${v('--text-0')}; }
.cardPrompt { font-size: ${v('--fs-13')}; font-weight: 500; color: ${v('--text-0')}; flex: 1; min-width: 0; }
.cardHdrBadges { display: flex; gap: 6px; flex-wrap: wrap; }
.cardMeta { display: flex; gap: 12px; font-size: ${v('--fs-11')}; color: ${v('--text-2')}; }
.cardMetaSpacer { flex: 1; }
.cardExp { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: ${v('--bg-2')}; border-radius: ${v('--radius-4')}; }
.cardExpL { font-size: 9px; font-weight: 600; letter-spacing: 0.8px; color: ${v('--text-2')}; }
.cardExpT { font-size: ${v('--fs-12')}; color: ${v('--text-1')}; line-height: 1.5; white-space: pre-wrap; }
.cardEditHdr { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.cardEditIcon { color: ${v('--accent')}; }
.cardEditFile { font-family: ${v('--font-mono')}; font-size: ${v('--fs-11')}; font-weight: 500; color: ${v('--text-0')}; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cardEditTool { padding: 1px 6px; background: ${v('--bg-2')}; color: ${v('--accent')}; border-radius: ${v('--radius-2')}; font-family: ${v('--font-mono')}; font-size: ${v('--fs-10')}; }

/* badge */
.badge { display: inline-flex; align-items: center; padding: 2px 8px; font-size: ${v('--fs-10')}; font-weight: 500; border-radius: ${v('--radius-3')}; letter-spacing: 0.2px; }

/* hunk */
.hunk { border: 1px solid ${v('--border-subtle')}; border-radius: ${v('--radius-4')}; overflow: hidden; font-family: ${v('--font-mono')}; font-size: ${v('--fs-11')}; background: ${v('--bg-0')}; }
.hunkHead { padding: 4px 10px; background: ${v('--bg-2')}; color: ${v('--text-2')}; font-size: ${v('--fs-10')}; border-bottom: 1px solid ${v('--border-subtle')}; }
.hunkBody { display: block; }
.hunkRow { display: flex; align-items: center; min-height: 20px; padding: 0 10px; }
.hunkDel { background: ${v('--diff-del-bg')}; }
.hunkAdd { background: ${v('--diff-add-bg')}; }
.hunkLn { width: 28px; text-align: right; color: ${v('--text-2')}; flex-shrink: 0; user-select: none; }
.hunkSign { width: 16px; text-align: center; flex-shrink: 0; user-select: none; }
.hunkSignDel { color: ${v('--danger')}; }
.hunkSignAdd { color: ${v('--success')}; }
.hunkCode { color: ${v('--text-0')}; white-space: pre; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
`;

  // Build hunk HTML
  const renderHunk = (h: {
    old_text: string | null;
    new_text: string | null;
    new_start: number;
    new_count: number;
    old_start?: number | null;
    old_count?: number | null;
  }): string => {
    const dels = splitLines(h.old_text);
    const adds = splitLines(h.new_text);
    const osStart = h.old_start ?? null;
    const osCount = h.old_count ?? 0;
    const headTxt =
      osStart == null
        ? `@@ new file · +${h.new_count} @@`
        : `@@ -${osStart},${osCount} +${h.new_start},${h.new_count} @@`;

    let rows = '';
    for (let i = 0; i < dels.length; i++) {
      rows += `<div class="hunkRow hunkDel"><span class="hunkLn">${(osStart ?? 0) + i}</span><span class="hunkSign hunkSignDel">&#8722;</span><span class="hunkCode">${esc(dels[i])}</span></div>`;
    }
    for (let i = 0; i < adds.length; i++) {
      rows += `<div class="hunkRow hunkAdd"><span class="hunkLn">${h.new_start + i}</span><span class="hunkSign hunkSignAdd">+</span><span class="hunkCode">${esc(adds[i])}</span></div>`;
    }
    return `<div class="hunk"><div class="hunkHead">${esc(headTxt)}</div><div class="hunkBody">${rows}</div></div>`;
  };

  // Build card HTML
  const cards = turns
    .map((t) => {
      const top = topBadge(t);
      const isDanger = top?.level === 'danger';
      const explanation =
        t.edits.find((e) => e.tool_call_explanation)?.tool_call_explanation ?? null;
      const dur = t.ended_at ? `${((t.ended_at - t.started_at) / 1000).toFixed(1)}s` : '—';
      const time = new Date(t.started_at).toLocaleTimeString();

      // Badges
      const badgesHtml = t.badges
        .slice(0, 3)
        .map((b) => {
          const c = badgeColor(b.level);
          return `<span class="badge" style="background:${c.bg};color:${c.fg}" title="${esc(b.detail ?? '')}">${esc(b.label)}</span>`;
        })
        .join('');

      // Explanation
      const expHtml = explanation
        ? `<div class="cardExp"><span class="cardExpL">EXPLANATION</span><span class="cardExpT">${esc(explanation)}</span></div>`
        : '';

      // Final message for empty turns
      const finalHtml =
        t.edits.length === 0 && t.agent_final_message
          ? `<div class="cardExp"><span class="cardExpL">AGENT FINAL MESSAGE</span><span class="cardExpT">${esc(t.agent_final_message)}</span></div>`
          : '';

      // Edits
      const editsHtml = t.edits
        .map((e) => {
          const toolTag = e.tool_name
            ? `<span class="cardEditTool">${esc(e.tool_name)}</span>`
            : '';
          const hunksHtml = e.hunks.map(renderHunk).join('\n<div style="margin-top:6px"></div>');
          return `<div><div class="cardEditHdr"><span class="cardEditIcon">&#128196;</span><span class="cardEditFile">${esc(e.file_path)}</span>${toolTag}</div><div style="margin-top:6px">${hunksHtml}</div></div>`;
        })
        .join('');

      return `<section class="card${isDanger ? ' cardDanger' : ''}">
  <div class="cardHdr"><span class="cardIdx">#${t.idx}</span><span class="cardPrompt">${esc(t.user_prompt || '(no prompt)')}</span><div class="cardHdrBadges">${badgesHtml}</div></div>
  <div class="cardMeta"><span>turn #${t.idx} · ${t.edits.length} edits</span><span class="cardMetaSpacer"></span><span style="font-family:'JetBrains Mono',monospace">${dur} · ${time}</span></div>
  ${expHtml}${finalHtml}${editsHtml}
</section>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>minspect review export</title><style>${css}</style></head><body>
<div class="main">
  <div class="list">
    <div class="listHdr">minspect review export (${turns.length} turns)</div>
    ${cards}
  </div>
</div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `minspect-review-${Date.now()}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
