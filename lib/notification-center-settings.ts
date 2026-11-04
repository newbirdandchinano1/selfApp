import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import type { NotificationCategoryId } from '@/lib/notification-catalog';
import { NOTIFICATION_CATEGORIES } from '@/lib/notification-catalog';

export type NotificationCategoryPrefs = Record<NotificationCategoryId, boolean>;

/** 健康提醒关注的摄入项 */
export type HealthIntakeFocusKey = 'hydration' | 'protein' | 'carbohydrate' | 'calories';

/**
 * 健康提醒模式：
 * - meal_windows：餐次窗口催最大缺口，并带傍晚收口
 * - evening_wrap：仅傍晚收口一条
 * - hydration_interval：水分轻间隔（从最近一次记录起算）
 */
export type HealthIntakeReminderMode = 'meal_windows' | 'evening_wrap' | 'hydration_interval';

export type HealthIntakeIntervalMinutes = 30 | 60 | 120;

export type HealthIntakeMealWindow = {
  hour: number;
  minute: number;
};

export type HealthIntakeReminderPrefs = {
  mode: HealthIntakeReminderMode;
  /** 关注项；空数组视为全开 */
  focusKeys: HealthIntakeFocusKey[];
  /** 餐次窗口（默认午 / 晚） */
  mealWindows: HealthIntakeMealWindow[];
  /** 傍晚收口（兼容旧 fixedHour / fixedMinute） */
  wrapHour: number;
  wrapMinute: number;
  /** @deprecated 读兼容；写入时同步 wrap* */
  fixedHour: number;
  fixedMinute: number;
  /** 水分轻间隔分钟数 */
  intervalMinutes: HealthIntakeIntervalMinutes;
  /** 免打扰起止，默认 23:00–07:00（可跨午夜） */
  quietStartHour: number;
  quietStartMinute: number;
  quietEndHour: number;
  quietEndMinute: number;
  /** 「稍后再说」推迟到该时间戳之后再排；过期忽略 */
  snoozeUntilMs: number | null;
  /** 本逻辑日「今日不催」静音的指标 */
  dayMuteYmd: string | null;
  dayMuteKeys: HealthIntakeFocusKey[];
};

/** 入格提醒主体类型（与课表 subjectKind 对齐） */
export type ScheduleSlotSubjectKind = 'task' | 'project' | 'habit';

export type ScheduleSlotAdvanceByKind = Record<ScheduleSlotSubjectKind, number>;

export type ScheduleSlotReminderPrefs = {
  /**
   * 全局默认提前量（5–60），默认 15。
   * 读兼容：旧数据仅有此字段时，三类共用；新写入会同步到 advanceByKind.task。
   */
  advanceMinutes: number;
  /**
   * 分类型默认提前量（P0）。
   * 待办默认同 advanceMinutes；项目默认更轻（10）；习惯虚入格默认 15。
   */
  advanceByKind: ScheduleSlotAdvanceByKind;
  /** 临期窗口：距截止 ≤ N 天自动提醒（1–3） */
  dueSoonWindowDays: number;
  /** 项目无入格滞留：超过 N 天未入格则催推进（1–14） */
  projectStaleDays: number;
  /** 过期待办「今日滞留」 */
  overdueStickyEnabled: boolean;
};

/** 财务页提醒偏好（类别开关仍走 categories） */
export type FinanceReminderPrefs = {
  /** 定时支出：应记时刻前提前量（0–180 分钟），默认 30 */
  scheduledAdvanceMinutes: number;
  /** 应记日未入账则傍晚收口 */
  scheduledEveningWrapEnabled: boolean;
  scheduledEveningWrapHour: number;
  scheduledEveningWrapMinute: number;
  /** 预算阈值档：默认仅 80% + 超支 */
  budgetNotify50: boolean;
  budgetNotify80: boolean;
  budgetNotifyOver: boolean;
  /** 周期键 → 已通知标记（去重） */
  budgetNotifiedByPeriod: Record<
    string,
    { t50?: boolean; t80?: boolean; over?: boolean }
  >;
  /** 储蓄轻催：每周几（0=周日）与时刻 */
  savingsNudgeWeekday: number;
  savingsNudgeHour: number;
  savingsNudgeMinute: number;
  /** 未记账收口时刻 */
  ledgerWrapHour: number;
  ledgerWrapMinute: number;
  /** 本逻辑日「今日不催」记账收口 */
  ledgerWrapMuteYmd: string | null;
};

