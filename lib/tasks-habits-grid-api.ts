import { apiGetTasksHabitsGrid, type HabitsGridPayload, type HabitsGridSection } from '@/lib/api-client';
import { formatTaskAuditDatetimeLocal } from '@/lib/api-mysql-datetime';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import { getHabitById, getHabits } from '@/lib/repositories/habits/habit';
import {
  isHabitDayDisplayCompleted,
  parseHabitDailyGoal,
  parseHabitIncrementCap,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import { parseBreakHabitReward } from '@/lib/repositories/habits/habit-points-grant';
import { parseHabitRewardPoints } from '@/lib/repositories/habits/habit-reward-points';
import {
  countSubHabitsCompletedForYmd,
  hasActiveSubHabits,
  parseHabitSubHabitsMeta,
  type HabitSubItem,
} from '@/lib/repositories/habits/habit-sub';
import { normalizeRewardPoints } from '@/lib/reward-points';
import { getLogicalLocalYmd, loadTasksDayBoundary, type TasksDayBoundary } from '@/lib/tasks-logical-day';

export const TASKS_HABITS_GRID_FILTERS_VERSION = 'tasks-page-v1';

export type TasksHabitGridItem = {
  id: string;
  icon: string;
  name: string;
  note: string | null;
  rewardPoints: number;
  todayCount: number;
  dailyGoal: number | null;
  incrementCap: number | null;
  kind: HabitKind;
  extraData: string | null;
  periodProgress: number | null;
  periodGoal: number | null;
  taskShowPeriodCheck: boolean;
  /** 服务端计算的今日完成态（养成/戒除/任务型） */
  displayCompleted: boolean;
  /** 子习惯模式：首页点击改弹窗而非直接打卡 */
  hasSubHabits: boolean;
  subHabits: HabitSubItem[];
  subHabitCompletedCount: number;
};

export type TasksHabitGridSection = {
  id: string;
  title: string;
  items: TasksHabitGridItem[];
};

export type TasksHabitsGridData = {
  logicalToday: string;
  sections: TasksHabitGridSection[];
  serverFiltered: boolean;
  filtersVersion: string | null;
};

function isServerFilteredHabitsGrid(meta: HabitsGridPayload['meta']): boolean {
  return meta?.serverFiltered === true && meta?.filtersVersion === TASKS_HABITS_GRID_FILTERS_VERSION;
}

function extraDataToString(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function readGridItemExtraData(item: HabitsGridSection['items'][number]): string | null {
  return extraDataToString(item.extraData ?? item.extra_data);
}

const HABIT_EXTRA_NESTED_MERGE_KEYS = ['quantify', 'schedule', 'reminder', 'subHabits'] as const;

/** 浅合并对象，并对 quantify 等嵌套对象再合并一层，避免服务端缺字段时抹掉本地 dailyGoal */
function mergeHabitExtraObjects(
  local: Record<string, unknown>,
  grid: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...local, ...grid };
  for (const key of HABIT_EXTRA_NESTED_MERGE_KEYS) {
    const localNested = local[key];
    const gridNested = grid[key];
    if (
      localNested &&
      typeof localNested === 'object' &&
      !Array.isArray(localNested) &&
      gridNested &&
      typeof gridNested === 'object' &&
      !Array.isArray(gridNested)
    ) {
      out[key] = {
        ...(localNested as Record<string, unknown>),
        ...(gridNested as Record<string, unknown>),
      };
    }
  }
  return out;
}

/** habits-grid upsert 时合并 extra_data，避免服务端字段不全时覆盖本地 richer JSON */
function mergeHabitExtraDataForGridSync(
  localRaw: string | null | undefined,
  gridRaw: string | null,
): string | undefined {
  if (!gridRaw) return localRaw?.trim() ? localRaw : undefined;
  if (!localRaw?.trim()) return gridRaw;
  try {
    const local = JSON.parse(localRaw) as unknown;
    const grid = JSON.parse(gridRaw) as unknown;
    if (
      typeof local === 'object' &&
      local !== null &&
      !Array.isArray(local) &&
      typeof grid === 'object' &&
      grid !== null &&
      !Array.isArray(grid)
    ) {
      return JSON.stringify(
        mergeHabitExtraObjects(local as Record<string, unknown>, grid as Record<string, unknown>),
      );
    }
  } catch {
    /* 解析失败则采用服务端原始串 */
  }
  return gridRaw;
}

async function upsertHabitsFromGrid(sections: HabitsGridSection[]): Promise<void> {
  const localById = new Map((await getHabits()).map((r) => [r.id, r]));
  const now = formatTaskAuditDatetimeLocal();
  const rows: Record<string, unknown>[] = [];
  for (const section of sections) {
    for (const item of Array.isArray(section.items) ? section.items : []) {
      const id = String(item.id ?? '').trim();
      if (!id) continue;
      const extraData = readGridItemExtraData(item);
      const local = localById.get(id);
      const row: Record<string, unknown> = {
        id,
        name: item.name ?? local?.name ?? '',
        icon: item.icon ?? local?.icon ?? '✓',
        context: item.context ?? section.title ?? section.id,
      };
      if (typeof item.note === 'string') row.note = item.note;
      else if (local?.note) row.note = local.note;
      const mergedExtra = mergeHabitExtraDataForGridSync(local?.extra_data, extraData);
      if (mergedExtra != null) row.extra_data = mergedExtra;
      // 新习惯写入本地库时必须带 created_at / updated_at，否则 INSERT 会因 NOT NULL 失败
      if (!localById.has(id)) {
        row.created_at = now;
        row.updated_at = now;
      }
      rows.push(row);
    }
  }
  if (rows.length === 0) return;
  await withApiTableSyncLock('habits', async () => {
    await syncApiReadResultToLocal('habits', rows);
  });
}

async function mergeHabitGridExtraFields(
  sections: HabitsGridSection[],
  logicalToday: string,
): Promise<TasksHabitGridSection[]> {
  const localRows = await getHabits();
  const localById = new Map(localRows.map((r) => [r.id, r]));

  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    items: (Array.isArray(section.items) ? section.items : []).map((item) => {
      const local = localById.get(item.id);
      const gridExtra = readGridItemExtraData(item);
      // 与 upsert 相同规则合并，避免只用服务端残缺 quantify 导致日目标丢失（一次打卡即「完成」）
      const extraData =
        mergeHabitExtraDataForGridSync(local?.extra_data, gridExtra) ??
        gridExtra ??
        local?.extra_data ??
        null;
      const kind = (item.kind ?? (local ? parseHabitKind(local.extra_data) : 'build')) as HabitKind;
      const resolvedKind: HabitKind = ['build', 'break', 'task'].includes(String(kind))
        ? (kind as HabitKind)
        : parseHabitKind(extraData);
      const subActive = hasActiveSubHabits(extraData);
      const subMeta = parseHabitSubHabitsMeta(extraData);
      const subCompleted = subActive ? countSubHabitsCompletedForYmd(extraData, logicalToday) : 0;
      const subTotal = subActive ? subMeta.items.length : 0;
      const serverTodayCount = typeof item.todayCount === 'number' ? item.todayCount : 0;
      const parsedDailyGoal = parseHabitDailyGoal(extraData, resolvedKind);
      const serverDailyGoal =
        typeof item.dailyGoal === 'number' && Number.isFinite(item.dailyGoal)
          ? item.dailyGoal
          : null;
      const todayCount = subActive ? subCompleted : serverTodayCount;
      // 以合并后的 extra_data 为准；服务端 dailyGoal 仅作回退
      const dailyGoal = subActive ? subTotal : (parsedDailyGoal ?? serverDailyGoal);
      const periodProgress = item.periodProgress ?? null;
      const periodGoal = item.periodGoal ?? null;
      const taskShowPeriodCheck =
        resolvedKind === 'task' &&
        typeof periodProgress === 'number' &&
        typeof periodGoal === 'number' &&
        periodGoal > 0 &&
        periodProgress >= periodGoal &&
        !Boolean(item.hiddenOnViewDay);
      const incrementCap = subActive
        ? subTotal
        : parseHabitIncrementCap(extraData, resolvedKind) ??
          (dailyGoal != null && dailyGoal > 0 && resolvedKind !== 'break' ? dailyGoal : null);
      const displayCompleted = subActive
        ? subTotal > 0 && subCompleted >= subTotal
        : resolvedKind === 'task'
          ? taskShowPeriodCheck
          : resolvedKind === 'break'
            ? // 戒除完成态依赖 hasTodayRecord，网格阶段仍信服务端；TasksScreen load 后会重算
              Boolean(item.displayCompleted)
            : isHabitDayDisplayCompleted({
                kind: resolvedKind,
                todayCount,
                dailyGoal,
              });
      const noteFromApi = typeof item.note === 'string' && item.note.trim() ? item.note.trim() : null;
      return {
        id: item.id,
        icon: item.icon ?? local?.icon ?? '✓',
        name: item.name ?? local?.name ?? '',
        note: noteFromApi ?? (local?.note?.trim() ? local.note.trim() : null),
        rewardPoints:
          resolvedKind === 'break'
            ? (() => {
                const penalty = parseBreakHabitReward(extraData, 'penalty');
                return penalty === 0 ? 0 : -Math.abs(penalty);
              })()
            : typeof item.rewardPoints === 'number'
              ? normalizeRewardPoints(item.rewardPoints)
              : parseHabitRewardPoints(extraData),
        todayCount,
        dailyGoal,
        incrementCap,
        kind: resolvedKind,
        extraData,
        periodProgress,
        periodGoal,
        taskShowPeriodCheck,
        displayCompleted,
        hasSubHabits: subActive,
        subHabits: subActive ? subMeta.items : [],
        subHabitCompletedCount: subCompleted,
      };
    }),
  }));
}

