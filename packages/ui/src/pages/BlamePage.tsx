import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileCode,
  FileText,
  History,
  Search,
  Undo2,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePoll } from '../api';
import { ClickRow } from '../components/ClickRow';
import { EmptyState } from '../components/EmptyState';
import { RevisionsPopover, linesForEdit } from '../features/blame/RevisionsPopover';
import { useVirtualRows } from '../features/blame/useVirtualRows';
import { RevertModal, type RevertTarget } from '../features/revert/RevertModal';
import { useLang } from '../i18n';
import { Inspector } from '../layout/Inspector';
import styles from './BlamePage.module.css';

// Fixed row height, matches `.row { height: 22px }` in BlamePage.module.css.
// Virtualization math assumes every rendered row is exactly this tall;
// editing the CSS without updating this constant will drift the scrollbar.
const ROW_HEIGHT = 22;

// `?rev=<edit_id>` in the hash puts the page in historical-revision mode.
// Router treats this as page-internal query (same pattern as review/replay
// filters), so we parse it ourselves and push back via location.hash so
// back/forward navigation works.
function readRevFromHash(): string | null {
  const h = window.location.hash;
  const qIdx = h.indexOf('?');
  if (qIdx < 0) return null;
  // Strip a possible inner '#anchor' tail (useHashAnchor territory).
  const queryPart = h.slice(qIdx + 1).split('#')[0] ?? '';
  return new URLSearchParams(queryPart).get('rev');
}

function writeRevToHash(rev: string | null): void {
  const h = window.location.hash || '#';
  const [beforeQ, afterQ] = h.split('?') as [string, string | undefined];
  const beforeAnchor = (afterQ ?? '').split('#')[0] ?? '';
  const anchorTail = (afterQ ?? '').slice(beforeAnchor.length);
  const params = new URLSearchParams(beforeAnchor);
  if (rev) params.set('rev', rev);
  else params.delete('rev');
  const qStr = params.toString();
  const next = qStr ? `${beforeQ}?${qStr}${anchorTail}` : `${beforeQ}${anchorTail}`;
  if (next !== h) window.location.hash = next;
}

export interface BlameRow {
  line_no: number;
  content_hash: string;
  edit_id: string;
  turn_id: string;
  session_id: string;
  created_at: number;
  tool_call_id: string | null;
  tool_name: string | null;
  tool_call_explanation: string | null;
}

export interface BlameTurn {
  id: string;
  session_id: string;
  idx: number;
  user_prompt: string;
  agent_reasoning: string | null;
  agent_final_message: string | null;
  started_at: number;
}

export interface BlameEdit {
  id: string;
  turn_id: string;
  session_id: string;
  before_hash: string | null;
  after_hash: string;
  created_at: number;
  hunk_count: number;
}

export interface BlameResp {
  blame: BlameRow[];
  turns: BlameTurn[];
  content: string;
  edits: BlameEdit[];
  chain_broken_edit_ids: string[];
}

// Color palette for per-session blame bars. Up to 5 distinct sessions on
// the same file get distinct colors; anything beyond wraps.
const SESSION_PALETTE = [
  'var(--accent)',
  'var(--warn)',
  'var(--violet)',
  'var(--success)',
  '#d44b6f',
];

function sessionColor(sessionId: string, order: Map<string, number>): string {
  let idx = order.get(sessionId);
  if (idx === undefined) {
    idx = order.size;
    order.set(sessionId, idx);
  }
  return SESSION_PALETTE[idx % SESSION_PALETTE.length] ?? 'var(--accent)';
}