export type NotificationCenterSettings = {
  /** 总开关：关闭后不再登记/展示本 App 本地通知 */
  masterEnabled: boolean;
  /** 各来源频道开关 */
  categories: NotificationCategoryPrefs;
  /**
   * 用户在中心「删除」过的预约标识。
   * 同步登记时跳过，直到用户在中心重新开启或清空静音。
   */
  mutedIdentifiers: string[];
  health: HealthIntakeReminderPrefs;
  schedule: ScheduleSlotReminderPrefs;
  finance: FinanceReminderPrefs;
};

const DEFAULT_CATEGORIES: NotificationCategoryPrefs = {
  'health-intake-reminder': true,
  'schedule-slot-reminder': true,
  'task-deadline-reminder': true,
  'project-progress-reminder': true,
  'habit-reminder': true,
  'daily-review-reminder': true,
  'weekly-review-reminder': true,
  'auto-ledger': true,
  'finance-scheduled-expense-reminder': true,
  'finance-budget-threshold-reminder': true,
  'finance-savings-nudge-reminder': false,
  'finance-ledger-wrap-reminder': false,
};

export const HEALTH_INTAKE_FOCUS_KEYS: readonly HealthIntakeFocusKey[] = [
  'hydration',
  'protein',
  'carbohydrate',
  'calories',
] as const;

export const DEFAULT_HEALTH_MEAL_WINDOWS: HealthIntakeMealWindow[] = [
  { hour: 12, minute: 0 },
  { hour: 18, minute: 30 },
];

export const DEFAULT_HEALTH_INTAKE_REMINDER_PREFS: HealthIntakeReminderPrefs = {
  mode: 'meal_windows',
  focusKeys: [...HEALTH_INTAKE_FOCUS_KEYS],
  mealWindows: DEFAULT_HEALTH_MEAL_WINDOWS.map(w => ({ ...w })),
  wrapHour: 20,
  wrapMinute: 0,
  fixedHour: 20,
  fixedMinute: 0,
  intervalMinutes: 60,
  quietStartHour: 23,
  quietStartMinute: 0,
  quietEndHour: 7,
  quietEndMinute: 0,
  snoozeUntilMs: null,
  dayMuteYmd: null,
  dayMuteKeys: [],
};

export const DEFAULT_SCHEDULE_SLOT_ADVANCE_BY_KIND: ScheduleSlotAdvanceByKind = {
  task: 15,
  project: 10,
  habit: 15,
};

export const DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS: ScheduleSlotReminderPrefs = {
  advanceMinutes: 15,
  advanceByKind: { ...DEFAULT_SCHEDULE_SLOT_ADVANCE_BY_KIND },
  dueSoonWindowDays: 1,
  projectStaleDays: 3,
  overdueStickyEnabled: true,
};

export const DEFAULT_FINANCE_REMINDER_PREFS: FinanceReminderPrefs = {
  scheduledAdvanceMinutes: 30,
  scheduledEveningWrapEnabled: true,
  scheduledEveningWrapHour: 20,
  scheduledEveningWrapMinute: 0,
  budgetNotify50: false,
  budgetNotify80: true,
  budgetNotifyOver: true,
  budgetNotifiedByPeriod: {},
  savingsNudgeWeekday: 0,
  savingsNudgeHour: 10,
  savingsNudgeMinute: 0,
  ledgerWrapHour: 21,
  ledgerWrapMinute: 0,
  ledgerWrapMuteYmd: null,
};

