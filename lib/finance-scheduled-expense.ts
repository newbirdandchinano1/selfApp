import { AppSettingKey, getAppSetting, removeAppSetting, setAppSetting } from '@/lib/app-settings-store';
import { formatWallClockDatetimeLocal } from '@/lib/api-mysql-datetime';
import { makeTimestampEntityId } from '@/lib/entity-id';
import {
  createFinanceScheduledExpense,
  deleteFinanceScheduledExpense as deleteFinanceScheduledExpenseRow,
  getFinanceScheduledExpenseByIdLocal,
  listFinanceScheduledExpensesLocal,
  updateFinanceScheduledExpense,
} from '@/lib/repositories/finance/finance-scheduled-expense';
import type { FinanceScheduledExpenseRow } from '@/lib/repositories/finance/finance-scheduled-expense.types';
import { isTaskRepeatDueOnLogicalDay, type TaskRepeatSchedule } from '@/lib/task-repeat-rollover';

export type ScheduledExpenseRepeat = 'daily' | 'weekly' | 'monthly';

export type ScheduledFinanceExpense = {
  id: string;
  name: string;
  amount: number;
  accountId: string;
  repeatOption: ScheduledExpenseRepeat;
  weeklyDays: number[];
  monthlyDays: number[];
  hour: number;
  minute: number;
  /** 每个应记账日自动记几笔（每笔金额为 `amount`） */
  timesPerDay: number;
  flowCategoryId?: string | null;
  categoryKey?: string | null;
  categoryLabel?: string | null;
  includeInBudget: boolean;
  enabled: boolean;
  createdAt: string;
};

export type UpsertScheduledFinanceExpenseInput = Omit<ScheduledFinanceExpense, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const SETTINGS_MIGRATED_META = 'finance_scheduled_expenses_settings_migrated_v1';

function normalizeWeeklyDays(raw: unknown): number[] {
  if (typeof raw === 'string') {
    try {
      return normalizeWeeklyDays(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => (typeof x === 'number' ? Math.round(x) : parseInt(String(x), 10))).filter((n) => n >= 1 && n <= 7))].sort(
    (a, b) => a - b,
  );
}

function normalizeMonthlyDays(raw: unknown): number[] {
  if (typeof raw === 'string') {
    try {
      return normalizeMonthlyDays(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => (typeof x === 'number' ? Math.round(x) : parseInt(String(x), 10))).filter((n) => n >= 1 && n <= 31))].sort(
    (a, b) => a - b,
  );
}

function normalizeRepeatOption(raw: unknown): ScheduledExpenseRepeat {
  if (raw === 'weekly' || raw === 'monthly' || raw === 'daily') return raw;
  return 'daily';
}

function serializeDays(days: number[]): string {
  return JSON.stringify(days);
}

function boolFromDb(raw: unknown, defaultValue = true): boolean {
  if (raw === false || raw === 0 || raw === '0') return false;
  if (raw === true || raw === 1 || raw === '1') return true;
  if (raw == null) return defaultValue;
  return defaultValue;
}

function normalizeScheduledExpense(raw: unknown): ScheduledFinanceExpense | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const accountIdRaw = o.accountId ?? o.account_id;
  const accountId = typeof accountIdRaw === 'string' && accountIdRaw.trim() ? accountIdRaw.trim() : null;
  const amount = typeof o.amount === 'number' ? o.amount : Number(o.amount);
  if (!id || !name || !accountId) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const repeatOption = normalizeRepeatOption(o.repeatOption ?? o.repeat_option);
  const weeklyDays = normalizeWeeklyDays(o.weeklyDays ?? o.weekly_days);
  const monthlyDays = normalizeMonthlyDays(o.monthlyDays ?? o.monthly_days);
  if (repeatOption === 'weekly' && weeklyDays.length === 0) return null;
  if (repeatOption === 'monthly' && monthlyDays.length === 0) return null;

  const hourRaw = typeof o.hour === 'number' ? o.hour : parseInt(String(o.hour ?? ''), 10);
  const minuteRaw = typeof o.minute === 'number' ? o.minute : parseInt(String(o.minute ?? ''), 10);
  const hour = Number.isFinite(hourRaw) ? Math.min(23, Math.max(0, Math.floor(hourRaw))) : 8;
  const minute = Number.isFinite(minuteRaw) ? Math.min(59, Math.max(0, Math.floor(minuteRaw))) : 0;

  const timesRaw =
    typeof o.timesPerDay === 'number'
      ? o.timesPerDay
      : typeof o.times_per_day === 'number'
        ? o.times_per_day
        : parseInt(String(o.timesPerDay ?? o.times_per_day ?? ''), 10);
  const timesPerDay = Number.isFinite(timesRaw) ? Math.min(10, Math.max(1, Math.floor(timesRaw))) : 1;

  const createdAtRaw = o.createdAt ?? o.created_at;
  const createdAt =
    typeof createdAtRaw === 'string' && createdAtRaw.trim() ? createdAtRaw.trim() : new Date().toISOString();

  const flowCategoryId = o.flowCategoryId ?? o.flow_category_id;
  const categoryKey = o.categoryKey ?? o.category_key;
  const categoryLabel = o.categoryLabel ?? o.category_label;

  return {
    id,
    name,
    amount,
    accountId,
    repeatOption,
    weeklyDays,
    monthlyDays,
    hour,
    minute,
    timesPerDay,
    flowCategoryId: typeof flowCategoryId === 'string' ? flowCategoryId : null,
    categoryKey: typeof categoryKey === 'string' ? categoryKey : null,
    categoryLabel: typeof categoryLabel === 'string' ? categoryLabel : null,
    includeInBudget: boolFromDb(o.includeInBudget ?? o.include_in_budget, true),
    enabled: boolFromDb(o.enabled, true),
    createdAt,
  };
}