function pathTail(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export interface BlamePageProps {
  workspace: string;
  file: string;
}

export function BlamePage({ workspace, file }: BlamePageProps) {
  const { t } = useLang();

  // Historical revision viewer (card 52). null = showing current state;
  // non-null = showing the file as it stood after the named edit landed.
  // State is initialized from the URL and re-synced on hashchange so
  // back/forward navigation flips revisions correctly.
  const [revisionEditId, setRevisionEditIdState] = useState<string | null>(() => readRevFromHash());
  useEffect(() => {
    const onHash = () => setRevisionEditIdState(readRevFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setRevisionEditId = (next: string | null) => {
    writeRevToHash(next);
    // hashchange will drive setRevisionEditIdState; no double-write needed.
  };

  const url = useMemo(() => {
    const base = `/api/blame?workspace=${encodeURIComponent(workspace)}&file=${encodeURIComponent(file)}`;
    return revisionEditId ? `${base}&edit=${encodeURIComponent(revisionEditId)}` : base;
  }, [workspace, file, revisionEditId]);
  const { data, error } = usePoll<BlameResp>(url, 10_000);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [hoverTurn] = useState<string | null>(null);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Revisions popover: hover gives a temporary line-preview highlight over
  // the blame table. Click (see `handleRevisionSelect` below) now switches
  // the whole page into that revision's historical view via the URL query,
  // so there's no separate `selectedEditId` anymore — the data itself is
  // already scoped to that revision.
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [hoveredEditId, setHoveredEditId] = useState<string | null>(null);

  const { sessionOrder, turnsById, blameByLine, codeLines, chainBroken } = useMemo(() => {
    const order = new Map<string, number>();
    // Seed session order from the blame row order so early appearances get
    // the default blue accent (the "primary" AI timeline).
    for (const b of data?.blame ?? []) sessionColor(b.session_id, order);
    const byId = new Map<string, BlameTurn>();
    for (const t of data?.turns ?? []) byId.set(t.id, t);
    const byLine = new Map<number, BlameRow>();
    for (const b of data?.blame ?? []) byLine.set(b.line_no, b);
    const lines = (data?.content ?? '').split('\n');
    const cb = new Set(data?.chain_broken_edit_ids ?? []);
    return {
      sessionOrder: order,
      turnsById: byId,
      blameByLine: byLine,
      codeLines: lines,
      chainBroken: cb,
    };
  }, [data]);

  if (error) {
    return (
      <div className={styles.main}>
        <EmptyState icon={AlertCircle} title={t('blame.failedToLoad')} subtitle={error.message} />
      </div>
    );
  }

  const lineCount = codeLines.length;
  const selectedRow = selectedLine != null ? blameByLine.get(selectedLine) : null;
  const selectedTurn = selectedRow ? (turnsById.get(selectedRow.turn_id) ?? null) : null;
  const selectedEdits = selectedTurn
    ? (data?.edits ?? []).filter((e) => e.turn_id === selectedTurn.id)
    : [];

  // In-file search. Since the table is virtualized, native Ctrl+F only
  // matches visible rows — card 30's known trade-off. This re-implements
  // find with scroll-to-match so "next/prev" jumps through all matches.
  const matchLines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < codeLines.length; i++) {
      const line = codeLines[i];
      if (line?.toLowerCase().includes(q)) out.push(i + 1);
    }
    return out;
  }, [searchQuery, codeLines]);
  const matchSet = useMemo(() => new Set(matchLines), [matchLines]);
  const activeMatch =
    matchLines.length > 0 ? (matchLines[matchIdx % matchLines.length] ?? null) : null;

  // Clamp matchIdx when the match count changes (e.g. user edits query).
  // Otherwise matchIdx can exceed matches.length and activeMatch stays on
  // a stale position.
  useEffect(() => {
    if (matchIdx >= matchLines.length) setMatchIdx(0);
  }, [matchLines.length, matchIdx]);

  // Ctrl/Cmd+F focuses the in-file search and preempts the browser's
  // native find (which can't see virtualized rows anyway).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'f' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (k === 'escape' && document.activeElement === searchInputRef.current) {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nextMatch = () =>
    setMatchIdx((i) => (matchLines.length > 0 ? (i + 1) % matchLines.length : 0));
  const prevMatch = () =>
    setMatchIdx((i) =>
      matchLines.length > 0 ? (i - 1 + matchLines.length) % matchLines.length : 0,
    );

  // Hover highlight only (card 52 retired click-to-persist-highlight). Click
  // in the popover now flips the whole page to a historical view via
  // `setRevisionEditId`, so the on-table attribution is already scoped.
  const revisionHighlightSet = useMemo(() => {
    if (!hoveredEditId) return new Set<number>();
    return new Set(linesForEdit(data?.blame ?? [], hoveredEditId));
  }, [hoveredEditId, data?.blame]);
  // Auto-scroll target: jump to the first line of the just-entered historical
  // revision so the user lands on the relevant change, not at line 1.
  const revisionActiveLine = useMemo(() => {
    if (!revisionEditId) return null;
    const lines = linesForEdit(data?.blame ?? [], revisionEditId).sort((a, b) => a - b);
    return lines[0] ?? null;
  }, [revisionEditId, data?.blame]);

  const handleRevisionSelect = (editId: string) => {
    // Same id clicked twice → back to current. Any other id → switch.
    setRevisionEditId(revisionEditId === editId ? null : editId);
    setRevisionsOpen(false);
  };

  return (
    <div className={styles.outer}>
      <div className={styles.main}>
        <div className={styles.tools}>
          <div className={styles.fileBadge}>
            <FileCode size={14} className={styles.fileIcon} />
            <span>{pathTail(file)}</span>
          </div>
          <span className={styles.meta}>
            {t('blame.statsLine', {
              lines: lineCount,
              edits: (data?.edits ?? []).length,
              sessions: sessionOrder.size,
            })}
          </span>
          <span className={styles.spacer} />
          <div className={styles.searchBox}>
            <Search size={12} />
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) prevMatch();
                  else nextMatch();
                }
              }}
              placeholder={t('blame.searchPlaceholder')}
              spellCheck={false}
              autoComplete="off"
            />
            {searchQuery && (
              <>
                <span className={styles.searchCounter}>
                  {matchLines.length > 0 ? `${matchIdx + 1}/${matchLines.length}` : '0/0'}
                </span>
                <button
                  type="button"
                  className={styles.searchNavBtn}
                  onClick={prevMatch}
                  disabled={matchLines.length === 0}
                  aria-label={t('blame.searchPrev')}
                  title={t('blame.searchPrev')}
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  className={styles.searchNavBtn}
                  onClick={nextMatch}
                  disabled={matchLines.length === 0}
                  aria-label={t('blame.searchNext')}
                  title={t('blame.searchNext')}
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  type="button"
                  className={styles.searchNavBtn}
                  onClick={() => setSearchQuery('')}
                  aria-label={t('common.clear')}
                  title={t('blame.searchClear')}
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
          <div className={styles.revisionsWrap}>
            <button
              type="button"
              className={`${styles.btn} ${revisionsOpen ? styles.btnActive : ''}`}
              onClick={() => setRevisionsOpen((v) => !v)}
              aria-expanded={revisionsOpen}
              title={t('blame.revisionsTip')}
            >
              <History size={12} />
              <span>{t('blame.revisions')}</span>
              {(data?.edits?.length ?? 0) > 0 && (
                <span className={styles.btnBadge}>{data?.edits?.length}</span>
              )}
            </button>
            <RevisionsPopover
              open={revisionsOpen}
              edits={data?.edits ?? []}
              turns={data?.turns ?? []}
              activeEditId={revisionEditId}
              onHover={setHoveredEditId}
              onSelect={handleRevisionSelect}
              onClose={() => setRevisionsOpen(false)}
            />
          </div>
        </div>

        {revisionEditId && (
          <RevisionBanner
            edits={data?.edits ?? []}
            revisionEditId={revisionEditId}
            onBack={() => setRevisionEditId(null)}
          />
        )}

        <HeatStrip blame={data?.blame ?? []} totalLines={lineCount} sessionOrder={sessionOrder} />

        {lineCount === 0 ? (
          <div className={styles.table}>
            <EmptyState
              icon={FileText}
              title={t('blame.noContentTitle')}
              subtitle={t('blame.noContentSub')}
            />
          </div>
        ) : (
          <BlameTable
            codeLines={codeLines}
            blameByLine={blameByLine}
            turnsById={turnsById}
            sessionOrder={sessionOrder}
            chainBroken={chainBroken}
            selectedLine={selectedLine}
            setSelectedLine={setSelectedLine}
            matchSet={matchSet}
            activeMatch={activeMatch}
            revisionSet={revisionHighlightSet}
            revisionActiveLine={revisionActiveLine}
            hoverTurn={hoverTurn}
          />
        )}

        {revertTarget && (
          <RevertModal target={revertTarget} onClose={() => setRevertTarget(null)} />
        )}
      </div>
      <aside className={styles.inspectorPane}>
        <LineInspector
          file={file}
          selectedLine={selectedLine}
          selectedRow={selectedRow ?? null}
          selectedTurn={selectedTurn}
          selectedEdits={selectedEdits}
          onRevert={(target) => setRevertTarget(target)}
        />
      </aside>
    </div>
  );
}