export const DEFAULT_NOTIFICATION_CENTER_SETTINGS: NotificationCenterSettings = {
  masterEnabled: true,
  categories: { ...DEFAULT_CATEGORIES },
  mutedIdentifiers: [],
  health: { ...DEFAULT_HEALTH_INTAKE_REMINDER_PREFS, mealWindows: DEFAULT_HEALTH_MEAL_WINDOWS.map(w => ({ ...w })), focusKeys: [...HEALTH_INTAKE_FOCUS_KEYS] },
  schedule: {
    ...DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS,
    advanceByKind: { ...DEFAULT_SCHEDULE_SLOT_ADVANCE_BY_KIND },
  },
  finance: { ...DEFAULT_FINANCE_REMINDER_PREFS, budgetNotifiedByPeriod: {} },
};

function clampHour(n: number): number {
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function clampMinute(n: number): number {
  return Math.max(0, Math.min(59, Math.floor(n)));
}

function clampAdvanceMinutes(n: number): number {
  return Math.max(5, Math.min(60, Math.round(n)));
}

function clampFinanceAdvanceMinutes(n: number): number {
  return Math.max(0, Math.min(180, Math.round(n)));
}

function clampWeekday(n: number): number {
  return ((Math.floor(n) % 7) + 7) % 7;
}

function normalizeIntervalMinutes(raw: unknown): HealthIntakeIntervalMinutes {
  if (raw === 30 || raw === 60 || raw === 120) return raw;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 30 || n === 60 || n === 120) return n;
  return DEFAULT_HEALTH_INTAKE_REMINDER_PREFS.intervalMinutes;
}

function normalizeMode(raw: unknown): HealthIntakeReminderMode {
  if (raw === 'meal_windows' || raw === 'evening_wrap' || raw === 'hydration_interval') return raw;
  // 旧版 fixed / interval
  if (raw === 'fixed') return 'evening_wrap';
  if (raw === 'interval') return 'hydration_interval';
  return DEFAULT_HEALTH_INTAKE_REMINDER_PREFS.mode;
}

function normalizeFocusKeys(raw: unknown): HealthIntakeFocusKey[] {
  if (!Array.isArray(raw)) return [...HEALTH_INTAKE_FOCUS_KEYS];
  const out: HealthIntakeFocusKey[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (
      item === 'hydration' ||
      item === 'protein' ||
      item === 'carbohydrate' ||
      item === 'calories'
    ) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out.length > 0 ? out : [...HEALTH_INTAKE_FOCUS_KEYS];
}

function normalizeMealWindows(raw: unknown): HealthIntakeMealWindow[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_HEALTH_MEAL_WINDOWS.map(w => ({ ...w }));
  }
  const out: HealthIntakeMealWindow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.hour !== 'number' || !Number.isFinite(o.hour)) continue;
    if (typeof o.minute !== 'number' || !Number.isFinite(o.minute)) continue;
    out.push({ hour: clampHour(o.hour), minute: clampMinute(o.minute) });
    if (out.length >= 4) break;
  }
  return out.length > 0 ? out : DEFAULT_HEALTH_MEAL_WINDOWS.map(w => ({ ...w }));
}

