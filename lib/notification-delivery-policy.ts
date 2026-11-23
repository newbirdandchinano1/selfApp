/**
 * 通知送达策略（纯规则）：全局免打扰、日预算、最小间隔、傍晚收口错峰。
 * 供 Node 单测与 scheduler 共用；不触达通知 API / 存储。
 */

import type { NotificationCategoryId } from './notification-catalog';

export type DeliveryQuietPrefs = {
  quietStartHour: number;
  quietStartMinute: number;
  quietEndHour: number;
  quietEndMinute: number;
};

export type DeliveryBudgetPrefs = {
  /** 每个自然日最多系统弹出条数（不含升级链附属） */
  maxSystemPerDay: number;
  /** 任意两条系统通知的最小间隔（分钟） */
  minIntervalMinutes: number;
};

export type DeliveryEveningWrapPrefs = {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  /** 收口窗内最多系统弹出 */
  maxSystem: number;
  /** 同窗错峰步长（分钟） */
  staggerMinutes: number;
};

/** 跨频道默认提醒强度 */
export type DeliveryIntensity = 'soft' | 'normal' | 'strong';

export type DeliveryPolicyPrefs = DeliveryQuietPrefs &
  DeliveryBudgetPrefs & {
    eveningWrap: DeliveryEveningWrapPrefs;
    /**
     * 安静模式：仍登记/写入 Inbox，系统横幅与声音一律关闭。
     * 适合开会、睡觉前临时「只记不吵」。
     */
    inboxOnly: boolean;
    /**
     * 跨频道默认强度：
     * - soft：强制不走强提醒升级链
     * - normal：仅业务显式 strong 才升级（默认）
     * - strong：可强提醒频道默认升级（习惯显式 soft 仍可覆盖）
     */
    intensity: DeliveryIntensity;
  };

export const DEFAULT_DELIVERY_POLICY_PREFS: DeliveryPolicyPrefs = {
  quietStartHour: 23,
  quietStartMinute: 0,
  quietEndHour: 7,
  quietEndMinute: 0,
  maxSystemPerDay: 8,
  minIntervalMinutes: 4,
  eveningWrap: {
    startHour: 19,
    startMinute: 30,
    endHour: 21,
    endMinute: 0,
    maxSystem: 4,
    staggerMinutes: 4,
  },
  inboxOnly: false,
  intensity: 'normal',
};

export function normalizeDeliveryIntensity(raw: unknown): DeliveryIntensity {
  if (raw === 'soft' || raw === 'normal' || raw === 'strong') return raw;
  return 'normal';
}

/**
 * 解析最终是否强提醒。
 * @param explicit 业务传入的 strong（undefined=未声明）
 */
export function resolveDeliveryStrong(params: {
  intensity: DeliveryIntensity;
  explicit?: boolean;
  categoryEligible: boolean;
}): boolean {
  if (params.intensity === 'soft') return false;
  if (params.explicit === true) return true;
  if (params.explicit === false) return false;
  return params.intensity === 'strong' && params.categoryEligible;
}

export type FirePlanCandidate = {
  id: string;
  category: NotificationCategoryId;
  fireAtMs: number;
  /** 越小越优先保留 */
  priority: number;
  /** 傍晚收口类（参与同窗错峰与限额） */
  isWrap: boolean;
  /** 强提醒：仍受免打扰，但尽量不被日预算挤掉 */
  strong: boolean;
};

export type FirePlanResult = {
  id: string;
  fireAtMs: number;
  /** system=登记系统通知；drop=本轮不登记（避免扎堆） */
  mode: 'system' | 'drop';
  reason?: string;
};

function minutesOfDay(hour: number, minute: number): number {
  return Math.max(0, Math.min(23, Math.floor(hour))) * 60 +
    Math.max(0, Math.min(59, Math.floor(minute)));
}

