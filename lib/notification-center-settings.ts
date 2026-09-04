import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import type { NotificationCategoryId } from '@/lib/notification-catalog';
import { NOTIFICATION_CATEGORIES } from '@/lib/notification-catalog';

export type NotificationCategoryPrefs = Record<NotificationCategoryId, boolean>;

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
};

const DEFAULT_CATEGORIES: NotificationCategoryPrefs = {
  'task-reminder': true,
  'habit-reminder': true,
  'daily-review-reminder': true,
  'auto-ledger': true,
};

export const DEFAULT_NOTIFICATION_CENTER_SETTINGS: NotificationCenterSettings = {
  masterEnabled: true,
  categories: { ...DEFAULT_CATEGORIES },
  mutedIdentifiers: [],
};

function normalizeCategories(raw: unknown): NotificationCategoryPrefs {
  const base = { ...DEFAULT_CATEGORIES };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  for (const cat of NOTIFICATION_CATEGORIES) {
    if (typeof o[cat.id] === 'boolean') {
      base[cat.id] = o[cat.id] as boolean;
    }
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
    return { ...DEFAULT_NOTIFICATION_CENTER_SETTINGS, categories: { ...DEFAULT_CATEGORIES } };
  }
  const o = raw as Record<string, unknown>;
  return {
    masterEnabled: o.masterEnabled === false ? false : true,
    categories: normalizeCategories(o.categories),
    mutedIdentifiers: normalizeMuted(o.mutedIdentifiers),
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
