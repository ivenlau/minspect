// Source-of-truth translation table. One row per user-visible string.
// Adding a new key here is the single step needed to ship a new translated
// phrase — TypeScript + the drift test in `i18n.test.ts` ensure every key
// has both `en` and `zh` values.
//
// Term conventions chosen for zh (pragmatic, not poetic):
//   turn       → 轮次
//   edit       → 编辑
//   session    → 会话
//   workspace  → 工作区
//   tool call  → 工具调用
//   agent      → 代理
//   revert     → 回滚
//   hunk       → 片段
//   blame      → 追溯 (git-blame sense; "blame 追溯" doubled in headings)

type VarBag = Record<string, unknown>;
type StringValue = string | ((vars: VarBag) => string);

export interface StringEntry {
  en: StringValue;
  zh: StringValue;
}

// Build the table with an assertion helper that infers key literals but
// still enforces the {en, zh} shape.
function tbl<T extends Record<string, StringEntry>>(rows: T): T {
  return rows;
}

export const STRINGS = tbl({
  // --- common / shared --------------------------------------------------
  'common.loading': { en: 'loading…', zh: '加载中…' },
  'common.empty': { en: '(empty)', zh: '（空）' },
  'common.none': { en: '(none)', zh: '（无）' },
  'common.edits': {
    en: ({ n }: VarBag) => `${n} ${(n as number) === 1 ? 'edit' : 'edits'}`,
    zh: ({ n }: VarBag) => `${n} 次编辑`,
  },
  'common.turns': {
    en: ({ n }: VarBag) => `${n} ${(n as number) === 1 ? 'turn' : 'turns'}`,
    zh: ({ n }: VarBag) => `${n} 轮`,
  },
  'common.sessions': {
    en: ({ n }: VarBag) => `${n} ${(n as number) === 1 ? 'session' : 'sessions'}`,
    zh: ({ n }: VarBag) => `${n} 个会话`,
  },
  'common.hunks': {
    en: ({ n }: VarBag) => `${n} ${(n as number) === 1 ? 'hunk' : 'hunks'}`,
    zh: ({ n }: VarBag) => `${n} 个片段`,
  },
  'common.files': { en: 'files', zh: '文件' },
  'common.nFiles': {
    en: ({ n }: VarBag) => `${n} ${(n as number) === 1 ? 'file' : 'files'}`,
    zh: ({ n }: VarBag) => `${n} 个文件`,
  },
  'common.close': { en: 'Close', zh: '关闭' },
  'common.clear': { en: 'Clear', zh: '清除' },
  'common.cancel': { en: 'Cancel', zh: '取消' },
  'common.failedToLoad': {
    en: ({ what }: VarBag) => `Failed to load ${what}`,
    zh: ({ what }: VarBag) => `加载${what}失败`,
  },
  'common.relTime.sAgo': {
    en: ({ n }: VarBag) => `${n}s ago`,
    zh: ({ n }: VarBag) => `${n} 秒前`,
  },
  'common.relTime.mAgo': {
    en: ({ n }: VarBag) => `${n}m ago`,
    zh: ({ n }: VarBag) => `${n} 分钟前`,
  },
  'common.relTime.hAgo': {
    en: ({ n }: VarBag) => `${n}h ago`,
    zh: ({ n }: VarBag) => `${n} 小时前`,
  },
  'common.relTime.yesterday': { en: 'yesterday', zh: '昨天' },
  'common.relTime.dAgo': {
    en: ({ n }: VarBag) => `${n}d ago`,
    zh: ({ n }: VarBag) => `${n} 天前`,
  },

  // --- top bar / shell --------------------------------------------------
  'topbar.brand': { en: 'minspect', zh: 'minspect' },
  'topbar.connected': { en: 'collector connected', zh: '采集器已连接' },
  'topbar.disconnected': { en: 'collector down', zh: '采集器未运行' },

  'theme.switchToLight': { en: 'Switch to light mode', zh: '切换到浅色模式' },
  'theme.switchToDark': { en: 'Switch to dark mode', zh: '切换到深色模式' },
  'lang.switchToEn': { en: 'Switch to English', zh: '切换到英文' },
  'lang.switchToZh': { en: '切换到中文', zh: '切换到中文' },

  // --- tabs -------------------------------------------------------------
  'tabs.overview': { en: 'Overview', zh: '概览' },
  'tabs.review': { en: 'Review', zh: '回顾' },
  'tabs.replay': { en: 'Replay', zh: '重放' },
  'tabs.files': { en: 'Files', zh: '文件' },

  // --- breadcrumbs ------------------------------------------------------
  'crumbs.workspaces': { en: 'workspaces', zh: '工作区' },
  'crumbs.dashboard': { en: 'Dashboard', zh: '仪表盘' },
  'crumbs.timeline': { en: 'Timeline', zh: '时间线' },
  'crumbs.session': {
    en: ({ id }: VarBag) => `session ${id}`,
    zh: ({ id }: VarBag) => `会话 ${id}`,
  },

  // --- status bar -------------------------------------------------------
  'status.left.workspace': {
    en: ({ path }: VarBag) => `workspace · ${path}`,
    zh: ({ path }: VarBag) => `工作区 · ${path}`,
  },
  'status.left.sessionPrefix': { en: 'session', zh: '会话' },
  'status.left.blamePrefix': { en: 'blame', zh: '追溯' },
  'status.spawnedByHook': { en: 'auto-started', zh: '自动启动' },
  'status.spawnedByHookTip': {
    en: 'This daemon was auto-spawned by a hook. Run `minspect stop` to stop it.',
    zh: '此 daemon 由 hook 自动启动。用 minspect stop 关闭它。',
  },
  'status.queue': { en: 'queue:', zh: '队列：' },
  'status.poisoned': { en: 'poisoned:', zh: '隔离：' },
  'status.reload': { en: '↻ reload (UI updated)', zh: '↻ 刷新 (UI 已更新)' },
  'status.reloadTip': {
    en: 'The server rebuilt the UI while this tab was open — reload to pick it up.',
    zh: '服务端在你打开这个标签期间重新构建了 UI — 刷新以加载新版本。',
  },
  'status.quarantinedHeader': {
    en: ({ n }: VarBag) => `Quarantined events (${n})`,
    zh: ({ n }: VarBag) => `隔离事件 (${n})`,
  },
  'status.purgeHint': {
    en: 'Run minspect vacuum --clear-poison to purge.',
    zh: '运行 minspect vacuum --clear-poison 以清除。',
  },
  'status.failedToLoadInline': {
    en: ({ msg }: VarBag) => `Failed to load: ${msg}`,
    zh: ({ msg }: VarBag) => `加载失败：${msg}`,
  },

  // --- sidebar (workspaces) ---------------------------------------------
  'sidebar.workspacesHeading': { en: 'WORKSPACES', zh: '工作区' },
  'sidebar.workspacesEmptyTitle': { en: 'No workspaces yet', zh: '暂无工作区' },
  'sidebar.workspacesEmptySub': {
    en: 'Run minspect install --agent claude-code and chat with your agent — sessions appear here automatically.',
    zh: '运行 minspect install --agent claude-code 并开始与你的 AI 代理对话 — 会话会自动出现在这里。',
  },
  'sidebar.liveSession': { en: 'session in progress', zh: '会话进行中' },
  'sidebar.refreshBusy': {
    en: 'Refreshing — install hooks + import codex (last 30 days)',
    zh: '刷新中 — 安装 hook + 导入 codex (最近 30 天)',
  },
  'sidebar.refreshIdle': {
    en: 'Sync — install hooks + import codex sessions (last 30 days)',
    zh: '同步 — 安装 hook + 导入 codex 会话 (最近 30 天)',
  },
  'sidebar.refreshFailed': {
    en: ({ err }: VarBag) => `Refresh failed: ${err}`,
    zh: ({ err }: VarBag) => `刷新失败：${err}`,
  },

  // --- file tree sidebar (blame) ---------------------------------------
  'filetree.filterPlaceholder': { en: 'filter files...', zh: '过滤文件...' },
  'filetree.clear': { en: 'Clear filter', zh: '清除过滤' },
  'filetree.noFiles': { en: 'No files touched yet', zh: '尚未编辑任何文件' },
  'filetree.noMatches': { en: 'No matches', zh: '无匹配' },

  // --- dashboard --------------------------------------------------------
  'dashboard.title': { en: 'Dashboard', zh: '仪表盘' },
  'dashboard.activity': { en: 'Activity', zh: '活动' },
  'dashboard.edits': { en: 'edits', zh: '次编辑' },
  'dashboard.unitHour': { en: 'edits/hour', zh: '每小时编辑数' },
  'dashboard.unitDay': { en: 'edits/day', zh: '每日编辑数' },
  'dashboard.unitMonth': { en: 'edits/month', zh: '每月编辑数' },
  'dashboard.rangeToday': { en: 'Today', zh: '今天' },
  'dashboard.rangeWeek': { en: 'This week', zh: '本周' },
  'dashboard.range30d': { en: 'Last 30 days', zh: '最近 30 天' },
  'dashboard.rangeYear': { en: 'Last 12 months', zh: '最近一年' },
  'dashboard.selectRange': { en: 'Select date range', zh: '选择时间范围' },
  'dashboard.topWorkspaces': { en: 'Top workspaces', zh: '热门工作区' },
  'dashboard.topAgents': { en: 'Top agents', zh: '主要代理' },
  'dashboard.alerts': { en: 'Alerts', zh: '告警' },
  'dashboard.noAlerts': { en: 'No alerts in the last 7 days.', zh: '最近 7 天无告警。' },
  'dashboard.alertSub': {
    en: ({ level }: VarBag) => `${level} · last 7 days`,
    zh: ({ level }: VarBag) => `${level} · 最近 7 天`,
  },
  'dashboard.recentActivity': { en: 'Recent activity', zh: '近期活动' },
  'dashboard.noActivity': { en: 'No activity yet', zh: '暂无活动' },
  'dashboard.noActivitySub': {
    en: 'Run minspect install --agent claude-code to start capturing sessions.',
    zh: '运行 minspect install --agent claude-code 开始捕获会话。',
  },
  'dashboard.tooltipEdits': {
    en: ({ n }: VarBag) => `${n} ${(n as number) === 1 ? 'edit' : 'edits'}`,
    zh: ({ n }: VarBag) => `${n} 次编辑`,
  },

  // --- timeline page ---------------------------------------------------
  'timeline.title': { en: 'Timeline', zh: '时间线' },
  'timeline.subtitle': {
    en: 'All captured sessions across every workspace.',
    zh: '所有工作区中捕获的全部会话。',
  },
  'timeline.emptyTitle': { en: 'No sessions captured yet', zh: '尚未捕获任何会话' },
  'timeline.emptySub': {
    en: 'Run minspect install --agent claude-code to wire up hooks.',
    zh: '运行 minspect install --agent claude-code 接入 hook。',
  },
  'timeline.failedToLoad': {
    en: ({ msg }: VarBag) => `Failed to load sessions: ${msg}`,
    zh: ({ msg }: VarBag) => `加载会话失败：${msg}`,
  },
  'timeline.sAgo': { en: ({ n }: VarBag) => `${n}s ago`, zh: ({ n }: VarBag) => `${n} 秒前` },
  'timeline.mAgo': { en: ({ n }: VarBag) => `${n}m ago`, zh: ({ n }: VarBag) => `${n} 分钟前` },
  'timeline.hAgo': { en: ({ n }: VarBag) => `${n}h ago`, zh: ({ n }: VarBag) => `${n} 小时前` },
  'timeline.dAgo': { en: ({ n }: VarBag) => `${n}d ago`, zh: ({ n }: VarBag) => `${n} 天前` },

  // --- workspace page --------------------------------------------------
  'workspace.stat.sessions': { en: 'Sessions', zh: '会话' },
  'workspace.stat.turns': { en: 'Turns', zh: '轮次' },
  'workspace.stat.edits': { en: 'Edits', zh: '编辑' },
  'workspace.stat.filesTouched': { en: 'Files touched', zh: '涉及文件' },
  'workspace.sessionsCardTitle': { en: 'Sessions', zh: '会话' },
  'workspace.filesCardTitle': { en: 'Files touched', zh: '涉及文件' },
  'workspace.sessionsTbl.id': { en: 'ID', zh: 'ID' },
  'workspace.sessionsTbl.agent': { en: 'AGENT', zh: '代理' },
  'workspace.sessionsTbl.started': { en: 'STARTED', zh: '开始时间' },
  'workspace.sessionsTbl.turns': { en: 'TURNS', zh: '轮次' },
  'workspace.sessionsTbl.files': { en: 'FILES', zh: '文件' },
  'workspace.noSessions': { en: 'No sessions captured yet', zh: '尚未捕获任何会话' },
  'workspace.noFiles': { en: 'No files touched yet', zh: '尚未编辑任何文件' },
  'workspace.inspector.title': { en: 'Workspace', zh: '工作区' },
  'workspace.inspector.path': { en: 'PATH', zh: '路径' },
  'workspace.inspector.summary': { en: 'SUMMARY', zh: '摘要' },
  'workspace.inspector.topFiles': {
    en: ({ n }: VarBag) => `TOP FILES (${n})`,
    zh: ({ n }: VarBag) => `常编辑文件 (${n})`,
  },
  'workspace.inspector.recentSessions': {
    en: ({ n }: VarBag) => `RECENT SESSIONS (${n})`,
    zh: ({ n }: VarBag) => `最近会话 (${n})`,
  },
  'workspace.inspector.actions': { en: 'ACTIONS', zh: '操作' },
  'workspace.inspector.openBlame': { en: 'Open blame on top file', zh: '查看热门文件追溯' },
  'workspace.inspector.reviewLatest': { en: 'Review latest session', zh: '回顾最近会话' },
  'workspace.inspector.replayLatest': { en: 'Replay latest session', zh: '重放最近会话' },
  'workspace.inspector.agentsLabel': { en: 'agents:', zh: '代理：' },
  'workspace.inspector.lastActivity': { en: 'last activity:', zh: '最近活动：' },
  'workspace.inspector.sessions': { en: 'sessions', zh: '会话' },
  'workspace.inspector.editsLbl': { en: 'edits', zh: '编辑' },
  'workspace.inspector.filesLbl': { en: 'files', zh: '文件' },

  // --- session overview page -------------------------------------------
  'sessionOverview.sessionTitle': {
    en: ({ id }: VarBag) => `Session ${id}`,
    zh: ({ id }: VarBag) => `会话 ${id}`,
  },
  'sessionOverview.stat.turns': { en: 'Turns', zh: '轮次' },
  'sessionOverview.stat.edits': { en: 'Edits', zh: '编辑' },
  'sessionOverview.stat.filesTouched': { en: 'Files touched', zh: '涉及文件' },
  'sessionOverview.stat.duration': { en: 'Duration', zh: '时长' },
  'sessionOverview.turnTimeline': { en: 'Turn timeline', zh: '轮次时间线' },
  'sessionOverview.noPrompt': { en: '(no prompt)', zh: '(无提示)' },
  'sessionOverview.noToolCalls': { en: '(no tool calls)', zh: '(无工具调用)' },
  'sessionOverview.noTurnsTitle': { en: 'No turns captured yet', zh: '尚无轮次' },
  'sessionOverview.noTurnsSub': {
    en: 'This session has no recorded turns. It may still be starting up.',
    zh: '该会话尚无轮次记录，可能还在启动中。',
  },
  'sessionOverview.duration': {
    en: ({ label }: VarBag) => `duration ${label}`,
    zh: ({ label }: VarBag) => `时长 ${label}`,
  },
  'sessionOverview.deleteSession': { en: 'Delete session', zh: '删除会话' },
  'sessionOverview.deleteConfirmTitle': { en: 'Delete session?', zh: '确认删除会话？' },
  'sessionOverview.deleteConfirmMessage': {
    en: ({ id, agent }: VarBag) =>
      `Session ${id} (agent: ${agent}). All turns, edits, and blame data will be permanently removed.`,
    zh: ({ id, agent }: VarBag) =>
      `会话 ${id}（代理：${agent}）。所有轮次、编辑和追溯数据将被永久删除。`,
  },
  'sessionOverview.deleteConfirmWarning': {
    en: 'This action cannot be undone.',
    zh: '此操作不可撤销。',
  },
  'sessionOverview.deleteConfirmButton': { en: 'Delete', zh: '删除' },
  'sessionOverview.deleteFailed': {
    en: ({ msg }: VarBag) => `Delete failed: ${msg}`,
    zh: ({ msg }: VarBag) => `删除失败：${msg}`,
  },
  'sessionOverview.resumeSession': { en: 'Resume in terminal', zh: '在终端中恢复' },
  'sessionOverview.resumeSuccess': { en: 'Terminal opened', zh: '终端已打开' },
  'sessionOverview.resumeFailed': {
    en: ({ msg }: VarBag) => `Resume failed: ${msg}`,
    zh: ({ msg }: VarBag) => `恢复失败：${msg}`,
  },

  // --- session files page ----------------------------------------------
  'sessionFiles.title': { en: 'Files touched', zh: '涉及文件' },
  'sessionFiles.subtitleEmpty': {
    en: 'This session has not touched any files yet.',
    zh: '此会话尚未编辑任何文件。',
  },
  'sessionFiles.subtitle': {
    en: ({ files, edits, id }: VarBag) =>
      `${files} file${(files as number) === 1 ? '' : 's'} · ${edits} edit${(edits as number) === 1 ? '' : 's'} total · scoped to session ${id}`,
    zh: ({ files, edits, id }: VarBag) => `${files} 个文件 · 共 ${edits} 次编辑 · 范围：会话 ${id}`,
  },
  'sessionFiles.card': { en: 'Files', zh: '文件' },
  'sessionFiles.tbl.file': { en: 'FILE', zh: '文件' },
  'sessionFiles.tbl.edits': { en: 'EDITS', zh: '编辑次数' },
  'sessionFiles.tbl.heat': { en: 'HEAT', zh: '热度' },
  'sessionFiles.tbl.lastEdit': { en: 'LAST EDIT', zh: '最近编辑' },
  'sessionFiles.emptyTitle': { en: 'No files touched in this session', zh: '此会话未编辑任何文件' },

  // --- review page ------------------------------------------------------
  'review.turns': { en: 'TURNS', zh: '轮次' },
  'review.export': { en: 'export', zh: '导出' },
  'review.noTurnsTitle': { en: 'No turns captured yet', zh: '尚无轮次' },
  'review.noTurnsSub': {
    en: 'Once the agent starts chatting in this session, turns will stream in here.',
    zh: '当代理在此会话中开始对话后，轮次将在这里实时出现。',
  },
  'review.filterEmptyTitle': {
    en: 'No turns match the current filter',
    zh: '当前过滤条件下没有匹配的轮次',
  },
  'review.filterEmptySub': {
    en: 'Try clearing the search or level filter above.',
    zh: '尝试清除上方的搜索或级别过滤。',
  },
  'review.matchesHidden': {
    en: ({ n }: VarBag) => `${n} hidden by filter`,
    zh: ({ n }: VarBag) => `${n} 个被过滤`,
  },
  'review.filterFilePath': { en: 'file path contains…', zh: '文件路径包含…' },
  'review.filterKeyword': {
    en: 'keyword in prompt / explanation',
    zh: '提示或说明中的关键词',
  },
  'review.levelAll': { en: 'all badges', zh: '所有标记' },
  'review.levelInfo': { en: '≥ info', zh: '≥ 信息' },
  'review.levelWarn': { en: '≥ warn', zh: '≥ 警告' },
  'review.levelDangerOnly': { en: 'danger only', zh: '仅严重' },
  'review.matchesCount': {
    en: ({ n, total }: VarBag) => `${n} of ${total} turns`,
    zh: ({ n, total }: VarBag) => `${total} 轮中的 ${n} 轮`,
  },
  'review.filteredOut': {
    en: ({ n }: VarBag) => `… ${n} turn${(n as number) === 1 ? '' : 's'} filtered out`,
    zh: ({ n }: VarBag) => `…${n} 轮被过滤`,
  },
  'review.revertTurn': { en: 'Revert turn', zh: '回滚轮次' },
  'review.agentExplanation': {
    en: 'AGENT EXPLANATION (from preamble)',
    zh: '代理说明（来自前言）',
  },
  'review.turnMeta': {
    en: ({ idx, edits }: VarBag) =>
      `turn #${idx} · ${edits} edit${(edits as number) === 1 ? '' : 's'}`,
    zh: ({ idx, edits }: VarBag) => `第 ${idx} 轮 · ${edits} 次编辑`,
  },
  'review.durLine': {
    en: ({ dur, time }: VarBag) => `dur ${dur} · ${time}`,
    zh: ({ dur, time }: VarBag) => `时长 ${dur} · ${time}`,
  },

  // --- replay page ------------------------------------------------------
  'replay.noStepsTitle': { en: 'No steps recorded for this session', zh: '此会话无步骤记录' },
  'replay.noStepsSub': {
    en: 'Replay needs at least one captured turn. Try chatting with the agent first.',
    zh: '重放需要至少一个已捕获的轮次。请先与代理对话。',
  },
  'replay.emptyTurn': { en: '(empty turn)', zh: '（空轮次）' },
  'replay.emptyTurnLabel': {
    en: ({ idx }: VarBag) => `(empty turn #${idx})`,
    zh: ({ idx }: VarBag) => `（空轮次 #${idx}）`,
  },
  'replay.toolCall': { en: 'tool call', zh: '工具调用' },
  'replay.toolCallCounter': {
    en: ({ i, total }: VarBag) => `(tool_call ${i}/${total})`,
    zh: ({ i, total }: VarBag) => `(工具调用 ${i}/${total})`,
  },
  'replay.failedToLoad': { en: 'Failed to load replay', zh: '加载重放失败' },
  'replay.sessionTimeline': { en: 'Session timeline', zh: '会话时间线' },
  'replay.scrubMeta': {
    en: ({ idx, total, turn }: VarBag) => `step ${idx} / ${total} · turn #${turn}`,
    zh: ({ idx, total, turn }: VarBag) => `第 ${idx} / ${total} 步 · 第 ${turn} 轮`,
  },
  'replay.kbHint': { en: '← → Home End Space', zh: '← → Home End 空格' },
  'replay.autoplayTip': { en: 'autoplay (Space)', zh: '自动播放 (空格)' },
  'replay.home': { en: 'Home', zh: '起点' },
  'replay.prev': { en: '← prev', zh: '← 上一步' },
  'replay.next': { en: '→ next', zh: '→ 下一步' },
  'replay.end': { en: 'End', zh: '终点' },
  'replay.revertTurn': { en: 'Revert turn', zh: '回滚轮次' },
  'replay.stepCounter': {
    en: ({ i, total, step, stepTotal }: VarBag) =>
      `tool_call ${i} of ${total} · step ${step} / ${stepTotal}`,
    zh: ({ i, total, step, stepTotal }: VarBag) =>
      `第 ${i} / ${total} 工具调用 · 第 ${step} / ${stepTotal} 步`,
  },
  'replay.explanationHdr': { en: 'EXPLANATION · from preamble', zh: '说明 · 来自前言' },
  'replay.noExplanation': { en: '(no explanation for this tool call)', zh: '（此工具调用无说明）' },
  'replay.prevStep': {
    en: ({ idx }: VarBag) => `PREV · step ${idx}`,
    zh: ({ idx }: VarBag) => `上一步 · 第 ${idx} 步`,
  },
  'replay.nextStep': {
    en: ({ idx }: VarBag) => `NEXT · step ${idx} (press →)`,
    zh: ({ idx }: VarBag) => `下一步 · 第 ${idx} 步 (按 →)`,
  },
  'replay.agentThinking': { en: 'AGENT THINKING', zh: '代理思考过程' },
  'replay.stepContext': { en: 'Step context', zh: '步骤上下文' },
  'replay.turnSoFar': {
    en: ({ n }: VarBag) => `TURN SO FAR (${n} file${(n as number) === 1 ? '' : 's'})`,
    zh: ({ n }: VarBag) => `本轮至今 (${n} 个文件)`,
  },

  // --- blame page -------------------------------------------------------
  'blame.statsLine': {
    en: ({ lines, edits, sessions }: VarBag) =>
      `${lines} lines · ${edits} edits · ${sessions} session${(sessions as number) === 1 ? '' : 's'}`,
    zh: ({ lines, edits, sessions }: VarBag) =>
      `${lines} 行 · ${edits} 次编辑 · ${sessions} 个会话`,
  },
  'blame.searchPlaceholder': { en: 'search in file ⌘F', zh: '文件内搜索 ⌘F' },
  'blame.searchPrev': { en: 'Previous (Shift+Enter)', zh: '上一个 (Shift+Enter)' },
  'blame.searchNext': { en: 'Next (Enter)', zh: '下一个 (Enter)' },
  'blame.searchClear': { en: 'Clear (Esc)', zh: '清除 (Esc)' },
  'blame.revisions': { en: 'revisions', zh: '版本' },
  'blame.revisionsTip': {
    en: 'List every AI edit that touched this file, newest first',
    zh: '列出所有修改过此文件的 AI 编辑，最新在前',
  },
  'blame.revisionsHeader': {
    en: ({ n }: VarBag) => `Revisions (${n})`,
    zh: ({ n }: VarBag) => `版本 (${n})`,
  },
  'blame.revisionsEmpty': { en: 'No edits recorded for this file.', zh: '此文件尚无编辑记录。' },
  'blame.revisionCurrent': { en: 'current', zh: '当前' },
  'blame.viewingRevision': {
    en: ({ when, n, total }: VarBag) => `Viewing revision from ${when} (${n} of ${total})`,
    zh: ({ when, n, total }: VarBag) => `正在查看 ${when} 的版本（第 ${n} / ${total} 次）`,
  },
  'blame.viewingRevisionUnknown': {
    en: 'Viewing a historical revision',
    zh: '正在查看历史版本',
  },
  'blame.backToCurrent': { en: 'Back to current', zh: '返回当前' },
  'blame.revisionsNoPrompt': { en: '(no prompt recorded)', zh: '（无提示记录）' },
  'blame.noContentTitle': {
    en: 'No content recorded for this file yet',
    zh: '此文件尚无内容记录',
  },
  'blame.noContentSub': {
    en: 'The file exists in session metadata but no edits have been captured. Try another file.',
    zh: '此文件存在于会话元数据中但尚无编辑被捕获。请尝试其他文件。',
  },
  'blame.failedToLoad': { en: 'Failed to load blame', zh: '加载追溯信息失败' },
  'blame.inspector.title': { en: 'Blame inspector', zh: '追溯检视器' },
  'blame.inspector.prompt': { en: 'PROMPT', zh: '提示' },
  'blame.inspector.reasoning': { en: 'AGENT REASONING', zh: '代理思考过程' },
  'blame.inspector.finalMessage': { en: 'AGENT FINAL MESSAGE', zh: '代理最终回复' },
  'blame.inspector.explanation': { en: 'TOOL-CALL EXPLANATION', zh: '工具调用说明' },
  'blame.inspector.editsInTurn': {
    en: ({ n }: VarBag) => `EDITS IN THIS TURN (${n})`,
    zh: ({ n }: VarBag) => `本轮编辑 (${n})`,
  },
  'blame.inspector.file': { en: 'FILE', zh: '文件' },
  'blame.inspector.revertTurn': { en: 'Revert this turn', zh: '回滚本轮' },
  'blame.inspector.revertEdit': { en: 'Revert this edit', zh: '回滚本次编辑' },
  'blame.inspector.selectHint': {
    en: 'Select a line to see the turn that wrote it, reasoning, related edits, and Revert actions.',
    zh: '选中一行查看写入它的轮次、思考过程、相关编辑和回滚操作。',
  },
  'blame.inspector.preExisting': {
    en: 'Pre-existing content — this line was not modified by any tracked AI edit.',
    zh: '原始内容 — 此行未被任何已追踪的 AI 编辑修改。',
  },
  'blame.inspector.lineTurnTitle': {
    en: ({ line, turnIdx }: VarBag) => `Line ${line} · turn #${turnIdx}`,
    zh: ({ line, turnIdx }: VarBag) => `第 ${line} 行 · 轮次 #${turnIdx}`,
  },

  // --- compare revisions -------------------------------------------------
  'blame.compareMode': { en: 'Compare mode', zh: '对比模式' },
  'blame.compareSelected': {
    en: ({ n }: VarBag) => `Compare selected (${n})`,
    zh: ({ n }: VarBag) => `对比选中版本 (${n})`,
  },
  'blame.compareTitle': { en: 'Compare revisions', zh: '版本对比' },
  'blame.compareLeft': { en: 'Earlier', zh: '较早版本' },
  'blame.compareRight': { en: 'Later', zh: '较新版本' },
  'blame.compareSelectHint': { en: 'Select 2 revisions to compare', zh: '请选择 2 个版本进行对比' },
  'blame.compareNoContent': { en: 'Content unavailable (blob may have been vacuumed)', zh: '内容不可用（blob 可能已被清理）' },
  'blame.compareCheckboxLabel': { en: 'Select for compare', zh: '选择对比' },

  // --- command palette --------------------------------------------------
  'palette.placeholder': {
    en: 'Search across sessions (prompts, reasoning, tool-call explanations, file paths)...',
    zh: '跨会话搜索（提示、思考、工具调用说明、文件路径）...',
  },
  'palette.esc': { en: 'esc to close', zh: 'esc 关闭' },
  'palette.ftsUnavailableTitle': { en: 'FTS5 not available', zh: 'FTS5 不可用' },
  'palette.ftsUnavailableSub': {
    en: 'This SQLite build lacks the FTS5 module. Run minspect with a stock Node 20+ to enable search.',
    zh: '当前 SQLite 构建缺少 FTS5 模块。请使用官方 Node 20+ 运行 minspect 以启用搜索。',
  },
  'palette.noMatches': { en: 'No matches', zh: '无匹配' },
  'palette.tipLine1Pre': { en: ' ', zh: ' ' },
  'palette.tipLine1Nav': { en: 'to navigate', zh: '导航' },
  'palette.tipLine1Open': { en: 'to open', zh: '打开' },
  'palette.tipLine2': {
    en: 'Tokens are AND-matched with prefix search. Try a file name, an exact phrase, or an agent reasoning keyword.',
    zh: '多个词以 AND 方式前缀匹配。试试文件名、精确短语或代理思考关键词。',
  },
  'palette.kind.prompt': { en: 'prompt', zh: '提示' },
  'palette.kind.reasoning': { en: 'reasoning', zh: '思考' },
  'palette.kind.message': { en: 'message', zh: '消息' },
  'palette.kind.explanation': { en: 'explanation', zh: '说明' },
  'palette.kind.file': { en: 'file', zh: '文件' },

  // --- revert modal (minimal) ------------------------------------------
  'revert.title': { en: 'Revert — confirm', zh: '回滚 — 确认' },
  'revert.copy': { en: 'Copy command', zh: '复制命令' },
  'revert.codexBlocked': {
    en: 'Codex-sourced edits can only be reverted via git checkout — hunk windows are too narrow for safe file restore.',
    zh: 'Codex 来源的编辑只能通过 git checkout 回滚 — hunk 窗口过小，直接回滚可能不安全。',
  },
  'revert.h3.turn': { en: 'Revert turn', zh: '回滚轮次' },
  'revert.h3.edit': { en: 'Revert edit', zh: '回滚编辑' },
  'revert.fetchFailed': {
    en: ({ msg }: VarBag) => `Failed to fetch plan: ${msg}`,
    zh: ({ msg }: VarBag) => `获取计划失败：${msg}`,
  },
  'revert.source': {
    en: ({ name }: VarBag) => `source: ${name}`,
    zh: ({ name }: VarBag) => `来源：${name}`,
  },
  'revert.unknown': { en: 'unknown', zh: '未知' },
  'revert.codexTitle': { en: 'Codex-imported session.', zh: 'Codex 导入的会话。' },
  'revert.codexPart1': { en: 'Cannot revert: Codex', zh: '无法回滚：Codex' },
  'revert.codexPart2': {
    en: 'logs only capture hunk windows, not full-file snapshots. Restoring would overwrite unrelated regions. Use',
    zh: '日志仅记录 hunk 窗口，不是完整文件快照。回滚会覆盖无关区域，请改用',
  },
  'revert.codexPart3': { en: 'instead.', zh: '。' },
  'revert.laterEditsStrong': {
    en: ({ n }: VarBag) => `${n} later AI edit${(n as number) === 1 ? '' : 's'}`,
    zh: ({ n }: VarBag) => `${n} 次后续 AI 编辑`,
  },
  'revert.laterEditsRest': {
    en: 'on these files will also be undone:',
    zh: '在这些文件上也将被撤销：',
  },
  'revert.userEditsStrong': { en: 'User edits detected', zh: '检测到用户编辑' },
  'revert.userEditsRest': {
    en: 'between the target and current disk state — these will be overwritten:',
    zh: '位于目标与当前磁盘状态之间 — 这些会被覆盖：',
  },
  'revert.noFiles': { en: '(no files)', zh: '（无文件）' },
  'revert.runInTerminal': {
    en: 'To apply, run this in your terminal:',
    zh: '要应用，请在终端执行：',
  },
  'revert.copyBtn': { en: 'copy', zh: '复制' },
  'revert.copiedBtn': { en: 'copied', zh: '已复制' },
  'revert.closeBtn': { en: 'close', zh: '关闭' },

  // --- app fallback routes ---------------------------------------------
  'app.legacyTitle': { en: 'Legacy link', zh: '旧链接' },
  'app.legacyBody.pre': { en: 'Received legacy hash', zh: '收到旧格式路径' },
  'app.legacyBody.open': { en: 'Open', zh: '打开' },
  'app.legacyBody.theDashboard': { en: 'the dashboard', zh: '仪表盘' },
  'app.legacyBody.instead': { en: 'instead.', zh: '。' },
  'app.notFoundTitle': { en: 'Not found', zh: '未找到' },
  'app.notFoundBody.pre': {
    en: "The URL fragment didn't match any known route",
    zh: 'URL 片段未匹配任何已知路由',
  },
  'app.notFoundBody.tryDash': { en: '. Try', zh: '。尝试' },
  'app.notFoundBody.dashboard': { en: 'the dashboard', zh: '仪表盘' },
  'app.notFoundBody.period': { en: '.', zh: '。' },
} satisfies Record<string, StringEntry>);

export type StringKey = keyof typeof STRINGS;