function rowToDomain(row: FinanceScheduledExpenseRow): ScheduledFinanceExpense | null {
  return normalizeScheduledExpense(row);
}

export function newScheduledFinanceExpenseId(): string {
  return makeTimestampEntityId('fse_', 8);
}

async function migrateScheduledExpensesFromAppSettingsIfNeeded(): Promise<void> {
  try {
    const { readAppMeta, writeAppMeta } = await import('@/lib/api-local-bootstrap');
    const flag = await readAppMeta(SETTINGS_MIGRATED_META);
    if (flag === '1') return;

    const existing = await listFinanceScheduledExpensesLocal();
    if (existing.length === 0) {
      const parsed = await getAppSetting<unknown>(AppSettingKey.financeScheduledExpenses);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const normalized = normalizeScheduledExpense(item);
          if (!normalized) continue;
          await createFinanceScheduledExpense({
            id: normalized.id,
            name: normalized.name,
            amount: normalized.amount,
            account_id: normalized.accountId,
            repeat_option: normalized.repeatOption,
            weekly_days: serializeDays(normalized.weeklyDays),
            monthly_days: serializeDays(normalized.monthlyDays),
            hour: normalized.hour,
            minute: normalized.minute,
            times_per_day: normalized.timesPerDay,
            flow_category_id: normalized.flowCategoryId ?? null,
            category_key: normalized.categoryKey ?? null,
            category_label: normalized.categoryLabel ?? null,
            include_in_budget: normalized.includeInBudget ? 1 : 0,
            enabled: normalized.enabled ? 1 : 0,
            created_at: normalized.createdAt,
          });
        }
      }
    }

    try {
      await removeAppSetting(AppSettingKey.financeScheduledExpenses);
    } catch {
      await setAppSetting(AppSettingKey.financeScheduledExpenses, []);
    }
    await writeAppMeta(SETTINGS_MIGRATED_META, '1');
  } catch (e) {
    if (__DEV__) console.warn('[finance-scheduled-expense] migrate from settings failed', e);
  }
}

