export const DEFAULT_REMINDER_HOUR = 9;
export const DEFAULT_REMINDER_MINUTE = 0;

/** 临期自动提醒：距截止日 ≤ 该天数时触发（通知中心可配 1/2/3） */
export const DEFAULT_DUE_SOON_WINDOW_DAYS = 1;

/** 过期滞留：当日默认提醒时刻（上午已过则傍晚） */
export const OVERDUE_STICKY_EVENING_HOUR = 20;
export const OVERDUE_STICKY_EVENING_MINUTE = 0;

export type TaskReminderOption =
  | '不提前'
  | '自动临期'
  | '当天'
  | '提前1天'
  | '提前2天'
  | '提前3天'
  | '提前7天';

/** 主路径选项（日程选择器默认展示） */
export const TASK_REMINDER_PRIMARY_OPTIONS: TaskReminderOption[] = ['不提前', '自动临期'];

/** 高级自定义（旧枚举，读兼容） */
export const TASK_REMINDER_ADVANCED_OPTIONS: TaskReminderOption[] = [
  '当天',
  '提前1天',
  '提前2天',
  '提前3天',
  '提前7天',
];

export const TASK_REMINDER_OPTIONS: TaskReminderOption[] = [
  ...TASK_REMINDER_PRIMARY_OPTIONS,
  ...TASK_REMINDER_ADVANCED_OPTIONS,
];

/** 日程选择器文案 */
export const TASK_REMINDER_OPTION_LABELS: Record<TaskReminderOption, string> = {
  不提前: '关闭截止提醒',
  自动临期: '自动临期',
  当天: '截止当天',
  提前1天: '截止前 1 天',
  提前2天: '截止前 2 天',
  提前3天: '截止前 3 天',
  提前7天: '截止前 7 天',
};

export type ReminderIntensity = 'soft' | 'normal' | 'strong';

export type TaskExtraScheduleReminder = {
  reminderOption?: string;
  reminderHour?: number;
  reminderMinute?: number;
  hasExactTime?: boolean;
  startTime?: string;
  /** 入格开始前提前量覆盖（分钟，5–60）；缺省用通知中心分类型默认 */
  advanceMinutesOverride?: number;
};

function parseHourMinuteFromIso(iso: string | undefined): { hour: number; minute: number } | null {
  if (!iso?.trim()) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { hour: date.getHours(), minute: date.getMinutes() };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseYmdParts(ymd: string): { y: number; mo: number; d: number } | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, mo, d };
}

export function clampAdvanceMinutesOverride(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(5, Math.min(60, Math.round(raw)));
}

/** 从提醒选项解析提前天数；「当天 / 自动临期」为 0 天 */
export function parseTaskReminderAdvanceDays(reminderOption: string): number {
  const t = reminderOption.trim();
  if (!t || t === '不提前' || t === '自动临期') return 0;
  if (t === '当天') return 0;
  const m = /^提前(\d+)天/.exec(t);
  if (m) return Math.min(30, Math.max(0, parseInt(m[1], 10) || 0));
  return 0;
}

export function isAutoDueSoonReminderOption(reminderOption: string | undefined): boolean {
  const opt = (reminderOption ?? '').trim();
  return opt === '自动临期' || opt === '';
}

/** 显式自定义枚举（不含关闭 / 自动临期） */
export function isCustomTaskReminderOption(reminderOption: string | undefined): boolean {
  const opt = (reminderOption ?? '').trim();
  if (!opt || opt === '不提前' || opt === '自动临期') return false;
  if (opt === '当天') return true;
  return /^提前\d+天/.test(opt);
}

/** 用户是否配置了待办提醒（含自动临期 / 当天 / 提前 N 天，不含「不提前」） */
export function isTaskReminderConfigured(
  reminderOption: string | undefined,
  reminderText: string | undefined,
): boolean {
  const opt = (reminderOption ?? '').trim();
  if (opt === '自动临期' || opt === '当天') return true;
  if (opt && opt !== '不提前') return true;
  const text = (reminderText ?? '').trim();
  if (!text || text === '不提前') return false;
  if (text === '关闭截止提醒') return false;
  if (text === '自动临期' || text.startsWith('自动临期')) return true;
  if (text === '当天' || text.startsWith('当天 ')) return true;
  if (text.startsWith('截止当天') || text.startsWith('截止前')) return true;
  return /^提前\d+天/.test(text);
}

/**
 * 提醒触发的时刻：
 * 1. 用户在日程页设置了「提醒时间」→ 使用该时刻
 * 2. 否则若截止日启用了「具体时间」→ 使用截止时刻
 * 3. 否则默认 09:00
 */
