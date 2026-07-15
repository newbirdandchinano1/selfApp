import { makeTimestampEntityId } from '@/lib/entity-id';
import { getHabitById, updateHabit } from '@/lib/repositories/habits/habit';
import { upsertHabitDayCount } from '@/lib/repositories/habits/habit-check-in';
import { parseHabitDailyGoal } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';

export type HabitSubItem = {
  id: string;
  name: string;
  sortOrder: number;
};

export type HabitSubHabitsMeta = {
  enabled: boolean;
  items: HabitSubItem[];
  /** ymd → { subHabitId → count }；count>0 视为当日已完成 */
  checkIns: Record<string, Record<string, number>>;
};

function parseExtraObject(extraData: string | null): Record<string, unknown> | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeSubItem(raw: unknown, index: number): HabitSubItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as { id?: unknown; name?: unknown; sortOrder?: unknown };
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!id || !name) return null;
  const sortOrder =
    typeof obj.sortOrder === 'number' && Number.isFinite(obj.sortOrder)
      ? Math.round(obj.sortOrder)
      : index;
  return { id, name, sortOrder };
}

function parseCheckIns(raw: unknown): Record<string, Record<string, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [ymd, dayRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (!dayRaw || typeof dayRaw !== 'object' || Array.isArray(dayRaw)) continue;
    const day: Record<string, number> = {};
    for (const [subId, countRaw] of Object.entries(dayRaw as Record<string, unknown>)) {
      if (typeof countRaw !== 'number' || !Number.isFinite(countRaw)) continue;
      const count = Math.max(0, Math.floor(countRaw));
      if (count > 0) day[subId] = count;
    }
    if (Object.keys(day).length > 0) out[ymd] = day;
  }
  return out;
}

export function parseHabitSubHabitsMeta(extraData: string | null): HabitSubHabitsMeta {
  const obj = parseExtraObject(extraData);
  const enabled = obj?.subHabitsEnabled === true;
  const itemsRaw = obj?.subHabits;
  const items: HabitSubItem[] = [];
  if (Array.isArray(itemsRaw)) {
    itemsRaw.forEach((raw, index) => {
      const item = normalizeSubItem(raw, index);
      if (item) items.push(item);
    });
  }
  items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh'));
  return {
    enabled,
    items,
    checkIns: parseCheckIns(obj?.subHabitCheckIns),
  };
}

/** 已开启子习惯模式且至少有一条子习惯 */
export function hasActiveSubHabits(extraData: string | null): boolean {
  const meta = parseHabitSubHabitsMeta(extraData);
  return meta.enabled && meta.items.length > 0;
}

export function createHabitSubItemId(): string {
  return makeTimestampEntityId('sh_', 6);
}

export function getSubHabitDoneMapForYmd(
  extraData: string | null,
  ymd: string,
): Record<string, boolean> {
  const meta = parseHabitSubHabitsMeta(extraData);
  const day = meta.checkIns[ymd] ?? {};
  const out: Record<string, boolean> = {};
  for (const item of meta.items) {
    out[item.id] = (day[item.id] ?? 0) > 0;
  }
  return out;
}

export function countSubHabitsCompletedForYmd(extraData: string | null, ymd: string): number {
  const done = getSubHabitDoneMapForYmd(extraData, ymd);
  return Object.values(done).filter(Boolean).length;
}

export function areAllSubHabitsCompletedForYmd(extraData: string | null, ymd: string): boolean {
  const meta = parseHabitSubHabitsMeta(extraData);
  if (!meta.enabled || meta.items.length === 0) return false;
  return countSubHabitsCompletedForYmd(extraData, ymd) >= meta.items.length;
}