function normalizeMuteKeys(raw: unknown): HealthIntakeFocusKey[] {
  if (!Array.isArray(raw)) return [];
  const out: HealthIntakeFocusKey[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (
      item === 'hydration' ||
      item === 'protein' ||
      item === 'carbohydrate' ||
      item === 'calories'
    ) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function normalizeHealth(raw: unknown): HealthIntakeReminderPrefs {
  const base: HealthIntakeReminderPrefs = {
    ...DEFAULT_HEALTH_INTAKE_REMINDER_PREFS,
    focusKeys: [...HEALTH_INTAKE_FOCUS_KEYS],
    mealWindows: DEFAULT_HEALTH_MEAL_WINDOWS.map(w => ({ ...w })),
    dayMuteKeys: [],
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  base.mode = normalizeMode(o.mode);
  base.focusKeys = normalizeFocusKeys(o.focusKeys);
  base.mealWindows = normalizeMealWindows(o.mealWindows);

  const wrapH =
    typeof o.wrapHour === 'number' && Number.isFinite(o.wrapHour)
      ? o.wrapHour
      : typeof o.fixedHour === 'number' && Number.isFinite(o.fixedHour)
        ? o.fixedHour
        : base.wrapHour;
  const wrapM =
    typeof o.wrapMinute === 'number' && Number.isFinite(o.wrapMinute)
      ? o.wrapMinute
      : typeof o.fixedMinute === 'number' && Number.isFinite(o.fixedMinute)
        ? o.fixedMinute
        : base.wrapMinute;
  base.wrapHour = clampHour(wrapH);
  base.wrapMinute = clampMinute(wrapM);
  base.fixedHour = base.wrapHour;
  base.fixedMinute = base.wrapMinute;

  base.intervalMinutes = normalizeIntervalMinutes(o.intervalMinutes);
  if (typeof o.quietStartHour === 'number' && Number.isFinite(o.quietStartHour)) {
    base.quietStartHour = clampHour(o.quietStartHour);
  }
  if (typeof o.quietStartMinute === 'number' && Number.isFinite(o.quietStartMinute)) {
    base.quietStartMinute = clampMinute(o.quietStartMinute);
  }
  if (typeof o.quietEndHour === 'number' && Number.isFinite(o.quietEndHour)) {
    base.quietEndHour = clampHour(o.quietEndHour);
  }
  if (typeof o.quietEndMinute === 'number' && Number.isFinite(o.quietEndMinute)) {
    base.quietEndMinute = clampMinute(o.quietEndMinute);
  }

  if (typeof o.snoozeUntilMs === 'number' && Number.isFinite(o.snoozeUntilMs) && o.snoozeUntilMs > 0) {
    base.snoozeUntilMs = Math.floor(o.snoozeUntilMs);
  } else {
    base.snoozeUntilMs = null;
  }

  if (typeof o.dayMuteYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dayMuteYmd.trim())) {
    base.dayMuteYmd = o.dayMuteYmd.trim();
  } else {
    base.dayMuteYmd = null;
  }
  base.dayMuteKeys = normalizeMuteKeys(o.dayMuteKeys);
  if (!base.dayMuteYmd) base.dayMuteKeys = [];

  return base;
}

function normalizeAdvanceByKind(
  raw: unknown,
  fallbackGlobal: number,
): ScheduleSlotAdvanceByKind {
  const base: ScheduleSlotAdvanceByKind = {
    task: fallbackGlobal,
    project: DEFAULT_SCHEDULE_SLOT_ADVANCE_BY_KIND.project,
    habit: DEFAULT_SCHEDULE_SLOT_ADVANCE_BY_KIND.habit,
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    // 旧数据只有全局字段：三类先跟全局，项目仍用更轻默认
    return {
      task: fallbackGlobal,
      project: Math.min(fallbackGlobal, DEFAULT_SCHEDULE_SLOT_ADVANCE_BY_KIND.project),
      habit: fallbackGlobal,
    };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.task === 'number' && Number.isFinite(o.task)) {
    base.task = clampAdvanceMinutes(o.task);
  }
  if (typeof o.project === 'number' && Number.isFinite(o.project)) {
    base.project = clampAdvanceMinutes(o.project);
  }
  if (typeof o.habit === 'number' && Number.isFinite(o.habit)) {
    base.habit = clampAdvanceMinutes(o.habit);
  }
  return base;
}

function clampDueSoonWindowDays(n: number): number {
  return Math.max(1, Math.min(3, Math.round(n)));
}

function clampProjectStaleDays(n: number): number {
  return Math.max(1, Math.min(14, Math.round(n)));
}

function normalizeSchedule(raw: unknown): ScheduleSlotReminderPrefs {
  const base: ScheduleSlotReminderPrefs = {
    advanceMinutes: DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS.advanceMinutes,
    advanceByKind: { ...DEFAULT_SCHEDULE_SLOT_ADVANCE_BY_KIND },
    dueSoonWindowDays: DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS.dueSoonWindowDays,
    projectStaleDays: DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS.projectStaleDays,
    overdueStickyEnabled: DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS.overdueStickyEnabled,
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.advanceMinutes === 'number' && Number.isFinite(o.advanceMinutes)) {
    base.advanceMinutes = clampAdvanceMinutes(o.advanceMinutes);
  }
  const hasByKind =
    o.advanceByKind && typeof o.advanceByKind === 'object' && !Array.isArray(o.advanceByKind);
  base.advanceByKind = normalizeAdvanceByKind(
    hasByKind ? o.advanceByKind : null,
    base.advanceMinutes,
  );
  // 全局字段与 task 对齐，便于旧 UI 只改 advanceMinutes 时仍合理
  if (!hasByKind) {
    base.advanceByKind.task = base.advanceMinutes;
    base.advanceByKind.habit = base.advanceMinutes;
  } else {
    base.advanceMinutes = base.advanceByKind.task;
  }
  if (typeof o.dueSoonWindowDays === 'number' && Number.isFinite(o.dueSoonWindowDays)) {
    base.dueSoonWindowDays = clampDueSoonWindowDays(o.dueSoonWindowDays);
  }
  if (typeof o.projectStaleDays === 'number' && Number.isFinite(o.projectStaleDays)) {
    base.projectStaleDays = clampProjectStaleDays(o.projectStaleDays);
  }
  if (typeof o.overdueStickyEnabled === 'boolean') {
    base.overdueStickyEnabled = o.overdueStickyEnabled;
  }
  return base;
}

function normalizeBudgetNotifiedByPeriod(
  raw: unknown,
): FinanceReminderPrefs['budgetNotifiedByPeriod'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FinanceReminderPrefs['budgetNotifiedByPeriod'] = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    out[key] = {
      ...(o.t50 === true ? { t50: true } : {}),
      ...(o.t80 === true ? { t80: true } : {}),
      ...(o.over === true ? { over: true } : {}),
    };
  }
  return out;
}

function normalizeFinance(raw: unknown): FinanceReminderPrefs {
  const base: FinanceReminderPrefs = {
    ...DEFAULT_FINANCE_REMINDER_PREFS,
    budgetNotifiedByPeriod: {},
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.scheduledAdvanceMinutes === 'number' && Number.isFinite(o.scheduledAdvanceMinutes)) {
    base.scheduledAdvanceMinutes = clampFinanceAdvanceMinutes(o.scheduledAdvanceMinutes);
  }
  base.scheduledEveningWrapEnabled = o.scheduledEveningWrapEnabled !== false;
  if (typeof o.scheduledEveningWrapHour === 'number' && Number.isFinite(o.scheduledEveningWrapHour)) {
    base.scheduledEveningWrapHour = clampHour(o.scheduledEveningWrapHour);
  }
  if (
    typeof o.scheduledEveningWrapMinute === 'number' &&
    Number.isFinite(o.scheduledEveningWrapMinute)
  ) {
    base.scheduledEveningWrapMinute = clampMinute(o.scheduledEveningWrapMinute);
  }
  base.budgetNotify50 = o.budgetNotify50 === true;
  base.budgetNotify80 = o.budgetNotify80 !== false;
  base.budgetNotifyOver = o.budgetNotifyOver !== false;
  base.budgetNotifiedByPeriod = normalizeBudgetNotifiedByPeriod(o.budgetNotifiedByPeriod);
  if (typeof o.savingsNudgeWeekday === 'number' && Number.isFinite(o.savingsNudgeWeekday)) {
    base.savingsNudgeWeekday = clampWeekday(o.savingsNudgeWeekday);
  }
  if (typeof o.savingsNudgeHour === 'number' && Number.isFinite(o.savingsNudgeHour)) {
    base.savingsNudgeHour = clampHour(o.savingsNudgeHour);
  }
  if (typeof o.savingsNudgeMinute === 'number' && Number.isFinite(o.savingsNudgeMinute)) {
    base.savingsNudgeMinute = clampMinute(o.savingsNudgeMinute);
  }
  if (typeof o.ledgerWrapHour === 'number' && Number.isFinite(o.ledgerWrapHour)) {
    base.ledgerWrapHour = clampHour(o.ledgerWrapHour);
  }
  if (typeof o.ledgerWrapMinute === 'number' && Number.isFinite(o.ledgerWrapMinute)) {
    base.ledgerWrapMinute = clampMinute(o.ledgerWrapMinute);
  }
  if (typeof o.ledgerWrapMuteYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.ledgerWrapMuteYmd.trim())) {
    base.ledgerWrapMuteYmd = o.ledgerWrapMuteYmd.trim();
  } else {
    base.ledgerWrapMuteYmd = null;
  }
  return base;
}