// ----- BlameTable ------------------------------------------------------

interface BlameTableProps {
  codeLines: string[];
  blameByLine: Map<number, BlameRow>;
  turnsById: Map<string, BlameTurn>;
  sessionOrder: Map<string, number>;
  chainBroken: Set<string>;
  selectedLine: number | null;
  setSelectedLine: Dispatch<SetStateAction<number | null>>;
  hoverTurn: string | null;
  // Search: lines that match the query (all highlighted) + the currently
  // focused one (extra-highlighted + scrolled into view). Both can be
  // empty/null when no search is active.
  matchSet: Set<number>;
  activeMatch: number | null;
  // Revisions (card-internal — see RevisionsPopover): lines attributed to
  // the hovered/selected edit get a distinct blue wash. `revisionActiveLine`
  // only fires when the user explicitly clicked a revision (not on hover),
  // so scroll-to-match doesn't feel twitchy.
  revisionSet: Set<number>;
  revisionActiveLine: number | null;
}

// Virtualized blame renderer. Assumes every row is exactly ROW_HEIGHT px
// (matches `.row` in the module CSS). On a 5000-line file we only mount
// ~30 row components, so the first paint and scroll stay snappy.
function BlameTable({
  codeLines,
  blameByLine,
  turnsById,
  sessionOrder,
  chainBroken,
  selectedLine,
  setSelectedLine,
  hoverTurn,
  matchSet,
  activeMatch,
  revisionSet,
  revisionActiveLine,
}: BlameTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalRows = codeLines.length;
  const { startIndex, endIndex } = useVirtualRows({
    scrollRef,
    totalRows,
    rowHeight: ROW_HEIGHT,
    buffer: 10,
  });

  // Scroll the active match into view (roughly centered). Only adjusts
  // scrollTop when the match is NOT already fully in the viewport, so
  // clicking "next" within a visible cluster doesn't cause a yank. Used
  // by both the search navigator and the revisions popover (via
  // `revisionActiveLine`), hence the helper.
  const scrollIntoView = (lineNo: number | null) => {
    if (lineNo == null) return;
    const el = scrollRef.current;
    if (!el) return;
    const top = (lineNo - 1) * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    if (top < viewTop || bottom > viewBottom) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2 + ROW_HEIGHT / 2);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollIntoView closes over the ref, which is stable
  useEffect(() => scrollIntoView(activeMatch), [activeMatch]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollIntoView closes over the ref, which is stable
  useEffect(() => scrollIntoView(revisionActiveLine), [revisionActiveLine]);

  const rows: React.ReactNode[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const code = codeLines[i] ?? '';
    const lineNo = i + 1;
    const row = blameByLine.get(lineNo);
    const color = row ? sessionColor(row.session_id, sessionOrder) : 'var(--bg-2)';
    const isBroken = row ? chainBroken.has(row.edit_id) : false;
    const isSelected = selectedLine === lineNo;
    const isSameTurn = hoverTurn != null && row != null && row.turn_id === hoverTurn && !isSelected;
    const isMatch = matchSet.has(lineNo);
    const isActiveMatch = activeMatch === lineNo;
    const isRevision = revisionSet.has(lineNo);
    const isRevisionActive = revisionActiveLine === lineNo;
    const turn = row ? turnsById.get(row.turn_id) : null;
    rows.push(
      <ClickRow
        key={lineNo}
        className={`${styles.row} ${isSelected ? styles.rowSelected : ''} ${isSameTurn ? styles.rowSameTurn : ''} ${isMatch ? styles.rowMatch : ''} ${isActiveMatch ? styles.rowActiveMatch : ''} ${isRevision ? styles.rowRevision : ''} ${isRevisionActive ? styles.rowRevisionActive : ''}`}
        onClick={() => setSelectedLine(lineNo === selectedLine ? null : lineNo)}
        selected={isSelected}
      >
        <span className={`${styles.ln} ${isSelected ? styles.lnSelected : ''}`}>{lineNo}</span>
        <span className={styles.bar} style={{ background: isBroken ? 'var(--danger)' : color }} />
        <span className={styles.turn} style={{ color: isBroken ? 'var(--danger)' : color }}>
          {row ? ` ${row.session_id.slice(0, 6)}·#${turn?.idx ?? '?'} ` : ''}
        </span>
        <span className={`${styles.code} ${!row ? styles.codeUser : ''}`}>{code || ' '}</span>
      </ClickRow>,
    );
  }

  return (
    <div ref={scrollRef} className={styles.table}>
      <div
        className={styles.vSpacer}
        style={{ height: totalRows * ROW_HEIGHT, position: 'relative' }}
      >
        <div
          className={styles.vSlice}
          style={{
            position: 'absolute',
            top: startIndex * ROW_HEIGHT,
            left: 0,
            right: 0,
          }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}

// ----- LineInspector ---------------------------------------------------

interface LineInspectorProps {
  file: string;
  selectedLine: number | null;
  selectedRow: BlameRow | null;
  selectedTurn: BlameTurn | null;
  selectedEdits: BlameEdit[];
  onRevert: (target: RevertTarget) => void;
}

function LineInspector({
  file,
  selectedLine,
  selectedRow,
  selectedTurn,
  selectedEdits,
  onRevert,
}: LineInspectorProps) {
  const { t } = useLang();
  if (selectedLine == null || !selectedRow || !selectedTurn) {
    return (
      <Inspector
        title={t('blame.inspector.title')}
        body={
          <div
            style={{
              padding: 16,
              color: 'var(--text-1)',
              fontSize: 12,
              lineHeight: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div>
              <Undo2 size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
              {t('blame.inspector.selectHint')}
            </div>
            <Section label={t('blame.inspector.file')} mono>
              {file}
            </Section>
          </div>
        }
      />
    );
  }

  return (
    <Inspector
      title={
        <span>
          {t('blame.inspector.lineTurnTitle', { line: selectedLine, turnIdx: selectedTurn.idx })}
        </span>
      }
      body={
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                background: 'var(--bg-2)',
                padding: '2px 6px',
                borderRadius: 3,
                color: 'var(--text-1)',
              }}
            >
              {selectedRow.session_id.slice(0, 8)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-2)' }}>
              turn #{selectedTurn.idx} · {selectedRow.tool_name ?? 'edit'}
            </span>
          </div>
          <Section label={t('blame.inspector.prompt')}>
            {selectedTurn.user_prompt || t('sessionOverview.noPrompt')}
          </Section>
          {selectedTurn.agent_reasoning && (
            <Section label={t('blame.inspector.reasoning')} muted>
              {selectedTurn.agent_reasoning}
            </Section>
          )}
          {selectedTurn.agent_final_message && (
            <Section label={t('blame.inspector.finalMessage')} muted>
              {selectedTurn.agent_final_message}
            </Section>
          )}
          {selectedRow.tool_call_explanation && (
            <Section label={t('blame.inspector.explanation')} muted>
              {selectedRow.tool_call_explanation}
            </Section>
          )}
          <div>
            <SectionLabel>
              {t('blame.inspector.editsInTurn', { n: selectedEdits.length })}
            </SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {selectedEdits.map((e) => (
                <div
                  key={e.id}
                  style={{
                    padding: '4px 8px',
                    background: 'var(--bg-2)',
                    borderRadius: 3,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-0)',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span
                    style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {e.id}
                  </span>
                  <span style={{ color: 'var(--text-2)' }}>{e.hunk_count} hunk</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => onRevert({ kind: 'turn', id: selectedTurn.id })}
              style={{
                padding: '6px 12px',
                background: 'var(--accent)',
                color: '#0d1117',
                fontWeight: 500,
                fontSize: 11,
                border: 0,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              <Undo2 size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
              {t('blame.inspector.revertTurn')}
            </button>
            <button
              type="button"
              onClick={() => onRevert({ kind: 'edit', id: selectedRow.edit_id })}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                color: 'var(--text-0)',
                fontSize: 11,
                border: '1px solid var(--border)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t('blame.inspector.revertEdit')}
            </button>
          </div>
        </div>
      }
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.8,
        color: 'var(--text-2)',
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function Section({
  label,
  muted,
  mono,
  children,
}: {
  label: string;
  muted?: boolean;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div
        style={{
          fontSize: 12,
          color: muted ? 'var(--text-1)' : 'var(--text-0)',
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ----- HeatStrip -------------------------------------------------------

interface HeatStripProps {
  blame: BlameRow[];
  totalLines: number;
  sessionOrder: Map<string, number>;
}

// 30-segment color bar summarising the blame chain. Each segment's color
// is the session that owns the majority of lines in that range.
function HeatStrip({ blame, totalLines, sessionOrder }: HeatStripProps) {
  if (totalLines === 0) return <div className={styles.heatStrip} />;
  const SEGMENTS = 30;
  const linesPerSeg = Math.max(1, Math.ceil(totalLines / SEGMENTS));

  const segments: string[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    const start = s * linesPerSeg + 1;
    const end = Math.min(totalLines, start + linesPerSeg - 1);
    const bySession = new Map<string, number>();
    for (const b of blame) {
      if (b.line_no >= start && b.line_no <= end) {
        bySession.set(b.session_id, (bySession.get(b.session_id) ?? 0) + 1);
      }
    }
    let dominant: string | null = null;
    let max = 0;
    for (const [sid, n] of bySession) {
      if (n > max) {
        max = n;
        dominant = sid;
      }
    }
    segments.push(dominant ? sessionColor(dominant, sessionOrder) : 'var(--bg-2)');
  }
  return (
    <div className={styles.heatStrip}>
      {segments.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segment index is stable
        <div key={i} className={styles.heatSeg} style={{ background: c }} />
      ))}
    </div>
  );
}

interface RevisionBannerProps {
  edits: BlameEdit[];
  revisionEditId: string;
  onBack: () => void;
}

// Narrow call-out above the blame table when viewing a historical revision
// (card 52). Shows when the revision landed + its position in the chain so
// the user always knows "I'm not on current". Non-blocking — Revert, search,
// and line selection still work on the displayed (historical) state.
function RevisionBanner({ edits, revisionEditId, onBack }: RevisionBannerProps) {
  const { t } = useLang();
  const idx = edits.findIndex((e) => e.id === revisionEditId);
  // If the revision id in the URL doesn't match any edit in the current
  // response (e.g. mid-poll race, invalid deep-link), show a minimal banner
  // without the "N of M" meta — the underlying API already returned an
  // empty payload in that case.
  const total = edits.length;
  const current = idx >= 0 ? edits[idx] : undefined;
  const when = current ? new Date(current.created_at).toLocaleString() : t('common.none');
  return (
    <div className={styles.revisionBanner}>
      <Clock size={12} className={styles.revisionBannerIcon} />
      <span className={styles.revisionBannerText}>
        {idx >= 0
          ? t('blame.viewingRevision', { when, n: idx + 1, total })
          : t('blame.viewingRevisionUnknown')}
      </span>
      <span className={styles.revisionBannerSpacer} />
      <button type="button" className={styles.revisionBannerBtn} onClick={onBack}>
        → {t('blame.backToCurrent')}
      </button>
    </div>
  );
}