/** 写入子习惯列表与开关；保留已有打卡，并清理已删除子习惯的打卡键 */
export function mergeSubHabitsIntoExtraData(
  extraData: string | null,
  params: { enabled: boolean; items: HabitSubItem[] },
): string {
  const prev = parseExtraObject(extraData) ?? {};
  const prevMeta = parseHabitSubHabitsMeta(extraData);
  const idSet = new Set(params.items.map((i) => i.id));
  const nextCheckIns: Record<string, Record<string, number>> = {};
  for (const [ymd, day] of Object.entries(prevMeta.checkIns)) {
    const nextDay: Record<string, number> = {};
    for (const [subId, count] of Object.entries(day)) {
      if (idSet.has(subId) && count > 0) nextDay[subId] = count;
    }
    if (Object.keys(nextDay).length > 0) nextCheckIns[ymd] = nextDay;
  }
  const normalizedItems = params.items.map((item, index) => ({
    id: item.id,
    name: item.name.trim(),
    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
  })).filter((item) => item.name.length > 0);

  return JSON.stringify({
    ...prev,
    subHabitsEnabled: params.enabled === true,
    subHabits: normalizedItems,
    subHabitCheckIns: nextCheckIns,
  });
}

function setSubHabitCountInExtra(
  extraData: string | null,
  ymd: string,
  subHabitId: string,
  count: number,
): string {
  const prev = parseExtraObject(extraData) ?? {};
  const meta = parseHabitSubHabitsMeta(extraData);
  const nextCheckIns: Record<string, Record<string, number>> = { ...meta.checkIns };
  const day = { ...(nextCheckIns[ymd] ?? {}) };
  const nextCount = Math.max(0, Math.floor(count));
  if (nextCount <= 0) {
    delete day[subHabitId];
  } else {
    day[subHabitId] = nextCount;
  }
  if (Object.keys(day).length === 0) {
    delete nextCheckIns[ymd];
  } else {
    nextCheckIns[ymd] = day;
  }
  return JSON.stringify({
    ...prev,
    subHabitsEnabled: meta.enabled,
    subHabits: meta.items,
    subHabitCheckIns: nextCheckIns,
  });
}

/**
 * 切换某日子习惯完成态，并同步父习惯当日打卡：
 * - 全部完成 → parent count = 1（计入养成天数/绑定任务）
 * - 未全部完成 → 清除父习惯当日记录
 */
export async function toggleSubHabitCheckIn(params: {
  habitId: string;
  subHabitId: string;
  ymd: string;
  /** 省略则在当前完成态上取反 */
  done?: boolean;
}): Promise<{
  extraData: string;
  allDone: boolean;
  completedCount: number;
  total: number;
  parentCount: number;
}> {
  const habit = await getHabitById(params.habitId);
  if (!habit) throw new Error('习惯不存在');
  const meta = parseHabitSubHabitsMeta(habit.extra_data);
  if (!meta.enabled || meta.items.length === 0) {
    throw new Error('该习惯未启用子习惯');
  }
  if (!meta.items.some((i) => i.id === params.subHabitId)) {
    throw new Error('子习惯不存在');
  }
  const currentlyDone = (meta.checkIns[params.ymd]?.[params.subHabitId] ?? 0) > 0;
  const nextDone = params.done !== undefined ? params.done === true : !currentlyDone;
  const nextExtra = setSubHabitCountInExtra(
    habit.extra_data,
    params.ymd,
    params.subHabitId,
    nextDone ? 1 : 0,
  );
  await updateHabit(params.habitId, { extra_data: nextExtra });

  const completedCount = countSubHabitsCompletedForYmd(nextExtra, params.ymd);
  const total = meta.items.length;
  const allDone = completedCount >= total;
  const kind = parseHabitKind(nextExtra);
  const dailyGoal = parseHabitDailyGoal(nextExtra, kind);
  // 父习惯当日打卡：全部子习惯完成时写入满足每日目标的次数（便于统计/绑定任务）
  const parentCount = allDone ? (dailyGoal != null && dailyGoal > 0 ? dailyGoal : 1) : 0;
  await upsertHabitDayCount(params.habitId, params.ymd, parentCount);

  return { extraData: nextExtra, allDone, completedCount, total, parentCount };
}
