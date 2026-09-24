import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import type { NotificationCategoryId } from '@/lib/notification-catalog';
import { NOTIFICATION_CATEGORIES } from '@/lib/notification-catalog';

export type NotificationCategoryPrefs = Record<NotificationCategoryId, boolean>;

export type HealthIntakeReminderMode = 'fixed' | 'interval';
export type HealthIntakeIntervalMinutes = 30 | 60 | 120;

export type HealthIntakeReminderPrefs = {
  mode: HealthIntakeReminderMode;
  /** 固定时刻（本地），默认 20:00 */
  fixedHour: number;
  fixedMinute: number;
  /** 间隔模式分钟数 */
  intervalMinutes: HealthIntakeIntervalMinutes;
  /** 免打扰起止，默认 23:00–07:00（可跨午夜） */
  quietStartHour: number;
  quietStartMinute: number;
  quietEndHour: number;
  quietEndMinute: number;
};

export type ScheduleSlotReminderPrefs = {
  /** 格子开始前多少分钟提醒，5–60，默认 15 */
  advanceMinutes: number;
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
};

const DEFAULT_CATEGORIES: NotificationCategoryPrefs = {
  'health-intake-reminder': true,
  'schedule-slot-reminder': true,
  'habit-reminder': true,
  'daily-review-reminder': true,
  'auto-ledger': true,
};

export const DEFAULT_HEALTH_INTAKE_REMINDER_PREFS: HealthIntakeReminderPrefs = {
  mode: 'fixed',
  fixedHour: 20,
  fixedMinute: 0,
  intervalMinutes: 60,
  quietStartHour: 23,
  quietStartMinute: 0,
  quietEndHour: 7,
  quietEndMinute: 0,
};

export const DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS: ScheduleSlotReminderPrefs = {
  advanceMinutes: 15,
};

export const DEFAULT_NOTIFICATION_CENTER_SETTINGS: NotificationCenterSettings = {
  masterEnabled: true,
  categories: { ...DEFAULT_CATEGORIES },
  mutedIdentifiers: [],
  health: { ...DEFAULT_HEALTH_INTAKE_REMINDER_PREFS },
  schedule: { ...DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS },
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

function normalizeIntervalMinutes(raw: unknown): HealthIntakeIntervalMinutes {
  if (raw === 30 || raw === 60 || raw === 120) return raw;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 30 || n === 60 || n === 120) return n;
  return DEFAULT_HEALTH_INTAKE_REMINDER_PREFS.intervalMinutes;
}

function normalizeHealth(raw: unknown): HealthIntakeReminderPrefs {
  const base = { ...DEFAULT_HEALTH_INTAKE_REMINDER_PREFS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  if (o.mode === 'fixed' || o.mode === 'interval') base.mode = o.mode;
  if (typeof o.fixedHour === 'number' && Number.isFinite(o.fixedHour)) {
    base.fixedHour = clampHour(o.fixedHour);
  }
  if (typeof o.fixedMinute === 'number' && Number.isFinite(o.fixedMinute)) {
    base.fixedMinute = clampMinute(o.fixedMinute);
  }
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
  return base;
}

function normalizeSchedule(raw: unknown): ScheduleSlotReminderPrefs {
  const base = { ...DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.advanceMinutes === 'number' && Number.isFinite(o.advanceMinutes)) {
    base.advanceMinutes = clampAdvanceMinutes(o.advanceMinutes);
  }
  return base;
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
      health: { ...DEFAULT_HEALTH_INTAKE_REMINDER_PREFS },
      schedule: { ...DEFAULT_SCHEDULE_SLOT_REMINDER_PREFS },
    };
  }
  const o = raw as Record<string, unknown>;
  return {
    masterEnabled: o.masterEnabled === false ? false : true,
    categories: normalizeCategories(o.categories),
    mutedIdentifiers: normalizeMuted(o.mutedIdentifiers),
    health: normalizeHealth(o.health),
    schedule: normalizeSchedule(o.schedule),
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
  schedule?: Partial<ScheduleSlotReminderPrefs>;
}): Promise<NotificationCenterSettings> {
  const current = await getNotificationCenterSettings();
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
    schedule: patch.schedule
      ? normalizeSchedule({ ...current.schedule, ...patch.schedule })
      : current.schedule,
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
