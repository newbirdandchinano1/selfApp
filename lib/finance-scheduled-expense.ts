import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { AppSettingKey, getAppSetting, removeAppSetting, setAppSetting } from '@/lib/app-settings-store';
import { formatWallClockDatetimeLocal, ymdFromDatetime } from '@/lib/api-mysql-datetime';
import { addDaysToYmd as addDaysToYmdCore, compareYmd, formatYmd } from '@/lib/date';
import { makeTimestampEntityId } from '@/lib/entity-id';
import {
  describeTaskRepeatSchedule,
  isRepeatDueOnLogicalDay,
  normalizeMonthlyDays,
  normalizeScheduledExpenseRepeatStorage,
  normalizeWeeklyDays,
  scheduledExpenseStorageToTaskRepeat,
  type ScheduledExpenseRepeatStorage,
} from '@/lib/schedule/repeat';
import type { TaskRepeatSchedule } from '@/lib/task-repeat-rollover';
import { getDatabase, type SyncStatus } from '@/lib/database.native';

/** @deprecated 使用 ScheduledExpenseRepeatStorage；DB 字段仍为英文枚举 */
export type ScheduledExpenseRepeat = ScheduledExpenseRepeatStorage;

export type ScheduledFinanceExpense = {
  id: string;
  name: string;
  amount: number;
  accountId: string;
  repeatOption: ScheduledExpenseRepeatStorage;
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

const TABLE = 'finance_scheduled_expenses';
const SETTINGS_MIGRATED_META = 'finance_scheduled_expenses_settings_migrated_v1';

type FinanceScheduledExpenseRow = {
  id: string;
  name: string;
  amount: number;
  account_id: string;
  repeat_option: string;
  weekly_days: string | null;
  monthly_days: string | null;
  hour: number;
  minute: number;
  times_per_day: number;
  flow_category_id: string | null;
  category_key: string | null;
  category_label: string | null;
  include_in_budget: number;
  enabled: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

type CreateFinanceScheduledExpenseInput = {
  id: string;
  name: string;
  amount: number;
  account_id: string;
  repeat_option: string;
  weekly_days?: string | null;
  monthly_days?: string | null;
  hour?: number;
  minute?: number;
  times_per_day?: number;
  flow_category_id?: string | null;
  category_key?: string | null;
  category_label?: string | null;
  include_in_budget?: number;
  enabled?: number;
  created_at?: string;
  extra_data?: string | null;
};

type UpdateFinanceScheduledExpenseInput = Partial<
  Pick<
    FinanceScheduledExpenseRow,
    | 'name'
    | 'amount'
    | 'account_id'
    | 'repeat_option'
    | 'weekly_days'
    | 'monthly_days'
    | 'hour'
    | 'minute'
    | 'times_per_day'
    | 'flow_category_id'
    | 'category_key'
    | 'category_label'
    | 'include_in_budget'
    | 'enabled'
    | 'extra_data'
  >
>;

function serializeDays(days: number[]): string {
  return JSON.stringify(days);
}

function boolFromDb(raw: unknown, defaultValue = true): boolean {
  if (raw === false || raw === 0 || raw === '0') return false;
  if (raw === true || raw === 1 || raw === '1') return true;
  if (raw == null) return defaultValue;
  return defaultValue;
}

async function listFinanceScheduledExpenseRows(): Promise<FinanceScheduledExpenseRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<FinanceScheduledExpenseRow>(
    `SELECT * FROM ${TABLE} WHERE sync_status != 'pending_delete' ORDER BY created_at ASC, id ASC`,
  );
  return rows ?? [];
}

async function getFinanceScheduledExpenseRowById(id: string): Promise<FinanceScheduledExpenseRow | null> {
  const pk = id.trim();
  if (!pk) return null;
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<FinanceScheduledExpenseRow>(
    `SELECT * FROM ${TABLE} WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
    [pk],
  );
  return row ?? null;
}

async function insertFinanceScheduledExpenseRow(input: CreateFinanceScheduledExpenseInput): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('定时支出名称不能为空');
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('定时支出金额无效');
  }
  const accountId = input.account_id.trim();
  if (!accountId) throw new Error('定时支出账户无效');

  const db = await getDatabase();
  if (!db) throw new Error('数据库未就绪');

  const createdAt = input.created_at?.trim() || null;
  await db.runAsync(
    `INSERT INTO ${TABLE} (
      id, name, amount, account_id, repeat_option, weekly_days, monthly_days,
      hour, minute, times_per_day, flow_category_id, category_key, category_label,
      include_in_budget, enabled, created_at, updated_at, sync_status, extra_data
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, COALESCE(?, datetime('now')), datetime('now'), 'pending_create', ?
    )`,
    [
      input.id,
      name,
      input.amount,
      accountId,
      input.repeat_option || 'daily',
      input.weekly_days ?? null,
      input.monthly_days ?? null,
      input.hour ?? 8,
      input.minute ?? 0,
      input.times_per_day ?? 1,
      input.flow_category_id ?? null,
      input.category_key ?? null,
      input.category_label ?? null,
      input.include_in_budget ?? 1,
      input.enabled ?? 1,
      createdAt,
      input.extra_data ?? null,
    ],
  );
}

async function updateFinanceScheduledExpenseRow(
  id: string,
  input: UpdateFinanceScheduledExpenseInput,
): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('数据库未就绪');
  const current = await ensureLocalRowForWrite<FinanceScheduledExpenseRow>(TABLE, id);
  if (!current) throw new Error('未找到定时支出');

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  if (!nextName) throw new Error('定时支出名称不能为空');

  const nextAmount = input.amount !== undefined ? input.amount : current.amount;
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    throw new Error('定时支出金额无效');
  }

  const nextAccountId =
    input.account_id !== undefined ? input.account_id.trim() : current.account_id;
  if (!nextAccountId) throw new Error('定时支出账户无效');

  await db.runAsync(
    `UPDATE ${TABLE}
     SET name = ?,
         amount = ?,
         account_id = ?,
         repeat_option = ?,
         weekly_days = ?,
         monthly_days = ?,
         hour = ?,
         minute = ?,
         times_per_day = ?,
         flow_category_id = ?,
         category_key = ?,
         category_label = ?,
         include_in_budget = ?,
         enabled = ?,
         extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      nextName,
      nextAmount,
      nextAccountId,
      input.repeat_option !== undefined ? input.repeat_option : current.repeat_option,
      input.weekly_days !== undefined ? input.weekly_days : current.weekly_days,
      input.monthly_days !== undefined ? input.monthly_days : current.monthly_days,
      input.hour !== undefined ? input.hour : current.hour,
      input.minute !== undefined ? input.minute : current.minute,
      input.times_per_day !== undefined ? input.times_per_day : current.times_per_day,
      input.flow_category_id !== undefined ? input.flow_category_id : current.flow_category_id,
      input.category_key !== undefined ? input.category_key : current.category_key,
      input.category_label !== undefined ? input.category_label : current.category_label,
      input.include_in_budget !== undefined ? input.include_in_budget : current.include_in_budget,
      input.enabled !== undefined ? input.enabled : current.enabled,
      input.extra_data !== undefined ? input.extra_data : current.extra_data,
      id,
    ],
  );
}

