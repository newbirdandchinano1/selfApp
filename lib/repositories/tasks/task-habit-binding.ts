import { getCheckInsMapByHabitId, getTodayHabitCountsMap } from '@/lib/repositories/habits/habit-check-in';
import { isBreakHabitSucceeded } from '@/lib/repositories/habits/habit-break-success';
import { isBuildHabitSucceeded } from '@/lib/repositories/habits/habit-build-success';
import { getHabitById } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import {
  isBreakHabitDayCompleted,
  isHabitDayGoalMet,
  parseHabitConsecutiveTargetDays,
  parseHabitDailyGoal,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { formatTaskAuditDatetimeLocal } from '@/lib/api-mysql-datetime';
import { getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';
import { insertTaskExecutionEvent } from '@/lib/repositories/tasks/task-execution-events';
import {
  cascadeParentTaskStatusAfterChildChange,
  getTasks,
  type ParentTaskCascadeChange,
  updateTask,
} from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { isTaskShelvedStatus, isTaskTerminalStatus } from '@/lib/repositories/tasks/task.types';

const BOUND_HABIT_IDS_KEY = 'bound_habit_ids';
/** @deprecated 兼容旧版单项绑定 */
const BOUND_HABIT_ID_KEY = 'bound_habit_id';

function parseExtraObject(extraData: string | null | undefined): Record<string, unknown> {
  if (!extraData?.trim()) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function parseBoundHabitIdsFromExtraData(extraData: string | null | undefined): string[] {
  const base = parseExtraObject(extraData);
  const ids: string[] = [];

  const rawIds = base[BOUND_HABIT_IDS_KEY];
  if (Array.isArray(rawIds)) {
    for (const item of rawIds) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
      }
    }
  }

  const legacy = base[BOUND_HABIT_ID_KEY];
  if (typeof legacy === 'string') {
    const trimmed = legacy.trim();
    if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
  }

  return ids;
}

/** @deprecated 使用 parseBoundHabitIdsFromExtraData */
export function parseBoundHabitIdFromExtraData(extraData: string | null | undefined): string | null {
  return parseBoundHabitIdsFromExtraData(extraData)[0] ?? null;
}

export function mergeBoundHabitIdsIntoExtraData(
  extraData: string | null | undefined,
  habitIds: readonly string[] | null | undefined,
): string {
  const base = parseExtraObject(extraData);
  delete base[BOUND_HABIT_ID_KEY];

  const unique = [
    ...new Set((habitIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)),
  ];
  if (unique.length === 0) {
    delete base[BOUND_HABIT_IDS_KEY];
  } else {
    base[BOUND_HABIT_IDS_KEY] = unique;
  }
  return JSON.stringify(base);
}

/** @deprecated 使用 mergeBoundHabitIdsIntoExtraData */
export function mergeBoundHabitIdIntoExtraData(
  extraData: string | null | undefined,
  habitId: string | null | undefined,
): string {
  const trimmed = typeof habitId === 'string' ? habitId.trim() : '';
  return mergeBoundHabitIdsIntoExtraData(extraData, trimmed ? [trimmed] : []);
}

export function taskHasBoundHabit(extraData: string | null | undefined, habitId: string): boolean {
  const trimmed = habitId.trim();
  if (!trimmed) return false;
  return parseBoundHabitIdsFromExtraData(extraData).includes(trimmed);
}

/** 绑定习惯是否已达成可完成任务的目标 */
export function isHabitGoalMetForTaskBinding(
  habit: HabitRow,
  todayCount: number,
  opts?: { hasDayRecord?: boolean; logicalTodayYmd?: string },
): boolean {
  const kind = parseHabitKind(habit.extra_data);
  if (kind === 'break') {
    if (isBreakHabitSucceeded(habit.extra_data)) return true;
    if (parseHabitConsecutiveTargetDays(habit.extra_data) != null) return false;
    const dailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
    const logicalTodayYmd = opts?.logicalTodayYmd;
    return isBreakHabitDayCompleted({
      todayCount,
      dailyGoal,
      hasDayRecord: opts?.hasDayRecord,
      ymd: logicalTodayYmd,
      logicalTodayYmd,
    });
  }
  if (kind === 'build' && isBuildHabitSucceeded(habit.extra_data)) return true;
  const dailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
  return isHabitDayGoalMet({ kind, todayCount, dailyGoal });
}

async function loadAllTasks(): Promise<TaskRow[]> {
  return getTasks();
}

export async function getTodayHabitCount(habitId: string, logicalTodayYmd?: string): Promise<number> {
  const boundary = await loadTasksDayBoundary();
  const todayYmd = logicalTodayYmd ?? getLogicalLocalYmd(new Date(), boundary);
  const map = await getCheckInsMapByHabitId(habitId);
  return map[todayYmd] ?? 0;
}

/** 任务绑定的全部小习惯均达成目标 */
export async function areAllBoundHabitsGoalMet(
  habitIds: readonly string[],
  options?: {
    logicalTodayYmd?: string;
    todayCountByHabitId?: ReadonlyMap<string, number>;
    hasDayRecordByHabitId?: ReadonlyMap<string, boolean>;
  },
): Promise<boolean> {
  if (habitIds.length === 0) return false;

  const boundary = await loadTasksDayBoundary();
  const logicalTodayYmd = options?.logicalTodayYmd ?? getLogicalLocalYmd(new Date(), boundary);

  for (const habitId of habitIds) {
    const habit = await getHabitById(habitId);
    if (!habit) return false;
    const todayCount =
      options?.todayCountByHabitId?.get(habitId) ??
      (await getTodayHabitCount(habitId, logicalTodayYmd));
    let hasDayRecord = options?.hasDayRecordByHabitId?.get(habitId);
    if (hasDayRecord === undefined && parseHabitKind(habit.extra_data) === 'break') {
      const map = await getCheckInsMapByHabitId(habitId);
      hasDayRecord = Object.prototype.hasOwnProperty.call(map, logicalTodayYmd);
    }
    if (
      !isHabitGoalMetForTaskBinding(habit, todayCount, {
        hasDayRecord,
        logicalTodayYmd,
      })
    ) {
      return false;
    }
  }
  return true;
}

export type HabitBoundTaskSyncChange = Pick<TaskRow, 'id' | 'status' | 'completed_at' | 'title' | 'extra_data'>;

export type CompleteTasksBoundToHabitResult = {
  completedTasks: HabitBoundTaskSyncChange[];
  cascadeChanges: ParentTaskCascadeChange[];
};

async function markTaskDoneFromHabitBinding(task: TaskRow): Promise<HabitBoundTaskSyncChange> {
  const completedAt = formatTaskAuditDatetimeLocal();
  await updateTask(task.id, { status: 'done', completed_at: completedAt });
  try {
    await insertTaskExecutionEvent(task.id, 'completed', task.title ?? null);
  } catch (err) {
    console.warn('记录习惯绑定任务完成事件失败', err);
  }
  try {
    const { applyTaskCompletionPointsReward } = await import(
      '@/lib/repositories/habits/habit-points-grant'
    );
    await applyTaskCompletionPointsReward(task.id, 'earn', task.extra_data);
  } catch (ptsErr) {
    console.warn('习惯绑定任务完成发奖失败', ptsErr);
  }
  return {
    id: task.id,
    status: 'done',
    completed_at: completedAt,
    title: task.title,
    extra_data: task.extra_data,
  };
}

async function completeTaskIfAllBoundHabitsMet(
  task: TaskRow,
  options?: {
    logicalTodayYmd?: string;
    todayCountByHabitId?: ReadonlyMap<string, number>;
  },
): Promise<CompleteTasksBoundToHabitResult> {
  const boundIds = parseBoundHabitIdsFromExtraData(task.extra_data);
  if (boundIds.length === 0) return { completedTasks: [], cascadeChanges: [] };
  if (!(await areAllBoundHabitsGoalMet(boundIds, options))) {
    return { completedTasks: [], cascadeChanges: [] };
  }

  const change = await markTaskDoneFromHabitBinding(task);
  const cascadeChanges = await cascadeParentTaskStatusAfterChildChange(task.id, true);
  for (const cascade of cascadeChanges) {
    try {
      await insertTaskExecutionEvent(
        cascade.id,
        cascade.status === 'done' ? 'completed' : 'reopened',
        cascade.title ?? null,
      );
    } catch (err) {
      console.warn('记录习惯绑定父任务联动事件失败', err);
    }
  }
  return { completedTasks: [change], cascadeChanges };
}

/** 某习惯进度变化后，检查绑定该习惯且全部习惯已达标但未完成的任务 */
export async function completeTasksBoundToHabitIfGoalMet(
  habitId: string,
  options?: {
    habit?: HabitRow | null;
    todayCount?: number;
    logicalTodayYmd?: string;
  },
): Promise<CompleteTasksBoundToHabitResult> {
  const trimmedHabitId = habitId.trim();
  if (!trimmedHabitId) return { completedTasks: [], cascadeChanges: [] };

  const boundary = await loadTasksDayBoundary();
  const logicalTodayYmd = options?.logicalTodayYmd ?? getLogicalLocalYmd(new Date(), boundary);
  const todayCountByHabitId = new Map<string, number>();
  if (options?.todayCount != null) {
    todayCountByHabitId.set(trimmedHabitId, options.todayCount);
  }

  const allTasks = await loadAllTasks();
  const candidates = allTasks.filter((task) => {
    if (isTaskTerminalStatus(task.status) || isTaskShelvedStatus(task.status)) return false;
    return taskHasBoundHabit(task.extra_data, trimmedHabitId);
  });
  if (candidates.length === 0) return { completedTasks: [], cascadeChanges: [] };

  const completedTasks: HabitBoundTaskSyncChange[] = [];
  const cascadeChanges: ParentTaskCascadeChange[] = [];

  for (const task of candidates) {
    const result = await completeTaskIfAllBoundHabitsMet(task, {
      logicalTodayYmd,
      todayCountByHabitId: todayCountByHabitId.size > 0 ? todayCountByHabitId : undefined,
    });
    completedTasks.push(...result.completedTasks);
    cascadeChanges.push(...result.cascadeChanges);
  }

  return { completedTasks, cascadeChanges };
}

/** 按任务检查是否可因习惯绑定而完成（保存绑定时用） */
export async function tryCompleteTaskByBoundHabits(taskId: string): Promise<CompleteTasksBoundToHabitResult> {
  const allTasks = await loadAllTasks();
  const task = allTasks.find((t) => t.id === taskId);
  if (!task || isTaskTerminalStatus(task.status) || isTaskShelvedStatus(task.status)) {
    return { completedTasks: [], cascadeChanges: [] };
  }
  return completeTaskIfAllBoundHabitsMet(task);
}

/** 启动或刷新任务页时，批量检查所有已绑定习惯的任务 */
export async function syncAllHabitBoundTaskCompletions(opts?: {
  allTasks?: TaskRow[];
}): Promise<CompleteTasksBoundToHabitResult> {
  const allTasks = opts?.allTasks ?? (await loadAllTasks());
  const candidates = allTasks.filter((task) => {
    if (isTaskTerminalStatus(task.status) || isTaskShelvedStatus(task.status)) return false;
    return parseBoundHabitIdsFromExtraData(task.extra_data).length > 0;
  });
  if (candidates.length === 0) return { completedTasks: [], cascadeChanges: [] };

  const boundary = await loadTasksDayBoundary();
  const logicalTodayYmd = getLogicalLocalYmd(new Date(), boundary);
  const todayCountByHabitId = await getTodayHabitCountsMap(logicalTodayYmd);

  const completedTasks: HabitBoundTaskSyncChange[] = [];
  const cascadeChanges: ParentTaskCascadeChange[] = [];

  for (const task of candidates) {
    const result = await completeTaskIfAllBoundHabitsMet(task, { logicalTodayYmd, todayCountByHabitId });
    completedTasks.push(...result.completedTasks);
    cascadeChanges.push(...result.cascadeChanges);
  }

  return { completedTasks, cascadeChanges };
}