/** 取某主体类型的入格提前分钟数 */
export function resolveScheduleAdvanceMinutes(
  schedule: ScheduleSlotReminderPrefs,
  kind: ScheduleSlotSubjectKind,
): number {
  const fromKind = schedule.advanceByKind?.[kind];
  if (typeof fromKind === 'number' && Number.isFinite(fromKind)) {
    return clampAdvanceMinutes(fromKind);
  }
  return clampAdvanceMinutes(schedule.advanceMinutes);
}

function normalizeCategories(raw: unknown): NotificationCategoryPrefs {
  const base = { ...DEFAULT_CATEGORIES };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  for (const cat of NOTIFICATION_CATEGORIES) {
    if (typeof o[cat.id] === 'boolean') {
      base[cat.id] = o[cat.id] as boolean;
    }
  }
  // 旧版 task-reminder → schedule-slot-reminder（读兼容）
  if (typeof o['task-reminder'] === 'boolean' && typeof o['schedule-slot-reminder'] !== 'boolean') {
    base['schedule-slot-reminder'] = o['task-reminder'] as boolean;
  }
  // 截止提醒缺省跟随日程格开关（旧数据无独立键）
  if (typeof o['task-deadline-reminder'] !== 'boolean') {
    base['task-deadline-reminder'] = base['schedule-slot-reminder'];
  }
  if (typeof o['project-progress-reminder'] !== 'boolean') {
    base['project-progress-reminder'] = base['schedule-slot-reminder'];
  }
  return base;
}