function clampHour(n: number): number {
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function clampMinute(n: number): number {
  return Math.max(0, Math.min(59, Math.floor(Number.isFinite(n) ? n : 0)));
}

export function isInQuietHours(date: Date, prefs: DeliveryQuietPrefs): boolean {
  const t = minutesOfDay(date.getHours(), date.getMinutes());
  const start = minutesOfDay(prefs.quietStartHour, prefs.quietStartMinute);
  const end = minutesOfDay(prefs.quietEndHour, prefs.quietEndMinute);
  if (start === end) return false;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

/** 落在免打扰内则延后到结束时刻 */
export function deferOutOfQuietHours(date: Date, prefs: DeliveryQuietPrefs): Date {
  if (!isInQuietHours(date, prefs)) return new Date(date.getTime());
  const end = new Date(date);
  end.setHours(clampHour(prefs.quietEndHour), clampMinute(prefs.quietEndMinute), 0, 0);
  if (end.getTime() <= date.getTime()) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

export function isInEveningWrapWindow(date: Date, wrap: DeliveryEveningWrapPrefs): boolean {
  const t = minutesOfDay(date.getHours(), date.getMinutes());
  const start = minutesOfDay(wrap.startHour, wrap.startMinute);
  const end = minutesOfDay(wrap.endHour, wrap.endMinute);
  if (start === end) return false;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

/** 自然日键 YYYY-MM-DD（本地） */
export function localYmdFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 频道优先级：数字越小越优先在收口窗/日预算中保留。
 * 强提醒 / 截止类靠前；储蓄轻催等靠后。
 */
export function categoryDeliveryPriority(category: NotificationCategoryId): number {
  switch (category) {
    case 'task-deadline-reminder':
      return 10;
    case 'schedule-slot-reminder':
      return 20;
    case 'habit-reminder':
      return 30;
    case 'daily-review-reminder':
      return 40;
    case 'weekly-review-reminder':
      return 45;
    case 'health-intake-reminder':
      return 50;
    case 'finance-scheduled-expense-reminder':
      return 55;
    case 'finance-budget-threshold-reminder':
      return 60;
    case 'project-progress-reminder':
      return 70;
    case 'finance-ledger-wrap-reminder':
      return 80;
    case 'finance-savings-nudge-reminder':
      return 90;
    case 'auto-ledger':
      return 95;
    default:
      return 100;
  }
}

/** 根据 data 字段判断是否收口类 */
export function isWrapNotificationData(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (data.wave === 'evening_wrap') return true;
  if (data.role === 'wrap') return true;
  if (data.slotKind === 'evening_wrap') return true;
  if (data.type === 'finance-ledger-wrap-reminder') return true;
  return false;
}

function floorToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

/**
 * 在已占用时刻集合上，找 ≥ preferred 且与占用间隔 ≥ minInterval 的最近分钟。
 * 若给了 windowEndMs，不得超过该时刻。
 */
export function findNextAvailableSlot(params: {
  preferredMs: number;
  occupiedMs: Iterable<number>;
  minIntervalMinutes: number;
  windowEndMs?: number | null;
  maxSteps?: number;
}): number | null {
  const minGap = Math.max(0, Math.floor(params.minIntervalMinutes)) * 60_000;
  const occupied = [...params.occupiedMs].map(floorToMinute).sort((a, b) => a - b);
  let cursor = floorToMinute(params.preferredMs);
  const maxSteps = params.maxSteps ?? 48;

  for (let step = 0; step < maxSteps; step += 1) {
    if (params.windowEndMs != null && cursor >= params.windowEndMs) return null;
    const conflict = occupied.some(o => Math.abs(o - cursor) < minGap);
    if (!conflict) return cursor;
    cursor += Math.max(60_000, minGap);
  }
  return null;
}

function eveningWindowBoundsOnDay(day: Date, wrap: DeliveryEveningWrapPrefs): {
  startMs: number;
  endMs: number;
} {
  const start = new Date(day);
  start.setHours(clampHour(wrap.startHour), clampMinute(wrap.startMinute), 0, 0);
  const end = new Date(day);
  end.setHours(clampHour(wrap.endHour), clampMinute(wrap.endMinute), 0, 0);
  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1);
  }
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * 批量规划 fireAt：免打扰延后 → 收口错峰 → 日预算 / 最小间隔。
 * `occupiedMs` 为已登记（其它 identifier）的触发时刻。
 */
export function planNotificationFireAts(
  candidates: FirePlanCandidate[],
  prefs: DeliveryPolicyPrefs,
  occupiedMs: number[] = [],
): FirePlanResult[] {
  if (candidates.length === 0) return [];

  const minInterval = Math.max(0, Math.floor(prefs.minIntervalMinutes));
  const maxPerDay = Math.max(1, Math.floor(prefs.maxSystemPerDay));
  const wrapMax = Math.max(1, Math.floor(prefs.eveningWrap.maxSystem));
  const stagger = Math.max(1, Math.floor(prefs.eveningWrap.staggerMinutes));

  // 1) 免打扰
  const deferred = candidates.map(c => {
    const next = deferOutOfQuietHours(new Date(c.fireAtMs), prefs);
    return { ...c, fireAtMs: next.getTime() };
  });

  // 2) 按时间 + 优先级排序（同时刻优先保留高优先级）
  const sorted = [...deferred].sort((a, b) => {
    if (a.fireAtMs !== b.fireAtMs) return a.fireAtMs - b.fireAtMs;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  const occupied = new Set(occupiedMs.map(floorToMinute));
  const dayCounts = new Map<string, number>();
  const wrapCounts = new Map<string, number>(); // key = ymd of wrap window start day

  // 预填已占用对日计数（近似：已登记也占预算）
  for (const ms of occupied) {
    const ymd = localYmdFromMs(ms);
    dayCounts.set(ymd, (dayCounts.get(ymd) ?? 0) + 1);
    const d = new Date(ms);
    if (isInEveningWrapWindow(d, prefs.eveningWrap)) {
      wrapCounts.set(ymd, (wrapCounts.get(ymd) ?? 0) + 1);
    }
  }

  const results: FirePlanResult[] = [];

  for (const c of sorted) {
    let fireAtMs = floorToMinute(c.fireAtMs);
    const day = new Date(fireAtMs);
    const inWrap = c.isWrap || isInEveningWrapWindow(day, prefs.eveningWrap);
    const bounds = eveningWindowBoundsOnDay(day, prefs.eveningWrap);
    const ymd = localYmdFromMs(fireAtMs);

    if (inWrap) {
      // 收口：钳到窗内起点之后，再错峰
      if (fireAtMs < bounds.startMs) fireAtMs = bounds.startMs;
      if (fireAtMs >= bounds.endMs) {
        results.push({ id: c.id, fireAtMs: c.fireAtMs, mode: 'drop', reason: 'outside_wrap_window' });
        continue;
      }
      const wrapKey = localYmdFromMs(bounds.startMs);
      const wrapUsed = wrapCounts.get(wrapKey) ?? 0;
      if (wrapUsed >= wrapMax && !c.strong) {
        results.push({ id: c.id, fireAtMs, mode: 'drop', reason: 'wrap_cap' });
        continue;
      }
      const slot = findNextAvailableSlot({
        preferredMs: fireAtMs,
        occupiedMs: occupied,
        minIntervalMinutes: Math.max(minInterval, stagger),
        windowEndMs: bounds.endMs,
      });
      if (slot == null) {
        results.push({ id: c.id, fireAtMs, mode: 'drop', reason: 'wrap_no_slot' });
        continue;
      }
      fireAtMs = slot;
    } else {
      const slot = findNextAvailableSlot({
        preferredMs: fireAtMs,
        occupiedMs: occupied,
        minIntervalMinutes: minInterval,
      });
      if (slot == null) {
        results.push({ id: c.id, fireAtMs, mode: 'drop', reason: 'no_slot' });
        continue;
      }
      fireAtMs = slot;
    }

    const finalYmd = localYmdFromMs(fireAtMs);
    const dayUsed = dayCounts.get(finalYmd) ?? 0;
    if (dayUsed >= maxPerDay && !c.strong) {
      results.push({ id: c.id, fireAtMs, mode: 'drop', reason: 'day_cap' });
      continue;
    }

    // 再次免打扰（错峰可能推入 quiet）
    const afterQuiet = deferOutOfQuietHours(new Date(fireAtMs), prefs);
    fireAtMs = floorToMinute(afterQuiet.getTime());

    occupied.add(fireAtMs);
    dayCounts.set(finalYmd, (dayCounts.get(finalYmd) ?? 0) + 1);
    if (isInEveningWrapWindow(new Date(fireAtMs), prefs.eveningWrap)) {
      const wk = localYmdFromMs(fireAtMs);
      wrapCounts.set(wk, (wrapCounts.get(wk) ?? 0) + 1);
    }

    results.push({ id: c.id, fireAtMs, mode: 'system' });
  }

  return results;
}

export function normalizeDeliveryPolicyPrefs(raw: unknown): DeliveryPolicyPrefs {
  const base: DeliveryPolicyPrefs = {
    ...DEFAULT_DELIVERY_POLICY_PREFS,
    eveningWrap: { ...DEFAULT_DELIVERY_POLICY_PREFS.eveningWrap },
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.quietStartHour === 'number') base.quietStartHour = clampHour(o.quietStartHour);
  if (typeof o.quietStartMinute === 'number') base.quietStartMinute = clampMinute(o.quietStartMinute);
  if (typeof o.quietEndHour === 'number') base.quietEndHour = clampHour(o.quietEndHour);
  if (typeof o.quietEndMinute === 'number') base.quietEndMinute = clampMinute(o.quietEndMinute);
  if (typeof o.maxSystemPerDay === 'number' && Number.isFinite(o.maxSystemPerDay)) {
    base.maxSystemPerDay = Math.max(1, Math.min(20, Math.floor(o.maxSystemPerDay)));
  }
  if (typeof o.minIntervalMinutes === 'number' && Number.isFinite(o.minIntervalMinutes)) {
    base.minIntervalMinutes = Math.max(0, Math.min(30, Math.floor(o.minIntervalMinutes)));
  }
  if (typeof o.inboxOnly === 'boolean') base.inboxOnly = o.inboxOnly;
  base.intensity = normalizeDeliveryIntensity(o.intensity);
  const ew = o.eveningWrap;
  if (ew && typeof ew === 'object' && !Array.isArray(ew)) {
    const w = ew as Record<string, unknown>;
    if (typeof w.startHour === 'number') base.eveningWrap.startHour = clampHour(w.startHour);
    if (typeof w.startMinute === 'number') base.eveningWrap.startMinute = clampMinute(w.startMinute);
    if (typeof w.endHour === 'number') base.eveningWrap.endHour = clampHour(w.endHour);
    if (typeof w.endMinute === 'number') base.eveningWrap.endMinute = clampMinute(w.endMinute);
    if (typeof w.maxSystem === 'number' && Number.isFinite(w.maxSystem)) {
      base.eveningWrap.maxSystem = Math.max(1, Math.min(10, Math.floor(w.maxSystem)));
    }
    if (typeof w.staggerMinutes === 'number' && Number.isFinite(w.staggerMinutes)) {
      base.eveningWrap.staggerMinutes = Math.max(1, Math.min(15, Math.floor(w.staggerMinutes)));
    }
  }
  return base;
}

/** 日程同分钟合并：展示文案 */
export function buildScheduleClusterCopy(titles: string[]): { title: string; body: string } {
  const cleaned = titles.map(t => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return { title: '接下来', body: '有几件事到点了' };
  if (cleaned.length === 1) return { title: '接下来', body: cleaned[0]! };
  if (cleaned.length === 2) {
    return { title: '接下来', body: `${cleaned[0]}、${cleaned[1]}` };
  }
  return {
    title: `接下来 · ${cleaned.length} 件`,
    body: `${cleaned[0]}、${cleaned[1]} 等`,
  };
}

/** 按触发分钟分组（同分钟多条合并用）。 */
export function partitionByFireAtMinute<T>(
  items: readonly T[],
  getFireAtMs: (item: T) => number,
): { minuteKey: number; items: T[] }[] {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const key = Math.floor(getFireAtMs(item) / 60_000);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([minuteKey, group]) => ({
    minuteKey,
    items: group,
  }));
}
