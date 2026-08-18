import {
  getDayBoundarySync,
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import { getCheckInsMapByHabitId } from './habit-check-in';
import { getHabitById, getHabits, updateHabit } from './habit';
import type { HabitRow } from './habit.types';
import {
  computeConsecutiveGoalMetDays,
  parseHabitConsecutiveTargetDays,
  parseHabitDailyGoal,
} from './habit-goal';
import { parseHabitKind } from './habit-kind';

export type BreakHabitCycleMeta = {
  /** 当前挑战周期起始日（重启后更新） */
  cycleStartedAt: string | null;
  /** 达成连续目标后记录完成日 */
  completedAt: string | null;
  /** 完成时的连续达标天数 */
  completedStreak: number | null;
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

export function parseBreakHabitCycle(extraData: string | null): BreakHabitCycleMeta {
  const extra = parseExtraObject(extraData);
  const raw = extra.breakHabitCycle;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { cycleStartedAt: null, completedAt: null, completedStreak: null };
  }
  const cycle = raw as Record<string, unknown>;
  return {
    cycleStartedAt: parseYmdField(cycle.cycleStartedAt),
    completedAt: parseYmdField(cycle.completedAt),
    completedStreak: parsePositiveIntField(cycle.completedStreak),
  };
}

/** 戒坏习惯是否已完成连续目标挑战 */
export function isBreakHabitSucceeded(extraData: string | null): boolean {
  return parseBreakHabitCycle(extraData).completedAt != null;
}

export function mergeBreakHabitCycleExtra(
  extraData: string | null,
  patch: Partial<BreakHabitCycleMeta>
): string {
  const extra = parseExtraObject(extraData);
  const prev = parseBreakHabitCycle(extraData);
  const next: BreakHabitCycleMeta = { ...prev, ...patch };
  return JSON.stringify({
    ...extra,
    breakHabitCycle: {
      cycleStartedAt: next.cycleStartedAt,
      completedAt: next.completedAt,
      completedStreak: next.completedStreak,
    },
  });
}

/** 戒除挑战计日起点：优先周期字段，否则用习惯创建日的逻辑日 */
export function resolveBreakCycleStartYmd(
  cycle: BreakHabitCycleMeta,
  habitCreatedAt: string | null | undefined,
  boundary?: TasksDayBoundary
): string | null {
  if (cycle.cycleStartedAt) return cycle.cycleStartedAt;
  if (!habitCreatedAt?.trim()) return null;
  const created = new Date(habitCreatedAt);
  if (Number.isNaN(created.getTime())) return null;
  return getLogicalLocalYmd(created, boundary ?? getDayBoundarySync());
}

export function ensureBreakHabitCycleExtra(
  extraData: string | null,
  cycleStartedAt?: string | null
): string {
  const extra = parseExtraObject(extraData);
  if (extra.breakHabitCycle && typeof extra.breakHabitCycle === 'object') return extraData ?? '{}';
  return mergeBreakHabitCycleExtra(extraData, {
    cycleStartedAt: cycleStartedAt ?? null,
    completedAt: null,
    completedStreak: null,
  });
}

export function computeActiveBreakStreak(
  checkIns: Record<string, number>,
  endYmd: string,
  dailyGoal: number | null,
  cycle: BreakHabitCycleMeta,
  habitCreatedAt?: string | null,
  boundary?: TasksDayBoundary
): number {
  return computeConsecutiveGoalMetDays({
    checkIns,
    endYmd,
    kind: 'break',
    dailyGoal,
    minYmd: resolveBreakCycleStartYmd(cycle, habitCreatedAt, boundary),
    logicalTodayYmd: endYmd,
  });
}

function shouldEvaluateBreakSuccess(habit: HabitRow): boolean {
  if (parseHabitKind(habit.extra_data) !== 'break') return false;
  if (isBreakHabitSucceeded(habit.extra_data)) return false;
  return parseHabitConsecutiveTargetDays(habit.extra_data) != null;
}

/** 旧数据缺少 cycleStartedAt 时补写创建日，并撤销误触发的「戒除成功」 */
async function repairBreakHabitCycleIfNeeded(
  habit: HabitRow,
  todayYmd: string,
  boundary: TasksDayBoundary
): Promise<HabitRow> {
  const cycle = parseBreakHabitCycle(habit.extra_data);
  if (cycle.cycleStartedAt) return habit;

  const createdYmd = resolveBreakCycleStartYmd(cycle, habit.created_at, boundary);
  if (!createdYmd) return habit;

  let extra = mergeBreakHabitCycleExtra(habit.extra_data, { cycleStartedAt: createdYmd });
  let next = { ...habit, extra_data: extra };

  if (isBreakHabitSucceeded(extra)) {
    const target = parseHabitConsecutiveTargetDays(extra);
    const dailyGoal = parseHabitDailyGoal(extra, 'break');
    const repairedCycle = parseBreakHabitCycle(extra);
    const map = await getCheckInsMapByHabitId(habit.id);
    const streak = computeActiveBreakStreak(map, todayYmd, dailyGoal, repairedCycle, habit.created_at, boundary);
    if (target == null || streak < target) {
      extra = mergeBreakHabitCycleExtra(extra, { completedAt: null, completedStreak: null });
      next = { ...habit, extra_data: extra };
    }
  }

  await updateHabit(habit.id, { extra_data: extra });
  return next;
}

/** 检测单条戒除习惯是否达成连续目标，达成则写入 extra_data */
export async function tryMarkBreakHabitCompleted(
  habit: HabitRow,
  todayYmd: string,
  checkIns?: Record<string, number>,
  boundary?: TasksDayBoundary
): Promise<boolean> {
  if (!shouldEvaluateBreakSuccess(habit)) return false;

  const target = parseHabitConsecutiveTargetDays(habit.extra_data);
  if (target == null) return false;

  const resolvedBoundary = boundary ?? (await loadTasksDayBoundary());
  const dailyGoal = parseHabitDailyGoal(habit.extra_data, 'break');
  const cycle = parseBreakHabitCycle(habit.extra_data);
  const map = checkIns ?? (await getCheckInsMapByHabitId(habit.id));
  const streak = computeActiveBreakStreak(
    map,
    todayYmd,
    dailyGoal,
    cycle,
    habit.created_at,
    resolvedBoundary
  );

  if (streak < target) return false;

  const extra = mergeBreakHabitCycleExtra(habit.extra_data, {
    completedAt: todayYmd,
    completedStreak: streak,
  });
  await updateHabit(habit.id, { extra_data: extra });
  try {
    const { applyHabitGoalPointsReward } = await import(
      '@/lib/repositories/habits/habit-points-grant'
    );
    await applyHabitGoalPointsReward(habit.id, 'earn', { extraData: extra });
  } catch (ptsErr) {
    console.warn('戒除习惯达成目标发奖失败', habit.id, ptsErr);
  }
  return true;
}

/** 批量同步所有进行中的戒除习惯完成状态 */
export async function syncBreakHabitCompletions(): Promise<void> {
  const boundary = await loadTasksDayBoundary();
  const todayYmd = getLogicalLocalYmd(new Date(), boundary);
  const habits = await getHabits();
  const breakHabits = habits.filter((h) => parseHabitKind(h.extra_data) === 'break');
  if (breakHabits.length === 0) return;

  const repaired = await Promise.all(
    breakHabits.map(async (habit) => {
      try {
        return await repairBreakHabitCycleIfNeeded(habit, todayYmd, boundary);
      } catch (err) {
        console.warn('修复戒除习惯周期失败', habit.id, err);
        return habit;
      }
    })
  );

  const candidates = repaired.filter(shouldEvaluateBreakSuccess);
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map(async (habit) => {
      try {
        await tryMarkBreakHabitCompleted(habit, todayYmd, undefined, boundary);
      } catch (err) {
        console.warn('同步戒除习惯完成状态失败', habit.id, err);
      }
    })
  );
}

/** 重启戒除习惯挑战：清除完成标记，从今日起重新计连续天数；已拿过的目标积分扣回 */
export async function restartBreakHabit(habitId: string): Promise<void> {
  const habit = await getHabitById(habitId);
  if (!habit) return;
  if (parseHabitKind(habit.extra_data) !== 'break') return;

  const wasSucceeded = isBreakHabitSucceeded(habit.extra_data);
  const boundary = await loadTasksDayBoundary();
  const todayYmd = getLogicalLocalYmd(new Date(), boundary);
  const extra = mergeBreakHabitCycleExtra(habit.extra_data, {
    cycleStartedAt: todayYmd,
    completedAt: null,
    completedStreak: null,
  });
  await updateHabit(habitId, { extra_data: extra });
  if (wasSucceeded) {
    try {
      const { applyHabitGoalPointsReward } = await import(
        '@/lib/repositories/habits/habit-points-grant'
      );
      await applyHabitGoalPointsReward(habitId, 'undo', {
        forceUndo: true,
        extraData: habit.extra_data,
      });
    } catch (ptsErr) {
      console.warn('戒除习惯重启扣回积分失败', habitId, ptsErr);
    }
  }
}