function normalizeMuted(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeSettings(raw: unknown): NotificationCenterSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ...DEFAULT_NOTIFICATION_CENTER_SETTINGS,
      categories: { ...DEFAULT_CATEGORIES },
      health: normalizeHealth(null),
      schedule: normalizeSchedule(null),
      finance: normalizeFinance(null),
    };
  }
  const o = raw as Record<string, unknown>;
  return {
    masterEnabled: o.masterEnabled === false ? false : true,
    categories: normalizeCategories(o.categories),
    mutedIdentifiers: normalizeMuted(o.mutedIdentifiers),
    health: normalizeHealth(o.health),
    schedule: normalizeSchedule(o.schedule),
    finance: normalizeFinance(o.finance),
  };
}

export async function getNotificationCenterSettings(): Promise<NotificationCenterSettings> {
  const raw = await getAppSetting<unknown>(AppSettingKey.notificationsCenter);
  return normalizeSettings(raw);
}

export async function setNotificationCenterSettings(
  next: NotificationCenterSettings,
): Promise<NotificationCenterSettings> {
  const normalized = normalizeSettings(next);
  await setAppSetting(AppSettingKey.notificationsCenter, normalized);
  return normalized;
}

export async function patchNotificationCenterSettings(patch: {
  masterEnabled?: boolean;
  categories?: Partial<NotificationCategoryPrefs>;
  mutedIdentifiers?: string[];
  health?: Partial<HealthIntakeReminderPrefs>;
  schedule?: Partial<ScheduleSlotReminderPrefs> & {
    advanceByKind?: Partial<ScheduleSlotAdvanceByKind>;
  };
  finance?: Partial<FinanceReminderPrefs> & {
    budgetNotifiedByPeriod?: FinanceReminderPrefs['budgetNotifiedByPeriod'];
  };
}): Promise<NotificationCenterSettings> {
  const current = await getNotificationCenterSettings();
  let nextSchedule = current.schedule;
  if (patch.schedule) {
    const mergedByKind = patch.schedule.advanceByKind
      ? {
          ...current.schedule.advanceByKind,
          ...patch.schedule.advanceByKind,
        }
      : current.schedule.advanceByKind;
    const mergedRaw = {
      ...current.schedule,
      ...patch.schedule,
      advanceByKind: mergedByKind,
    };
    // 仅改全局 advanceMinutes、未显式改 byKind 时：同步三类（项目仍可更轻）
    if (
      typeof patch.schedule.advanceMinutes === 'number' &&
      !patch.schedule.advanceByKind
    ) {
      const g = clampAdvanceMinutes(patch.schedule.advanceMinutes);
      mergedRaw.advanceByKind = {
        task: g,
        habit: g,
        project: Math.min(g, DEFAULT_SCHEDULE_SLOT_ADVANCE_BY_KIND.project),
      };
    }
    nextSchedule = normalizeSchedule(mergedRaw);
  }
  const nextFinance = patch.finance
    ? normalizeFinance({
        ...current.finance,
        ...patch.finance,
        budgetNotifiedByPeriod:
          patch.finance.budgetNotifiedByPeriod ?? current.finance.budgetNotifiedByPeriod,
      })
    : current.finance;
  const next: NotificationCenterSettings = {
    masterEnabled:
      typeof patch.masterEnabled === 'boolean' ? patch.masterEnabled : current.masterEnabled,
    categories: patch.categories
      ? { ...current.categories, ...patch.categories }
      : current.categories,
    mutedIdentifiers: Array.isArray(patch.mutedIdentifiers)
      ? normalizeMuted(patch.mutedIdentifiers)
      : current.mutedIdentifiers,
    health: patch.health ? normalizeHealth({ ...current.health, ...patch.health }) : current.health,
    schedule: nextSchedule,
    finance: nextFinance,
  };
  return setNotificationCenterSettings(next);
}

