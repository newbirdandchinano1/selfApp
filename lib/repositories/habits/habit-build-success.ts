import { tryGrantHabitCompletionReward } from '@/lib/completion-reward/completion-reward-grant';
import { getLogicalLocalYmd, loadTasksDayBoundary, type TasksDayBoundary } from '@/lib/tasks-logical-day';
import { getCheckInsMapByHabitId } from './habit-check-in';
import { getHabitById, getHabits, updateHabit } from './habit';
import type { HabitRow } from './habit.types';
import {
  computeBuildExpectedGoalProgress,
  parseBuildHabitExpectedGoal,
  parseHabitDailyGoal,
} from './habit-goal';
import { parseHabitKind } from './habit-kind';

export type BuildHabitCycleMeta = {
  /** 达成预期目标后记录完成日 */
  completedAt: string | null;
  /** 完成时的进度值（天数或次数） */
  completedValue: number | null;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseExtraObject(extraData: string | null): Record<string, unknown> {
  if (!extraData) return {};
  try {
    const p = JSON.parse(extraData) as unknown;
    if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

function parseYmdField(value: unknown): string | null {
  if (typeof value !== 'string' || !YMD_RE.test(value.trim())) return null;
  return value.trim();
}

function parsePositiveIntField(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n > 0 ? n : null;
}

export function parseBuildHabitCycle(extraData: string | null): BuildHabitCycleMeta {
  const extra = parseExtraObject(extraData);
  const raw = extra.buildHabitCycle;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { completedAt: null, completedValue: null };
  }
  const cycle = raw as Record<string, unknown>;
  return {
    completedAt: parseYmdField(cycle.completedAt),
    completedValue: parsePositiveIntField(cycle.completedValue),
  };
}

/** 养成习惯是否已完成预期目标 */
export function isBuildHabitSucceeded(extraData: string | null): boolean {
  return parseBuildHabitCycle(extraData).completedAt != null;
}

export function mergeBuildHabitCycleExtra(
  extraData: string | null,
  patch: Partial<BuildHabitCycleMeta>
): string {
  const extra = parseExtraObject(extraData);
  const prev = parseBuildHabitCycle(extraData);
  const next: BuildHabitCycleMeta = { ...prev, ...patch };
  return JSON.stringify({
    ...extra,
    buildHabitCycle: {
      completedAt: next.completedAt,
      completedValue: next.completedValue,
    },
  });
}

function shouldEvaluateBuildSuccess(habit: HabitRow): boolean {
  if (parseHabitKind(habit.extra_data) !== 'build') return false;
  if (isBuildHabitSucceeded(habit.extra_data)) return false;
  return parseBuildHabitExpectedGoal(habit.extra_data) != null;
}

/** 检测单条养成习惯是否达成预期目标，达成则写入 extra_data */
export async function tryMarkBuildHabitCompleted(
  habit: HabitRow,
  todayYmd: string,
  checkIns?: Record<string, number>,
  boundary?: TasksDayBoundary
): Promise<boolean> {
  void boundary;
  if (!shouldEvaluateBuildSuccess(habit)) return false;

  const expectedGoal = parseBuildHabitExpectedGoal(habit.extra_data);
  if (expectedGoal == null) return false;

  const dailyGoal = parseHabitDailyGoal(habit.extra_data, 'build');
  const map = checkIns ?? (await getCheckInsMapByHabitId(habit.id));
  const progress = computeBuildExpectedGoalProgress({
    expectedGoal,
    checkIns: map,
    dailyGoal,
    endYmd: todayYmd,
    kind: 'build',
  });

  if (progress < expectedGoal.value) return false;

  const extra = mergeBuildHabitCycleExtra(habit.extra_data, {
    completedAt: todayYmd,
    completedValue: progress,
  });
  await updateHabit(habit.id, { extra_data: extra });
  try {
    await tryGrantHabitCompletionReward({
      id: habit.id,
      name: habit.name,
      extra_data: extra,
    });
  } catch (err) {
    console.warn('发放养成习惯完成奖励失败', err);
  }
  return true;
}

/** 批量同步所有进行中的养成习惯完成状态 */
export async function syncBuildHabitCompletions(): Promise<void> {
  const boundary = await loadTasksDayBoundary();
  const todayYmd = getLogicalLocalYmd(new Date(), boundary);
  const habits = await getHabits();
  const candidates = habits.filter(shouldEvaluateBuildSuccess);
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map(async (habit) => {
      try {
        await tryMarkBuildHabitCompleted(habit, todayYmd, undefined, boundary);
      } catch (err) {
        console.warn('同步养成习惯完成状态失败', habit.id, err);
      }
    })
  );
}

/** 清除养成完成标记（编辑时若下调目标或取消预期目标） */
export async function clearBuildHabitCompletion(habitId: string): Promise<void> {
  const habit = await getHabitById(habitId);
  if (!habit) return;
  if (parseHabitKind(habit.extra_data) !== 'build') return;
  if (!isBuildHabitSucceeded(habit.extra_data)) return;

  const extra = mergeBuildHabitCycleExtra(habit.extra_data, {
    completedAt: null,
    completedValue: null,
  });
  await updateHabit(habitId, { extra_data: extra });
}