export function resolveReminderHourMinute(schedule: TaskExtraScheduleReminder | null | undefined): {
  hour: number;
  minute: number;
} {
  const h = schedule?.reminderHour;
  const m = schedule?.reminderMinute;
  if (typeof h === 'number' && h >= 0 && h <= 23 && typeof m === 'number' && m >= 0 && m <= 59) {
    return { hour: h, minute: m };
  }
  if (schedule?.hasExactTime) {
    const fromStart = parseHourMinuteFromIso(schedule.startTime);
    if (fromStart) return fromStart;
  }
  return { hour: DEFAULT_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
}

/** 在截止日 anchorYmd 基础上，按提前天数与时刻计算本地推送触发时间 */
export function buildTaskReminderFireAt(
  anchorYmd: string,
  advanceDays: number,
  schedule: TaskExtraScheduleReminder | null | undefined,
): Date | null {
  const parts = parseYmdParts(anchorYmd);
  if (!parts) return null;

  const { hour, minute } = resolveReminderHourMinute(schedule);
  const fire = new Date(parts.y, parts.mo - 1, parts.d);
  fire.setDate(fire.getDate() - Math.max(0, advanceDays));
  fire.setHours(hour, minute, 0, 0);
  return fire;
}

/**
 * 距截止是否进入临期窗口（含截止当天）。
 * daysUntilDue = dueYmd − todayYmd（按日历日差）；≤ windowDays 且 ≥ 0 为临期。
 */
export function isTaskDueSoon(params: {
  todayYmd: string;
  dueYmd: string;
  windowDays?: number;
}): boolean {
  const today = parseYmdParts(params.todayYmd);
  const due = parseYmdParts(params.dueYmd);
  if (!today || !due) return false;
  const todayMs = Date.UTC(today.y, today.mo - 1, today.d);
  const dueMs = Date.UTC(due.y, due.mo - 1, due.d);
  const daysUntil = Math.round((dueMs - todayMs) / 86_400_000);
  const window = Math.max(0, params.windowDays ?? DEFAULT_DUE_SOON_WINDOW_DAYS);
  return daysUntil >= 0 && daysUntil <= window;
}

/** 过期未完成：dueYmd 早于 todayYmd */
export function isTaskPastDue(params: { todayYmd: string; dueYmd: string }): boolean {
  const today = parseYmdParts(params.todayYmd);
  const due = parseYmdParts(params.dueYmd);
  if (!today || !due) return false;
  const todayMs = Date.UTC(today.y, today.mo - 1, today.d);
  const dueMs = Date.UTC(due.y, due.mo - 1, due.d);
  return dueMs < todayMs;
}

/**
 * 过期「今日滞留」触发时刻：优先用户提醒时刻；若已过则傍晚收口。
 */
export function buildOverdueStickyFireAt(params: {
  todayYmd: string;
  schedule: TaskExtraScheduleReminder | null | undefined;
  now?: Date;
}): Date | null {
  const parts = parseYmdParts(params.todayYmd);
  if (!parts) return null;
  const now = params.now ?? new Date();
  const { hour, minute } = resolveReminderHourMinute(params.schedule);
  const morning = new Date(parts.y, parts.mo - 1, parts.d, hour, minute, 0, 0);
  if (morning.getTime() > now.getTime() + 2000) return morning;
  const evening = new Date(
    parts.y,
    parts.mo - 1,
    parts.d,
    OVERDUE_STICKY_EVENING_HOUR,
    OVERDUE_STICKY_EVENING_MINUTE,
    0,
    0,
  );
  if (evening.getTime() > now.getTime() + 2000) return evening;
  return null;
}

/**
 * 截止提醒是否应抑制：完成 / 取消 / 搁置。
 */
export function shouldSuppressTaskDeadlineReminder(status: string | null | undefined): boolean {
  const s = (status ?? '').trim();
  return s === 'done' || s === 'cancelled' || s === 'shelved';
}

/**
 * 默认强度：青蛙当日指派或高优先（≥3）→ strong；优先 2 → normal；更低可 soft。
 */
export function resolveTaskDeadlineReminderIntensity(params: {
  priority?: number | null;
  isFrogToday?: boolean;
}): ReminderIntensity {
  if (params.isFrogToday) return 'strong';
  const p = typeof params.priority === 'number' ? params.priority : 0;
  if (p >= 3) return 'strong';
  if (p <= 0) return 'soft';
  return 'normal';
}

export type TaskDeadlineReminderKind = 'custom' | 'auto_due_soon' | 'overdue_sticky';

/**
 * 解析下一次截止提醒。
 * - 自定义枚举 → 相对截止日
 * - 自动临期 / 空选项 → 临期窗口内当天时刻
 * - 过期未完成 → 今日滞留（可关）
 * - 「不提前」→ 仅过期滞留可推，不推临期
 */
export function resolveTaskDeadlineReminderFireAt(params: {
  dueYmd: string;
  schedule: TaskExtraScheduleReminder | null | undefined;
  todayYmd?: string;
  now?: Date;
  dueSoonWindowDays?: number;
  /** 未配置枚举时是否启用临期自动（默认 true） */
  enableAutoDueSoon?: boolean;
  /** 过期今日滞留（默认 true） */
  enableOverdueSticky?: boolean;
}): { fireAt: Date; kind: TaskDeadlineReminderKind } | null {
  const opt = (params.schedule?.reminderOption ?? '').trim();
  const now = params.now ?? new Date();
  const todayYmd = params.todayYmd;

  if (opt === '不提前') {
    if (params.enableOverdueSticky === false || !todayYmd) return null;
    if (!isTaskPastDue({ todayYmd, dueYmd: params.dueYmd })) return null;
    const fireAt = buildOverdueStickyFireAt({ todayYmd, schedule: params.schedule, now });
    return fireAt ? { fireAt, kind: 'overdue_sticky' } : null;
  }

  if (isCustomTaskReminderOption(opt)) {
    const advanceDays = parseTaskReminderAdvanceDays(opt);
    const fireAt = buildTaskReminderFireAt(params.dueYmd, advanceDays, params.schedule);
    if (!fireAt || fireAt.getTime() <= now.getTime() + 2000) {
      // 自定义点已过：若已过期仍可走滞留
      if (params.enableOverdueSticky !== false && todayYmd && isTaskPastDue({ todayYmd, dueYmd: params.dueYmd })) {
        const sticky = buildOverdueStickyFireAt({ todayYmd, schedule: params.schedule, now });
        return sticky ? { fireAt: sticky, kind: 'overdue_sticky' } : null;
      }
      return null;
    }
    return { fireAt, kind: 'custom' };
  }

  // 自动临期（显式「自动临期」或空）
  if (params.enableAutoDueSoon === false) return null;
  if (!todayYmd) return null;

  if (isTaskPastDue({ todayYmd, dueYmd: params.dueYmd })) {
    if (params.enableOverdueSticky === false) return null;
    const fireAt = buildOverdueStickyFireAt({ todayYmd, schedule: params.schedule, now });
    return fireAt ? { fireAt, kind: 'overdue_sticky' } : null;
  }

  if (
    !isTaskDueSoon({
      todayYmd,
      dueYmd: params.dueYmd,
      windowDays: params.dueSoonWindowDays,
    })
  ) {
    return null;
  }

  const fireAt = buildTaskReminderFireAt(params.dueYmd, 0, {
    ...params.schedule,
    reminderOption: '当天',
  });
  if (!fireAt || fireAt.getTime() <= now.getTime() + 2000) return null;
  return { fireAt, kind: 'auto_due_soon' };
}

export function formatTaskReminderOptionLabel(option: string | undefined): string {
  const opt = (option ?? '').trim() as TaskReminderOption;
  if (opt && opt in TASK_REMINDER_OPTION_LABELS) {
    return TASK_REMINDER_OPTION_LABELS[opt];
  }
  return option?.trim() || '';
}

export function formatTaskReminderLabel(
  schedule:
    | {
        reminderOption?: string;
        reminderHour?: number;
        reminderMinute?: number;
        hasExactTime?: boolean;
        startTime?: string;
        advanceMinutesOverride?: number;
      }
    | null
    | undefined,
): string {
  if (!schedule) return '';
  const opt = (schedule.reminderOption ?? '').trim();
  if (!opt || opt === '不提前') return '';
  const { hour, minute } = resolveReminderHourMinute(schedule);
  const hasExplicitReminderTime =
    typeof schedule.reminderHour === 'number' && typeof schedule.reminderMinute === 'number';
  const hasDueExactTime = !!schedule.hasExactTime && !!schedule.startTime?.trim();
  const time =
    hasExplicitReminderTime || hasDueExactTime || opt === '自动临期'
      ? ` ${pad2(hour)}:${pad2(minute)}`
      : '';
  const optLabel = formatTaskReminderOptionLabel(opt) || opt;
  return `${optLabel}${time}`.trim();
}

/** 列表/详情：「下次提醒 · MM-DD HH:mm」；算不出则回落 formatTaskReminderLabel */
export function formatNextTaskReminderLine(params: {
  dueYmd: string | null | undefined;
  schedule: TaskExtraScheduleReminder | null | undefined;
  todayYmd?: string;
  now?: Date;
  dueSoonWindowDays?: number;
}): string {
  const dueYmd = params.dueYmd?.trim();
  if (!dueYmd) return formatTaskReminderLabel(params.schedule);
  const resolved = resolveTaskDeadlineReminderFireAt({
    dueYmd,
    schedule: params.schedule,
    todayYmd: params.todayYmd,
    now: params.now,
    dueSoonWindowDays: params.dueSoonWindowDays,
    enableAutoDueSoon: true,
    enableOverdueSticky: true,
  });
  if (!resolved) return formatTaskReminderLabel(params.schedule);
  const fireAt = resolved.fireAt;
  const mo = fireAt.getMonth() + 1;
  const d = fireAt.getDate();
  const prefix = resolved.kind === 'overdue_sticky' ? '今日滞留' : '下次提醒';
  return `${prefix} · ${pad2(mo)}-${pad2(d)} ${pad2(fireAt.getHours())}:${pad2(fireAt.getMinutes())}`;
}
