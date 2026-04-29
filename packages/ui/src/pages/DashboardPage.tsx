import { Activity, BarChart3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePoll } from '../api';
import { Card } from '../components/Card';
import { ClickRow } from '../components/ClickRow';
import { DropdownPicker } from '../components/DropdownPicker';
import { EmptyState } from '../components/EmptyState';
import { useLang } from '../i18n';
import { hrefFor, navigate } from '../router';
import styles from './DashboardPage.module.css';

// Valid values for the Dashboard activity window — matches the collector's
// DashboardRange. `label` is shown in the dropdown; `short` in the chip.
type DashboardRange = 'today' | 'week' | '30d' | 'year';
// Labels sourced from the i18n dictionary at render time — see RANGE_KEYS.
// Keeping an ordered array here (value-only) avoids reading `t()` at module
// scope where lang isn't yet resolved under SSR/HMR.
const RANGE_KEYS: ReadonlyArray<{
  value: DashboardRange;
  label:
    | 'dashboard.rangeToday'
    | 'dashboard.rangeWeek'
    | 'dashboard.range30d'
    | 'dashboard.rangeYear';
}> = [
  { value: 'today', label: 'dashboard.rangeToday' },
  { value: 'week', label: 'dashboard.rangeWeek' },
  { value: '30d', label: 'dashboard.range30d' },
  { value: 'year', label: 'dashboard.rangeYear' },
];
const RANGE_STORAGE_KEY = 'minspect.dashboard.range';

function readInitialRange(): DashboardRange {
  if (typeof window === 'undefined') return '30d';
  try {
    const stored = window.localStorage.getItem(RANGE_STORAGE_KEY);
    if (stored && RANGE_KEYS.some((o) => o.value === stored)) return stored as DashboardRange;
  } catch {
    /* blocked */
  }
  return '30d';
}

