/**
 * iOS 强提醒：Time Sensitive、自定义铃声、未确认升级、完成/贪睡 Action。
 * 纯规则与副作用入口集中在此，供 scheduler / router / 处置页共用。
 */

import type { NotificationCategoryId } from './notification-catalog';

/** 与 app.json expo-notifications.sounds 文件名一致（不含路径） */
export const STRONG_REMINDER_SOUND = 'strong_reminder.wav';

export const STRONG_REMINDER_CATEGORY_ID = 'strong-reminder';

export const STRONG_ACTION_COMPLETE = 'STRONG_COMPLETE';
export const STRONG_ACTION_SNOOZE = 'STRONG_SNOOZE';

/** 相对主提醒的升级偏移（分钟）：+5、+15 */
export const STRONG_ESCALATION_OFFSET_MINUTES = [5, 15] as const;

export const STRONG_SNOOZE_MINUTES = 10;

const STRONG_CATEGORIES: ReadonlySet<NotificationCategoryId> = new Set([
  'habit-reminder',
  'schedule-slot-reminder',
  'daily-review-reminder',
]);

const ACCESSORY_SUFFIX_RE = /:(?:esc:\d+|snooze)$/i;

export function isStrongReminderCategory(category: NotificationCategoryId): boolean {
  return STRONG_CATEGORIES.has(category);
}

/** 去掉升级/贪睡后缀，得到业务主 identifier */
export function stripReminderAccessorySuffix(identifier: string): string {
  let id = identifier.trim();
  // 支持多次剥除（如 :snooze 后再挂 :esc:1 的极端残留）
  for (let i = 0; i < 3; i++) {
    const next = id.replace(ACCESSORY_SUFFIX_RE, '');
    if (next === id) break;
    id = next;
  }
  return id;
}

export function escalationIdentifier(baseIdentifier: string, wave: number): string {
  const base = stripReminderAccessorySuffix(baseIdentifier);
  const w = Math.max(1, Math.floor(wave));
  return `${base}:esc:${w}`;
}

export function isEscalationOrSnoozeIdentifier(identifier: string): boolean {
  const id = identifier.trim();
  return /:(?:esc:\d+|snooze)$/i.test(id);
}

export function maxStrongEscalationWave(): number {
  return STRONG_ESCALATION_OFFSET_MINUTES.length;
}

/** 主提醒为 wave 0；升级 1..N。仅最终一波送达后才应重排「下一天」。 */
export function shouldRescheduleAfterDelivery(data: {
  strong?: unknown;
  escalationWave?: unknown;
  maxEscalationWave?: unknown;
}): boolean {
  const strong = data.strong === true || data.strong === 1 || data.strong === 'true';
  if (!strong) return true;
  const wave = Number(data.escalationWave ?? 0);
  const maxWave = Number(data.maxEscalationWave ?? 0);
  if (!Number.isFinite(wave) || !Number.isFinite(maxWave)) return true;
  return wave >= maxWave;
}

export function computeEscalationFireAts(
  primaryFireAt: Date,
  nowMs: number = Date.now(),
  pastSlackMs: number = 2000,
): { wave: number; fireAt: Date }[] {
  const out: { wave: number; fireAt: Date }[] = [];
  STRONG_ESCALATION_OFFSET_MINUTES.forEach((mins, idx) => {
    const fireAt = new Date(primaryFireAt.getTime() + mins * 60_000);
    if (fireAt.getTime() <= nowMs + pastSlackMs) return;
    out.push({ wave: idx + 1, fireAt });
  });
  return out;
}

export function snoozeFireAt(
  fromMs: number = Date.now(),
  snoozeMinutes: number = STRONG_SNOOZE_MINUTES,
): Date {
  return new Date(fromMs + Math.max(1, snoozeMinutes) * 60_000);
}

export type StrongReminderPayload = {
  baseIdentifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export function parseStrongReminderPayload(raw: unknown): StrongReminderPayload | null {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseStrongReminderPayload(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const baseIdentifier =
    typeof o.baseIdentifier === 'string'
      ? stripReminderAccessorySuffix(o.baseIdentifier)
      : '';
  if (!baseIdentifier) return null;
  const title = typeof o.title === 'string' ? o.title : '提醒';
  const body = typeof o.body === 'string' ? o.body : '';
  const data =
    o.data && typeof o.data === 'object' && !Array.isArray(o.data)
      ? (o.data as Record<string, unknown>)
      : {};
  return { baseIdentifier, title, body, data };
}

export function serializeStrongReminderPayload(payload: StrongReminderPayload): string {
  return JSON.stringify({
    baseIdentifier: payload.baseIdentifier,
    title: payload.title,
    body: payload.body,
    data: payload.data,
  });
}

let categoryEnsured = false;

/** 注册完成 / 贪睡 Action（幂等）。 */
export async function ensureStrongReminderNotificationCategory(
  Notifications?: typeof import('expo-notifications') | null,
): Promise<void> {
  if (categoryEnsured) return;
  try {
    const mod = Notifications ?? (await import('expo-notifications'));
    await mod.setNotificationCategoryAsync(STRONG_REMINDER_CATEGORY_ID, [
      {
        identifier: STRONG_ACTION_COMPLETE,
        buttonTitle: '完成',
        options: { opensAppToForeground: true },
      },
      {
        identifier: STRONG_ACTION_SNOOZE,
        buttonTitle: `贪睡 ${STRONG_SNOOZE_MINUTES} 分钟`,
        options: { opensAppToForeground: false },
      },
    ]);
    categoryEnsured = true;
  } catch (e) {
    console.warn('注册强提醒通知类别失败', e);
  }
}

/** 取消主提醒及其升级预约。 */
export async function acknowledgeStrongReminder(baseIdentifier: string): Promise<void> {
  const base = stripReminderAccessorySuffix(baseIdentifier);
  if (!base) return;
  const { cancelScheduledByIdentifier } = await import('@/lib/notification-scheduler');
  await cancelScheduledByIdentifier(base);
}

/**
 * 贪睡：清掉当前链，按原业务参数在 N 分钟后重新登记强提醒（含新的升级链）。
 */
export async function snoozeStrongReminder(params: {
  category: NotificationCategoryId;
  baseIdentifier: string;
  channel: {
    id: string;
    name: string;
    importance?: 'default' | 'high';
    vibrationPattern?: number[];
  };
  data: Record<string, unknown>;
  fallback: { title: string; body: string };
  fingerprint: string;
  contextBlock: string;
}): Promise<void> {
  const {
    scheduleDateReminder,
    cancelScheduledByIdentifier,
  } = await import('@/lib/notification-scheduler');
  const base = stripReminderAccessorySuffix(params.baseIdentifier);
  await cancelScheduledByIdentifier(base);
  const fireAt = snoozeFireAt();
  await scheduleDateReminder({
    category: params.category,
    identifier: base,
    fireAt,
    channel: params.channel,
    data: { ...params.data, snoozed: true },
    fallback: params.fallback,
    fingerprint: `${params.fingerprint}|snooze|${fireAt.toISOString().slice(0, 16)}`,
    contextBlock: params.contextBlock,
    strong: true,
  });
}
