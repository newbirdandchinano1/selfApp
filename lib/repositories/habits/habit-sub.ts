import { makeTimestampEntityId } from '@/lib/entity-id';
import { getHabitById, updateHabit } from '@/lib/repositories/habits/habit';
import {
  getCheckInsMapByHabitId,
  upsertHabitDayCount,
} from '@/lib/repositories/habits/habit-check-in';
import { parseHabitDailyGoal } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import {
  getTaskPeriodRange,
  parseTaskRepeatPeriod,
} from '@/lib/repositories/habits/habit-task-period';

export type HabitSubItem = {
  id: string;
  name: string;
  sortOrder: number;
};

export type HabitSubHabitsMeta = {
  enabled: boolean;
  items: HabitSubItem[];
  /** ymd → { subHabitId → count }；count>0：养成/任务=已完成，戒除=已破戒 */
  checkIns: Record<string, Record<string, number>>;
};

/**
 * 完成任务且重复周期非「每日」时，子任务完成态按周期累计（本周/月/年内不清空），
 * 与父任务「每周清空」等设定一致；养成/戒除/每日任务仍按自然日。
 */
function usesPeriodScopedSubCheckIns(extraData: string | null): boolean {
  if (parseHabitKind(extraData) !== 'task') return false;
  return parseTaskRepeatPeriod(extraData) !== '每日';
}

function getSubCheckInScopeRange(
  extraData: string | null,
  ymd: string,
): { startYmd: string; endYmd: string } {
  if (!usesPeriodScopedSubCheckIns(extraData)) {
    return { startYmd: ymd, endYmd: ymd };
  }
  return getTaskPeriodRange(ymd, parseTaskRepeatPeriod(extraData));
}

function aggregateSubDayInRange(
  checkIns: Record<string, Record<string, number>>,
  startYmd: string,
  endYmd: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [dayYmd, day] of Object.entries(checkIns)) {
    if (dayYmd < startYmd || dayYmd > endYmd) continue;
    for (const [subId, count] of Object.entries(day)) {
      if (count > 0) out[subId] = Math.max(out[subId] ?? 0, count);
    }
  }
  return out;
}

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

/** 已开启子习惯/子任务模式且至少有一条 */
export function hasActiveSubHabits(extraData: string | null): boolean {
  const meta = parseHabitSubHabitsMeta(extraData);
  return meta.enabled && meta.items.length > 0;
}

/** 子项文案：完成任务用「子任务」，养成/戒除用「子习惯」 */
export function habitSubItemsLabel(kind: 'build' | 'break' | 'task'): {
  section: string;
  singular: string;
  enableTitle: string;
  enableHint: string;
  addButton: string;
  editorTitle: (editing: boolean) => string;
  emptyHint: string;
  modalHint: string;
} {
  if (kind === 'task') {
    return {
      section: '子任务',
      singular: '子任务',
      enableTitle: '启用子任务模式',
      enableHint: '开启后首页点击将展示子任务清单；进度按重复周期保留，全部完成后才计入父任务打卡',
      addButton: '添加子任务',
      editorTitle: (editing) => (editing ? '编辑子任务' : '添加子任务'),
      emptyHint: '尚未添加子任务。添加后，首页将改为在弹窗中逐项完成。',
      modalHint: '点选完成子任务；进度按重复周期保留，全部完成后计入父任务打卡',
    };
  }
  if (kind === 'break') {
    return {
      section: '子习惯',
      singular: '子习惯',
      enableTitle: '启用子习惯模式',
      enableHint: '开启后首页点击将展示子习惯清单；任一项破戒则当日整体破戒',
      addButton: '添加子习惯',
      editorTitle: (editing) => (editing ? '编辑子习惯' : '添加子习惯'),
      emptyHint: '尚未添加子习惯。添加后，在弹窗中标记破戒项；一项破戒即整日破戒。',
      modalHint: '点选标记破戒；任一项破戒则当日整体破戒。无破戒时可点「确认今日守住」。',
    };
  }
  return {
    section: '子习惯',
    singular: '子习惯',
    enableTitle: '启用子习惯模式',
    enableHint: '开启后首页点击将展示子习惯清单，全部完成后才计入父习惯打卡',
    addButton: '添加子习惯',
    editorTitle: (editing) => (editing ? '编辑子习惯' : '添加子习惯'),
    emptyHint: '尚未添加子习惯。添加后，首页将改为在弹窗中逐项完成。',
    modalHint: '点选完成子习惯；全部完成后计入父习惯当日打卡',
  };
}

export function createHabitSubItemId(): string {
  return makeTimestampEntityId('sh_', 6);
}