interface DashboardResp {
  activity: Array<{ day: string; edits: number }>;
  activity_total: number;
  delta_pct: number | null;
  top_workspaces: Array<{ path: string; edits: number }>;
  top_agents: Array<{ agent: string; sessions: number; pct: number }>;
  alerts: Array<{ level: 'info' | 'warn' | 'danger'; label: string; count: number }>;
  recent: Array<{
    kind: 'session_start' | 'tool_call';
    timestamp: number;
    agent: string;
    session_id: string;
    workspace_id: string;
    tool_name: string | null;
  }>;
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function pathTail(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// Maps an agent name to its timeline dot colour. codex gets violet, Claude
// Code gets the default accent — consistent with the Pencil palette.
function kindClass(kind: 'session_start' | 'tool_call', agent: string): string {
  if (agent === 'codex') return styles.feedKindCodex;
  return kind === 'session_start' ? styles.feedKindSess : styles.feedKindTool;
}

export function DashboardPage() {
  const { t } = useLang();
  const [range, setRange] = useState<DashboardRange>(readInitialRange);
  useEffect(() => {
    try {
      window.localStorage.setItem(RANGE_STORAGE_KEY, range);
    } catch {
      /* blocked */
    }
  }, [range]);
  const { data, error } = usePoll<DashboardResp>(`/api/dashboard?range=${range}`, 5000);

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.hdr}>
          <h1 className={styles.title}>{t('dashboard.title')}</h1>
        </div>
        <p style={{ color: 'var(--danger)' }}>
          {t('status.failedToLoadInline', { msg: error.message })}
        </p>
      </div>
    );
  }

  const activity = data?.activity ?? [];
  const maxEdits = Math.max(1, ...activity.map((a) => a.edits));

  return (
    <div className={styles.page}>
      <div className={styles.hdr}>
        <h1 className={styles.title}>{t('dashboard.title')}</h1>
        <span className={styles.spacer} />
        <DropdownPicker
          value={range}
          options={RANGE_KEYS.map((o) => ({ value: o.value, label: t(o.label) }))}
          onChange={setRange}
          ariaLabel={t('dashboard.selectRange')}
        />
      </div>

      <Card>
        <div className={styles.activity}>
          <div className={styles.actHdr}>
            <span className={styles.actTitle}>{t('dashboard.activity')}</span>
            <span className={styles.actBig}>{data?.activity_total ?? 0}</span>
            <span className={styles.actUnit}>{t('dashboard.edits')}</span>
            <DeltaTag pct={data?.delta_pct ?? null} />
            <span className={styles.actLegend}>{unitLabel(range, t)}</span>
          </div>
          <ActivityChart activity={activity} range={range} maxEdits={maxEdits} />
        </div>
      </Card>

      <div className={styles.row3}>
        <Card title={t('dashboard.topWorkspaces')}>
          <div className={styles.miniList}>
            {(data?.top_workspaces ?? []).map((w, i) => {
              const topEdits = data?.top_workspaces[0]?.edits ?? 1;
              const pct = Math.round((w.edits / topEdits) * 100);
              return (
                <div key={w.path} className={styles.miniRow}>
                  <div className={styles.miniHdr}>
                    <span className={i === 0 ? styles.miniName : styles.miniNameDim}>
                      {pathTail(w.path)}
                    </span>
                    <span className={styles.miniVal}>{w.edits}</span>
                  </div>
                  <div className={styles.miniBar}>
                    <div
                      className={styles.miniBarFill}
                      style={{ width: `${pct}%`, opacity: i === 0 ? 1 : 0.7 - i * 0.1 }}
                    />
                  </div>
                </div>
              );
            })}
            {(data?.top_workspaces.length ?? 0) === 0 && (
              <EmptyState icon={BarChart3} compact title={t('dashboard.noActivity')} />
            )}
          </div>
        </Card>

        <Card title={t('dashboard.topAgents')}>
          <div className={styles.miniList}>
            {(data?.top_agents ?? []).map((a, i) => (
              <div key={a.agent} className={styles.miniRow}>
                <div className={styles.miniHdr}>
                  <span className={i === 0 ? styles.miniName : styles.miniNameDim}>{a.agent}</span>
                  <span className={styles.miniVal}>{Math.round(a.pct)}%</span>
                  <span className={styles.miniPct}>({a.sessions})</span>
                </div>
                <div className={styles.miniBar}>
                  <div
                    className={`${styles.miniBarFill} ${a.agent === 'codex' ? styles.miniBarAgent : ''}`}
                    style={{ width: `${a.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('dashboard.alerts')} meta={String(data?.alerts.length ?? 0)}>
          <div className={styles.alertList}>
            {(data?.alerts ?? []).slice(0, 4).map((a) => (
              <div key={`${a.level}:${a.label}`} className={styles.alertRow}>
                <span
                  className={styles.alertBar}
                  style={{ background: `var(--${a.level === 'danger' ? 'danger' : 'warn'})` }}
                />
                <div className={styles.alertBody}>
                  <span className={styles.alertTitle}>
                    {a.count} {a.label}
                  </span>
                  <span className={styles.alertSub}>
                    {t('dashboard.alertSub', { level: a.level })}
                  </span>
                </div>
              </div>
            ))}
            {(data?.alerts.length ?? 0) === 0 && (
              <p className="muted" style={{ fontSize: 12 }}>
                {t('dashboard.noAlerts')}
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card title={t('dashboard.recentActivity')}>
        <div className={styles.feed} style={{ margin: 'calc(-1 * var(--sp-4))' }}>
          {(data?.recent ?? []).slice(0, 10).map((r, i) => (
            <ClickRow
              key={`${r.kind}-${r.session_id}-${r.timestamp}-${i}`}
              className={styles.feedRow}
              onClick={() =>
                navigate(
                  hrefFor({
                    kind: 'session',
                    workspace: r.workspace_id,
                    session: r.session_id,
                    tab: 'overview',
                  }),
                )
              }
            >
              <span className={styles.feedTime}>{hhmm(r.timestamp)}</span>
              <span className={kindClass(r.kind, r.agent)}>
                {r.kind === 'session_start' ? 'session_start' : `tool_call ${r.tool_name ?? ''}`}
              </span>
              <span className={styles.feedAgent}>{r.agent}</span>
              <span className={styles.feedSess}>{r.session_id.slice(0, 8)}</span>
              <span className={styles.feedDetail}>{r.workspace_id}</span>
              <span className={styles.feedWs}>{pathTail(r.workspace_id)}</span>
            </ClickRow>
          ))}
          {(data?.recent.length ?? 0) === 0 && (
            <EmptyState
              icon={Activity}
              compact
              title={t('dashboard.noActivity')}
              subtitle={t('dashboard.noActivitySub')}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

// Human-readable label for a bucket key. The bucket shape depends on
// range: "YYYY-MM-DD HH" (today) / "YYYY-MM-DD" (week, 30d) / "YYYY-MM"
// (year). We format appropriately so the tooltip reads naturally.
function formatBucket(key: string, range: DashboardRange): string {
  if (range === 'today') {
    const hh = key.slice(11, 13);
    return `${hh}:00`;
  }
  if (range === 'year') {
    // "2026-04" → "Apr 2026"
    const [y, m] = key.split('-');
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const idx = Math.max(0, Math.min(11, Number.parseInt(m ?? '1', 10) - 1));
    return `${monthNames[idx]} ${y}`;
  }
  // week / 30d → daily "YYYY-MM-DD" → "Apr 29"
  const [_y, m, d] = key.split('-');
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const idx = Math.max(0, Math.min(11, Number.parseInt(m ?? '1', 10) - 1));
  return `${monthNames[idx]} ${Number.parseInt(d ?? '1', 10)}`;
}

// Legend shown next to the activity big number. Varies with range so the
// user knows the chart granularity without mousing over a bar.
function unitLabel(
  range: DashboardRange,
  t: (k: 'dashboard.unitHour' | 'dashboard.unitDay' | 'dashboard.unitMonth') => string,
): string {
  if (range === 'today') return t('dashboard.unitHour');
  if (range === 'year') return t('dashboard.unitMonth');
  return t('dashboard.unitDay');
}

// Activity sparkline with a lightweight y-axis (3 ticks: 0 / mid / max) and
// a hover tooltip per bar. Replaces the title-attribute-only bars; those
// had the right data but native tooltips are slow and easy to miss.
function ActivityChart({
  activity,
  range,
  maxEdits,
}: {
  activity: Array<{ day: string; edits: number }>;
  range: DashboardRange;
  maxEdits: number;
}) {
  const { t } = useLang();
  const [hoverIdx, setHoverIdx] = useState(-1);
  // 3-tick scale: top = max, middle = ceil(max/2), bottom = 0. Hide the
  // middle when max is tiny (≤ 2) to avoid duplicated labels like "1 / 1 / 0".
  const showMid = maxEdits > 2;
  const midLabel = Math.ceil(maxEdits / 2);

  return (
    <div className={styles.chartWrap}>
      <div className={styles.yAxis}>
        <span className={styles.yTick}>{maxEdits}</span>
        {showMid && <span className={styles.yTick}>{midLabel}</span>}
        <span className={styles.yTick}>0</span>
      </div>
      <div className={styles.chartBody}>
        {activity.map((a, i) => {
          const heightPct = maxEdits > 0 ? (a.edits / maxEdits) * 100 : 0;
          const showBar = a.edits > 0;
          return (
            <button
              type="button"
              key={a.day}
              className={styles.barCol}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(-1)}
              onFocus={() => setHoverIdx(i)}
              onBlur={() => setHoverIdx(-1)}
              aria-label={`${formatBucket(a.day, range)}: ${t('dashboard.tooltipEdits', { n: a.edits })}`}
            >
              {showBar ? (
                <div
                  className={`${styles.bar} ${hoverIdx === i ? styles.barHover : ''}`}
                  style={{
                    height: `${Math.max(4, heightPct)}%`,
                    opacity: a.edits >= maxEdits * 0.7 ? 1 : 0.6,
                  }}
                />
              ) : (
                <div
                  className={`${styles.barEmpty} ${hoverIdx === i ? styles.barEmptyHover : ''}`}
                />
              )}
              {hoverIdx === i && (
                <div
                  className={`${styles.tooltip} ${
                    i < 2 ? styles.tooltipLeft : i > activity.length - 3 ? styles.tooltipRight : ''
                  }`}
                  role="tooltip"
                >
                  <span className={styles.tooltipDate}>{formatBucket(a.day, range)}</span>
                  <span className={styles.tooltipCount}>
                    {t('dashboard.tooltipEdits', { n: a.edits })}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DeltaTag({ pct }: { pct: number | null }) {
  if (pct == null) return <span className={`${styles.actDelta} ${styles.deltaNone}`}>—</span>;
  if (pct >= 0)
    return <span className={`${styles.actDelta} ${styles.deltaUp}`}>▲ {pct.toFixed(0)}%</span>;
  return (
    <span className={`${styles.actDelta} ${styles.deltaDown}`}>▼ {Math.abs(pct).toFixed(0)}%</span>
  );
}