async function softDeleteFinanceScheduledExpenseRow(id: string): Promise<void> {
  await ensureLocalRowForWrite(TABLE, id);
  const db = await getDatabase();
  if (!db) return;
  await db.runAsync(
    `UPDATE ${TABLE}
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id],
  );
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

  const repeatOption = normalizeScheduledExpenseRepeatStorage(o.repeatOption ?? o.repeat_option);
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

    const existing = await listFinanceScheduledExpenseRows();
    if (existing.length === 0) {
      const parsed = await getAppSetting<unknown>(AppSettingKey.financeScheduledExpenses);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const normalized = normalizeScheduledExpense(item);
          if (!normalized) continue;
          await insertFinanceScheduledExpenseRow({
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
  const rows = await listFinanceScheduledExpenseRows();
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
  const row = await getFinanceScheduledExpenseRowById(id);
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

  const existing = await getFinanceScheduledExpenseRowById(normalized.id);
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
    await updateFinanceScheduledExpenseRow(normalized.id, payload);
  } else {
    await insertFinanceScheduledExpenseRow({
      id: normalized.id,
      ...payload,
      created_at: normalized.createdAt,
    });
  }
  return normalized;
}

export async function deleteScheduledFinanceExpense(id: string): Promise<void> {
  await migrateScheduledExpensesFromAppSettingsIfNeeded();
  await softDeleteFinanceScheduledExpenseRow(id);
}

export function scheduledExpenseToTaskRepeatSchedule(item: ScheduledFinanceExpense): TaskRepeatSchedule {
  return scheduledExpenseStorageToTaskRepeat(item.repeatOption, item.weeklyDays, item.monthlyDays);
}

export function isScheduledFinanceExpenseDueOnDay(item: ScheduledFinanceExpense, logicalYmd: string): boolean {
  return isRepeatDueOnLogicalDay(logicalYmd, scheduledExpenseToTaskRepeatSchedule(item));
}

export function formatScheduledExpenseTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function describeScheduledFinanceExpense(item: ScheduledFinanceExpense): string {
  return describeTaskRepeatSchedule(scheduledExpenseToTaskRepeatSchedule(item), {
    hour: item.hour,
    minute: item.minute,
    timesPerDay: item.timesPerDay,
  });
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
  return ymdFromDatetime(iso);
}

/** 非法 YMD 时返回 null（定时支出 runner 依赖此语义） */
export function addDaysToYmd(ymd: string, delta: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim())) return null;
  return addDaysToYmdCore(ymd, delta);
}

export { compareYmd };

export function dateToFinanceYmd(d: Date): string {
  return formatYmd(d);
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
