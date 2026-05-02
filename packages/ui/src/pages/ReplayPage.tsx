import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileCode,
  Film,
  Play,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePoll } from '../api';
import { EmptyState } from '../components/EmptyState';
import { Hunk } from '../components/Hunk';
import { RevertModal, type RevertTarget } from '../features/revert/RevertModal';
import { type ReplayStep, flattenReplaySteps } from '../features/session/flattenReplaySteps';
import type { ReviewResp } from '../features/session/types';
import { useLang } from '../i18n';
import { Inspector } from '../layout/Inspector';
import styles from './ReplayPage.module.css';

export interface ReplayPageProps {
  workspace: string;
  session: string;
}

export function ReplayPage({ workspace, session }: ReplayPageProps) {
  void workspace;
  const { t } = useLang();
  const url = `/api/review?session=${encodeURIComponent(session)}`;
  const { data, error } = usePoll<ReviewResp>(url, 10_000);
  const steps = useMemo(() => flattenReplaySteps(data?.turns ?? []), [data]);
  const [stepIdx, setStepIdx] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);

  // Clamp stepIdx whenever the step count changes (e.g. new turn arrives during polling).
  useEffect(() => {
    if (steps.length === 0) {
      setStepIdx(0);
      return;
    }
    if (stepIdx >= steps.length) setStepIdx(steps.length - 1);
  }, [steps.length, stepIdx]);

  // Keyboard shortcuts: ←/→/Home/End + Space toggles autoplay. Mirrors the
  // shortcuts the vanilla Replay had, now with proper React cleanup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea (shouldn't happen on this
      // page but future-proof).
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/i.test(target.tagName)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setStepIdx((i) => Math.min(steps.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStepIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setStepIdx(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setStepIdx(Math.max(0, steps.length - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setAutoplay((a) => !a);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps.length]);

  // Autoplay: advance one step per second; stops when we hit the end.
  useEffect(() => {
    if (!autoplay || steps.length === 0) return;
    const t = setInterval(() => {
      setStepIdx((i) => {
        if (i >= steps.length - 1) {
          setAutoplay(false);
          return i;
        }
        return i + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [autoplay, steps.length]);

  if (error) {
    return (
      <EmptyState icon={AlertCircle} title={t('replay.failedToLoad')} subtitle={error.message} />
    );
  }
  if (steps.length === 0) {
    return (
      <EmptyState icon={Film} title={t('replay.noStepsTitle')} subtitle={t('replay.noStepsSub')} />
    );
  }

  const step = steps[stepIdx] ?? steps[0];
  if (!step) return null;
  const prev = stepIdx > 0 ? steps[stepIdx - 1] : null;
  const next = stepIdx < steps.length - 1 ? steps[stepIdx + 1] : null;
  const inTurnSteps = steps.filter((s) => s.turn.idx === step.turn.idx);
  const inTurnIdx = inTurnSteps.indexOf(step);

  return (
    <div className={styles.outer}>
      <ScrubberStrip
        steps={steps}
        stepIdx={stepIdx}
        onSelect={setStepIdx}
        autoplay={autoplay}
        onToggleAutoplay={() => setAutoplay((a) => !a)}
      />

      <div className={styles.body}>
        <div className={styles.main}>
          <StepCard
            step={step}
            stepIdx={stepIdx}
            totalSteps={steps.length}
            inTurnIdx={inTurnIdx}
            inTurnTotal={inTurnSteps.length}
            onRevert={(target) => setRevertTarget(target)}
          />
        </div>
        <aside className={styles.inspectorPane}>
          <StepInspector
            step={step}
            prev={prev ?? null}
            next={next ?? null}
            prevIdx={stepIdx - 1}
            nextIdx={stepIdx + 1}
          />
        </aside>
      </div>

      {revertTarget && <RevertModal target={revertTarget} onClose={() => setRevertTarget(null)} />}
    </div>
  );
}

// ----- Scrubber --------------------------------------------------------

interface ScrubberStripProps {
  steps: ReplayStep[];
  stepIdx: number;
  onSelect: (i: number) => void;
  autoplay: boolean;
  onToggleAutoplay: () => void;
}

function ScrubberStrip({
  steps,
  stepIdx,
  onSelect,
  autoplay,
  onToggleAutoplay,
}: ScrubberStripProps) {
  const { t } = useLang();
  const step = steps[stepIdx] ?? steps[0];
  if (!step) return null;
  const inTurnSteps = steps.filter((s) => s.turn.idx === step.turn.idx);
  const inTurnIdx = inTurnSteps.indexOf(step);

  return (
    <div className={styles.scrubWrap}>
      <div className={styles.scrubHdr}>
        <span className={styles.scrubTitle}>{t('replay.sessionTimeline')}</span>
        <span className={styles.scrubMeta}>
          {t('replay.scrubMeta', { idx: stepIdx + 1, total: steps.length, turn: step.turn.idx })}
          {!step.empty
            ? ` ${t('replay.toolCallCounter', { i: inTurnIdx + 1, total: inTurnSteps.length })}`
            : ''}
        </span>
        <span className={styles.scrubSpacer} />
        <div className={styles.scrubCtrls}>
          <button
            type="button"
            className={styles.ctrlBtn}
            disabled={stepIdx === 0}
            onClick={() => onSelect(0)}
            title={t('replay.home')}
          >
            <ChevronsLeft size={13} />
          </button>
          <button
            type="button"
            className={styles.ctrlBtn}
            disabled={stepIdx === 0}
            onClick={() => onSelect(stepIdx - 1)}
            title={t('replay.prev')}
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            className={`${styles.ctrlBtn} ${styles.ctrlBtnPrimary}`}
            disabled={stepIdx >= steps.length - 1}
            onClick={() => onSelect(stepIdx + 1)}
            title={t('replay.next')}
          >
            <ChevronRight size={13} />
          </button>
          <button
            type="button"
            className={styles.ctrlBtn}
            disabled={stepIdx >= steps.length - 1}
            onClick={() => onSelect(steps.length - 1)}
            title={t('replay.end')}
          >
            <ChevronsRight size={13} />
          </button>
          <button
            type="button"
            className={styles.ctrlBtn}
            onClick={onToggleAutoplay}
            title={t('replay.autoplayTip')}
            style={autoplay ? { background: 'var(--accent)', color: '#0d1117' } : undefined}
          >
            <Play size={13} />
          </button>
          <span className={styles.kbHint}>{t('replay.kbHint')}</span>
        </div>
      </div>
      <div className={styles.track}>
        {steps.map((s, i) => {
          const isCurrent = i === stepIdx;
          const hasDanger = s.turn.badges.some((b) => b.level === 'danger');
          const hasChange = !s.empty;
          return (
            <button
              type="button"
              // biome-ignore lint/suspicious/noArrayIndexKey: step order is stable for this session
              key={i}
              className={`${styles.dot} ${hasChange ? styles.dotHasChange : ''} ${hasDanger ? styles.dotDanger : ''} ${isCurrent ? styles.dotCurrent : ''}`}
              onClick={() => onSelect(i)}
              title={`step ${i + 1} · turn #${s.turn.idx}${s.tool_name ? ` · ${s.tool_name}` : ''}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ----- StepCard --------------------------------------------------------

function StepCard({
  step,
  stepIdx,
  totalSteps,
  inTurnIdx,
  inTurnTotal,
  onRevert,
}: {
  step: ReplayStep;
  stepIdx: number;
  totalSteps: number;
  inTurnIdx: number;
  inTurnTotal: number;
  onRevert: (target: RevertTarget) => void;
}) {
  const { t } = useLang();
  return (
    <section className={styles.stepCard}>
      <div className={styles.stepHdr}>
        <span className={`${styles.stepBadge} ${styles.stepBadgeTurn}`}>turn #{step.turn.idx}</span>
        {step.tool_name && (
          <span className={`${styles.stepBadge} ${styles.stepBadgeTool}`}>{step.tool_name}</span>
        )}
        <span className={styles.stepCounter}>
          {step.empty
            ? t('replay.emptyTurn')
            : t('replay.stepCounter', {
                i: inTurnIdx + 1,
                total: inTurnTotal,
                step: stepIdx + 1,
                stepTotal: totalSteps,
              })}
        </span>
        <span className={styles.stepSpacer} />
        <button
          type="button"
          className={styles.btn}
          onClick={() => onRevert({ kind: 'turn', id: step.turn.id })}
        >
          <Undo2 size={12} />
          <span>{t('replay.revertTurn')}</span>
        </button>
      </div>

      <p className={styles.stepPrompt}>
        "{step.turn.user_prompt || t('sessionOverview.noPrompt')}"
      </p>

      {step.empty && step.turn.agent_final_message && (
        <div className={styles.stepExp}>
          <span className={styles.stepExpBar} />
          <div className={styles.stepExpBody}>
            <span className={styles.stepExpL}>{t('blame.inspector.finalMessage')}</span>
            <span className={styles.stepExpT}>{step.turn.agent_final_message}</span>
          </div>
        </div>
      )}

      {step.explanation ? (
        <div className={styles.stepExp}>
          <span className={styles.stepExpBar} />
          <div className={styles.stepExpBody}>
            <span className={styles.stepExpL}>{t('replay.explanationHdr')}</span>
            <span className={styles.stepExpT}>{step.explanation}</span>
          </div>
        </div>
      ) : !step.empty ? (
        <span className="muted" style={{ fontSize: 11 }}>
          {t('replay.noExplanation')}
        </span>
      ) : null}

      {step.edits.map((e) => (
        <div key={e.id}>
          <div className={styles.editHdr}>
            <FileCode size={12} className={styles.editIcon} />
            <span className={styles.editFile}>{e.file_path}</span>
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

// ----- StepInspector ---------------------------------------------------

function StepInspector({
  step,
  prev,
  next,
  prevIdx,
  nextIdx,
}: {
  step: ReplayStep;
  prev: ReplayStep | null;
  next: ReplayStep | null;
  prevIdx: number;
  nextIdx: number;
}) {
  const { t } = useLang();
  const turnSoFar = step.turn.edits;

  return (
    <Inspector
      title={t('replay.stepContext')}
      body={
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {prev && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                background: 'var(--bg-2)',
                borderRadius: 4,
              }}
            >
              <ChevronLeft size={12} color="var(--text-2)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: 0.8,
                    color: 'var(--text-2)',
                  }}
                >
                  {t('replay.prevStep', { idx: prevIdx + 1 })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-0)' }}>
                  {prev.empty
                    ? t('replay.emptyTurnLabel', { idx: prev.turn.idx })
                    : (prev.tool_name ?? t('replay.toolCall'))}
                </div>
              </div>
            </div>
          )}
          {next && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                background: 'rgba(88, 166, 255, 0.08)',
                border: '1px solid var(--accent)',
                borderRadius: 4,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: 0.8,
                    color: 'var(--accent)',
                  }}
                >
                  {t('replay.nextStep', { idx: nextIdx + 1 })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-0)' }}>
                  {next.empty
                    ? t('replay.emptyTurnLabel', { idx: next.turn.idx })
                    : (next.tool_name ?? t('replay.toolCall'))}
                </div>
              </div>
              <ChevronRight size={12} color="var(--accent)" />
            </div>
          )}
          {step.turn.agent_reasoning && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 0.8,
                  color: 'var(--text-2)',
                }}
              >
                {t('replay.agentThinking')}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-1)',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {step.turn.agent_reasoning}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.8,
                color: 'var(--text-2)',
              }}
            >
              {t('replay.turnSoFar', { n: turnSoFar.length })}
            </div>
            {turnSoFar.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 0',
                }}
              >
                <FileCode size={11} color="var(--accent)" />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-0)',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={e.file_path}
                >
                  {e.file_path.split(/[\\/]/).slice(-1)[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      }
    />
  );
}