export function getSubHabitDoneMapForYmd(
  extraData: string | null,
  ymd: string,
): Record<string, boolean> {
  const meta = parseHabitSubHabitsMeta(extraData);
  const { startYmd, endYmd } = getSubCheckInScopeRange(extraData, ymd);
  const day = aggregateSubDayInRange(meta.checkIns, startYmd, endYmd);
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
  const nextCount = Math.max(0, Math.floor(count));

  if (nextCount <= 0 && usesPeriodScopedSubCheckIns(extraData)) {
    const { startYmd, endYmd } = getTaskPeriodRange(ymd, parseTaskRepeatPeriod(extraData));
    for (const dayYmd of Object.keys(nextCheckIns)) {
      if (dayYmd < startYmd || dayYmd > endYmd) continue;
      const day = { ...(nextCheckIns[dayYmd] ?? {}) };
      delete day[subHabitId];
      if (Object.keys(day).length === 0) {
        delete nextCheckIns[dayYmd];
      } else {
        nextCheckIns[dayYmd] = day;
      }
    }
  } else {
    const day = { ...(nextCheckIns[ymd] ?? {}) };
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
  }

  return JSON.stringify({
    ...prev,
    subHabitsEnabled: meta.enabled,
    subHabits: meta.items,
    subHabitCheckIns: nextCheckIns,
  });
}

async function syncParentCheckInAfterSubToggle(params: {
  habitId: string;
  extraData: string;
  ymd: string;
  wasAllDone: boolean;
  allDone: boolean;
  parentCount: number;
}): Promise<void> {
  const periodScoped = usesPeriodScopedSubCheckIns(params.extraData);
  if (!periodScoped) {
    await upsertHabitDayCount(params.habitId, params.ymd, params.parentCount);
    return;
  }
  if (params.allDone && !params.wasAllDone) {
    await upsertHabitDayCount(params.habitId, params.ymd, params.parentCount);
    return;
  }
  if (!params.allDone && params.wasAllDone) {
    const { startYmd, endYmd } = getTaskPeriodRange(
      params.ymd,
      parseTaskRepeatPeriod(params.extraData),
    );
    const map = await getCheckInsMapByHabitId(params.habitId);
    for (const [dayYmd, count] of Object.entries(map)) {
      if (dayYmd < startYmd || dayYmd > endYmd) continue;
      if (Math.max(0, Math.floor(Number(count) || 0)) > 0) {
        await upsertHabitDayCount(params.habitId, dayYmd, 0);
      }
    }
    return;
  }
  if (!params.allDone) {
    await upsertHabitDayCount(params.habitId, params.ymd, 0);
  }
}

/**
 * 切换某日子习惯/子任务完成态，并同步父习惯当日打卡：
 * - 养成 / 完成任务：全部完成 → parent count = 目标次数；未全完 → 0
 * - 戒除：勾选表示该子项破戒；任一项破戒 → parent count = 破戒项数；全无破戒 → 写入保持戒除（count=0）
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
  /** 戒除：是否任一子项破戒 */
  anyBroken: boolean;
}> {
  const habit = await getHabitById(params.habitId);
  if (!habit) throw new Error('习惯不存在');
  const meta = parseHabitSubHabitsMeta(habit.extra_data);
  if (!meta.enabled || meta.items.length === 0) {
    throw new Error('该习惯未启用子项');
  }
  if (!meta.items.some((i) => i.id === params.subHabitId)) {
    throw new Error('子项不存在');
  }
  const wasAllDone = areAllSubHabitsCompletedForYmd(habit.extra_data, params.ymd);
  const currentlyDone = getSubHabitDoneMapForYmd(habit.extra_data, params.ymd)[params.subHabitId] === true;
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
  const kind = parseHabitKind(nextExtra);
  const dailyGoal = parseHabitDailyGoal(nextExtra, kind);

  if (kind === 'break') {
    const anyBroken = completedCount > 0;
    const parentCount = anyBroken ? completedCount : 0;
    if (anyBroken) {
      await upsertHabitDayCount(params.habitId, params.ymd, parentCount);
    } else {
      await upsertHabitDayCount(params.habitId, params.ymd, 0, { keepZeroRecord: true });
    }
    // allDone：当日戒除成功（无破戒且已写确认）
    return {
      extraData: nextExtra,
      allDone: !anyBroken,
      completedCount,
      total,
      parentCount,
      anyBroken,
    };
  }

  const allDone = completedCount >= total;
  const parentCount = allDone ? (dailyGoal != null && dailyGoal > 0 ? dailyGoal : 1) : 0;
  await syncParentCheckInAfterSubToggle({
    habitId: params.habitId,
    extraData: nextExtra,
    ymd: params.ymd,
    wasAllDone,
    allDone,
    parentCount,
  });

  return {
    extraData: nextExtra,
    allDone,
    completedCount,
    total,
    parentCount,
    anyBroken: false,
  };
}
