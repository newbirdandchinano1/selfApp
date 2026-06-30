import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import { formatWallClockDatetimeLocal } from '@/lib/api-mysql-datetime';
import { makeTimestampEntityId } from '@/lib/entity-id';
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

function normalizeWeeklyDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => (typeof x === 'number' ? Math.round(x) : parseInt(String(x), 10))).filter((n) => n >= 1 && n <= 7))].sort(
    (a, b) => a - b,
  );
}

function normalizeMonthlyDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => (typeof x === 'number' ? Math.round(x) : parseInt(String(x), 10))).filter((n) => n >= 1 && n <= 31))].sort(
    (a, b) => a - b,
  );
}

function normalizeRepeatOption(raw: unknown): ScheduledExpenseRepeat {
  if (raw === 'weekly' || raw === 'monthly' || raw === 'daily') return raw;
  return 'daily';
}

function normalizeScheduledExpense(raw: unknown): ScheduledFinanceExpense | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const accountId = typeof o.accountId === 'string' && o.accountId.trim() ? o.accountId.trim() : null;
  const amount = o.amount;
  if (!id || !name || !accountId) return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;

  const repeatOption = normalizeRepeatOption(o.repeatOption);
  const weeklyDays = normalizeWeeklyDays(o.weeklyDays);
  const monthlyDays = normalizeMonthlyDays(o.monthlyDays);
  if (repeatOption === 'weekly' && weeklyDays.length === 0) return null;
  if (repeatOption === 'monthly' && monthlyDays.length === 0) return null;

  const hourRaw = typeof o.hour === 'number' ? o.hour : parseInt(String(o.hour ?? ''), 10);
  const minuteRaw = typeof o.minute === 'number' ? o.minute : parseInt(String(o.minute ?? ''), 10);
  const hour = Number.isFinite(hourRaw) ? Math.min(23, Math.max(0, Math.floor(hourRaw))) : 8;
  const minute = Number.isFinite(minuteRaw) ? Math.min(59, Math.max(0, Math.floor(minuteRaw))) : 0;

  const timesRaw = typeof o.timesPerDay === 'number' ? o.timesPerDay : parseInt(String(o.timesPerDay ?? ''), 10);
  const timesPerDay = Number.isFinite(timesRaw) ? Math.min(10, Math.max(1, Math.floor(timesRaw))) : 1;

  const createdAt = typeof o.createdAt === 'string' && o.createdAt.trim() ? o.createdAt.trim() : new Date().toISOString();

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
    flowCategoryId: typeof o.flowCategoryId === 'string' ? o.flowCategoryId : null,
    categoryKey: typeof o.categoryKey === 'string' ? o.categoryKey : null,
    categoryLabel: typeof o.categoryLabel === 'string' ? o.categoryLabel : null,
    includeInBudget: o.includeInBudget !== false,
    enabled: o.enabled !== false,
    createdAt,
  };
}

export function newScheduledFinanceExpenseId(): string {
  return makeTimestampEntityId('fse_', 8);
}

export async function loadScheduledFinanceExpenses(): Promise<ScheduledFinanceExpense[]> {
  const parsed = await getAppSetting<unknown>(AppSettingKey.financeScheduledExpenses);
  if (!Array.isArray(parsed)) return [];
  const out: ScheduledFinanceExpense[] = [];
  for (const item of parsed) {
    const normalized = normalizeScheduledExpense(item);
    if (normalized) out.push(normalized);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function persistScheduledFinanceExpenses(items: ScheduledFinanceExpense[]): Promise<void> {
  await setAppSetting(AppSettingKey.financeScheduledExpenses, items);
}

export async function getScheduledFinanceExpenseById(id: string): Promise<ScheduledFinanceExpense | null> {
  const rows = await loadScheduledFinanceExpenses();
  return rows.find((row) => row.id === id) ?? null;
}

export async function upsertScheduledFinanceExpense(input: UpsertScheduledFinanceExpenseInput): Promise<ScheduledFinanceExpense> {
  const normalized = normalizeScheduledExpense({
    ...input,
    id: input.id ?? newScheduledFinanceExpenseId(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  if (!normalized) {
    throw new Error('定时支出参数无效');
  }
  const rows = await loadScheduledFinanceExpenses();
  const idx = rows.findIndex((row) => row.id === normalized.id);
  const next = idx >= 0 ? rows.map((row, i) => (i === idx ? normalized : row)) : [...rows, normalized];
  await persistScheduledFinanceExpenses(next);
  return normalized;
}

export async function deleteScheduledFinanceExpense(id: string): Promise<void> {
  const rows = await loadScheduledFinanceExpenses();
  await persistScheduledFinanceExpenses(rows.filter((row) => row.id !== id));
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

export function buildScheduledExpenseSlotKey(ymd: string, slotIndex: number): string {
  return `${ymd}:${slotIndex}`;
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