export async function loadScheduledFinanceExpenses(): Promise<ScheduledFinanceExpense[]> {
  await migrateScheduledExpensesFromAppSettingsIfNeeded();
  const rows = await listFinanceScheduledExpensesLocal();
  const out: ScheduledFinanceExpense[] = [];
  for (const row of rows) {
    const normalized = rowToDomain(row);
    if (normalized) out.push(normalized);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** @deprecated 定时支出已落独立表，不再整表写入 app_settings */
export async function persistScheduledFinanceExpenses(_items: ScheduledFinanceExpense[]): Promise<void> {
  // no-op：保留导出以免旧调用崩溃
}

export async function getScheduledFinanceExpenseById(id: string): Promise<ScheduledFinanceExpense | null> {
  await migrateScheduledExpensesFromAppSettingsIfNeeded();
  const row = await getFinanceScheduledExpenseByIdLocal(id);
  return row ? rowToDomain(row) : null;
}

export async function upsertScheduledFinanceExpense(
  input: UpsertScheduledFinanceExpenseInput,
): Promise<ScheduledFinanceExpense> {
  await migrateScheduledExpensesFromAppSettingsIfNeeded();
  const normalized = normalizeScheduledExpense({
    ...input,
    id: input.id ?? newScheduledFinanceExpenseId(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  if (!normalized) {
    throw new Error('定时支出参数无效');
  }

  const existing = await getFinanceScheduledExpenseByIdLocal(normalized.id);
  const payload = {
    name: normalized.name,
    amount: normalized.amount,
    account_id: normalized.accountId,
    repeat_option: normalized.repeatOption,
    weekly_days: serializeDays(normalized.weeklyDays),
    monthly_days: serializeDays(normalized.monthlyDays),
    hour: normalized.hour,
    minute: normalized.minute,
    times_per_day: normalized.timesPerDay,
    flow_category_id: normalized.flowCategoryId ?? null,
    category_key: normalized.categoryKey ?? null,
    category_label: normalized.categoryLabel ?? null,
    include_in_budget: normalized.includeInBudget ? 1 : 0,
    enabled: normalized.enabled ? 1 : 0,
  };

  if (existing) {
    await updateFinanceScheduledExpense(normalized.id, payload);
  } else {
    await createFinanceScheduledExpense({
      id: normalized.id,
      ...payload,
      created_at: normalized.createdAt,
    });
  }
  return normalized;
}

export async function deleteScheduledFinanceExpense(id: string): Promise<void> {
  await migrateScheduledExpensesFromAppSettingsIfNeeded();
  await deleteFinanceScheduledExpenseRow(id);
}

export function scheduledExpenseToTaskRepeatSchedule(item: ScheduledFinanceExpense): TaskRepeatSchedule {
  const repeatOption =
    item.repeatOption === 'daily' ? '每天' : item.repeatOption === 'weekly' ? '每周' : '每月';
  return {
    repeatOption,
    weeklyDays: item.weeklyDays,
    monthlyDays: item.monthlyDays,
    yearlyDate: '',
  };
}

export function isScheduledFinanceExpenseDueOnDay(item: ScheduledFinanceExpense, logicalYmd: string): boolean {
  return isTaskRepeatDueOnLogicalDay(logicalYmd, scheduledExpenseToTaskRepeatSchedule(item));
}

export function formatScheduledExpenseTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function describeScheduledFinanceExpense(item: ScheduledFinanceExpense): string {
  const time = formatScheduledExpenseTime(item.hour, item.minute);
  const timesLabel = item.timesPerDay > 1 ? ` · 每天${item.timesPerDay}次` : '';
  if (item.repeatOption === 'daily') {
    return `每天 ${time}${timesLabel}`;
  }
  if (item.repeatOption === 'weekly') {
    const days = item.weeklyDays.map((d) => WEEKDAY_LABELS[d - 1] ?? `周${d}`).join('、');
    return `每周 ${days} ${time}${timesLabel}`;
  }
  const days = item.monthlyDays.map((d) => `${d}日`).join('、');
  return `每月 ${days} ${time}${timesLabel}`;
}

/** 旧版槽位键（无定时支出 id），仅用于兼容历史流水去重。 */
export function legacyScheduledExpenseSlotKey(ymd: string, slotIndex: number): string {
  return `${ymd}:${slotIndex}`;
}

export function isLegacyScheduledExpenseSlotKey(slot: string): boolean {
  return /^\d{4}-\d{2}-\d{2}:\d+$/.test(slot);
}

/** 槽位键：`{expenseId}:{YYYY-MM-DD}:{slotIndex}`，同一规则下按日去重。 */
export function buildScheduledExpenseSlotKey(expenseId: string, ymd: string, slotIndex: number): string {
  return `${expenseId}:${ymd}:${slotIndex}`;
}

export async function isScheduledFinanceExpenseActive(id: string): Promise<boolean> {
  const row = await getScheduledFinanceExpenseById(id);
  return row?.enabled === true;
}

export function scheduledExpenseHappenedAtIso(ymd: string, hour: number, minute: number, slotIndex: number): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return formatWallClockDatetimeLocal(new Date());
  const totalMinutes = hour * 60 + minute + slotIndex;
  const h = Math.floor(totalMinutes / 60) % 24;
  const min = totalMinutes % 60;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min, 0, 0);
  return formatWallClockDatetimeLocal(d);
}

export function ymdFromIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function addDaysToYmd(ymd: string, delta: number): string | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function compareYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

export function dateToFinanceYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/**
 * 区间 [startInclusive, endExclusive) 内，单条定时支出预计发生金额。
 * `onlyIncludeInBudget !== false` 时仅统计「计入预算预扣」的启用项。
 */
export function estimateScheduledExpenseAmountInRange(
  item: ScheduledFinanceExpense,
  startInclusive: Date,
  endExclusive: Date,
  opts?: { onlyIncludeInBudget?: boolean },
): number {
  if (!item.enabled) return 0;
  if (opts?.onlyIncludeInBudget !== false && !item.includeInBudget) return 0;
  const startYmd = dateToFinanceYmd(startInclusive);
  const endYmd = dateToFinanceYmd(endExclusive);
  if (compareYmd(startYmd, endYmd) >= 0) return 0;

  let total = 0;
  let cursor: string | null = startYmd;
  while (cursor && compareYmd(cursor, endYmd) < 0) {
    if (isScheduledFinanceExpenseDueOnDay(item, cursor)) {
      total += item.amount * item.timesPerDay;
    }
    const next = addDaysToYmd(cursor, 1);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return total;
}

/** 多条定时支出在区间内的预计合计（默认仅「计入预算预扣」）。 */
export function sumScheduledExpensesInRange(
  items: ScheduledFinanceExpense[],
  startInclusive: Date,
  endExclusive: Date,
  opts?: { onlyIncludeInBudget?: boolean },
): number {
  return items.reduce(
    (sum, item) => sum + estimateScheduledExpenseAmountInRange(item, startInclusive, endExclusive, opts),
    0,
  );
}