async function pullHabitsGridFromApi(opts: {
  boundary: TasksDayBoundary;
  logicalToday: string;
  signal?: AbortSignal;
}): Promise<TasksHabitsGridData> {
  throwIfAborted(opts.signal);
  const payload = await apiGetTasksHabitsGrid({
    dayBoundaryHour: opts.boundary.hour,
    dayBoundaryMinute: opts.boundary.minute,
    logicalToday: opts.logicalToday,
    signal: opts.signal,
  });
  const logicalToday = payload.logicalToday?.trim() || opts.logicalToday;
  const rawSections = Array.isArray(payload.sections) ? payload.sections : [];
  await upsertHabitsFromGrid(rawSections);
  const sections = await mergeHabitGridExtraFields(rawSections, logicalToday);
  return {
    logicalToday,
    sections,
    serverFiltered: isServerFilteredHabitsGrid(payload.meta),
    filtersVersion: typeof payload.meta?.filtersVersion === 'string' ? payload.meta.filtersVersion : null,
  };
}

/** 习惯网格：`GET /api/pages/tasks/habits-grid` */
export async function fetchTasksHabitsGrid(opts?: {
  boundary?: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  signal?: AbortSignal;
}): Promise<TasksHabitsGridData> {
  const boundary = opts?.boundary ?? (await loadTasksDayBoundary());
  const logicalToday = getLogicalLocalYmd(new Date(), boundary);

  if (!opts?.forceLocal) {
    try {
      return await pullHabitsGridFromApi({ boundary, logicalToday, signal: opts?.signal });
    } catch (e) {
      if (!opts?.offlineFallback) throw e;
      console.warn('[tasks-habits-grid-api] 接口失败，回退空列表', e);
    }
  }

  return {
    logicalToday: '',
    sections: [],
    serverFiltered: false,
    filtersVersion: null,
  };
}

/** 打卡写操作后刷新单条 incrementCap（本地 habits 表） */
export async function resolveHabitIncrementCap(habitId: string): Promise<number | null> {
  const row = await getHabitById(habitId);
  if (!row) return null;
  return parseHabitIncrementCap(row.extra_data, parseHabitKind(row.extra_data));
}