/** 是否允许登记/展示某一类通知（含总开关与频道开关）。 */
export async function isNotificationCategoryAllowed(
  category: NotificationCategoryId,
): Promise<boolean> {
  const settings = await getNotificationCenterSettings();
  if (!settings.masterEnabled) return false;
  return settings.categories[category] !== false;
}

export async function isNotificationIdentifierMuted(identifier: string): Promise<boolean> {
  const id = identifier.trim();
  if (!id) return false;
  const settings = await getNotificationCenterSettings();
  return settings.mutedIdentifiers.includes(id);
}

export async function muteNotificationIdentifier(identifier: string): Promise<NotificationCenterSettings> {
  const id = identifier.trim();
  const current = await getNotificationCenterSettings();
  if (!id || current.mutedIdentifiers.includes(id)) return current;
  return patchNotificationCenterSettings({
    mutedIdentifiers: [...current.mutedIdentifiers, id],
  });
}

export async function unmuteNotificationIdentifier(
  identifier: string,
): Promise<NotificationCenterSettings> {
  const id = identifier.trim();
  const current = await getNotificationCenterSettings();
  if (!id) return current;
  return patchNotificationCenterSettings({
    mutedIdentifiers: current.mutedIdentifiers.filter(x => x !== id),
  });
}

/** 登记前统一门禁：总开关、频道、单条静音。 */
export async function canScheduleAppNotification(params: {
  category: NotificationCategoryId;
  identifier?: string | null;
}): Promise<boolean> {
  if (!(await isNotificationCategoryAllowed(params.category))) return false;
  const id = params.identifier?.trim();
  if (id && (await isNotificationIdentifierMuted(id))) return false;
  return true;
}

export function healthFocusKeyLabel(key: HealthIntakeFocusKey): string {
  switch (key) {
    case 'hydration':
      return '水分';
    case 'protein':
      return '蛋白质';
    case 'carbohydrate':
      return '碳水';
    case 'calories':
      return '热量';
  }
}

export function healthReminderModeLabel(mode: HealthIntakeReminderMode): string {
  switch (mode) {
    case 'meal_windows':
      return '餐次提醒';
    case 'evening_wrap':
      return '傍晚收口';
    case 'hydration_interval':
      return '水分间隔';
  }
}
