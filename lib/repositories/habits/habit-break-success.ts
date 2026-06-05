import { getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';
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

export function ensureBreakHabitCycleExtra(extraData: string | null): string {
  const extra = parseExtraObject(extraData);
  if (extra.breakHabitCycle && typeof extra.breakHabitCycle === 'object') return extraData ?? '{}';
  return mergeBreakHabitCycleExtra(extraData, {
    cycleStartedAt: null,
    completedAt: null,
    completedStreak: null,
  });
}

export function computeActiveBreakStreak(
  checkIns: Record<string, number>,
  endYmd: string,
  dailyGoal: number | null,
  cycle: BreakHabitCycleMeta
): number {
  return computeConsecutiveGoalMetDays({
    checkIns,
    endYmd,
    kind: 'break',
    dailyGoal,
    minYmd: cycle.cycleStartedAt,
  });
}

function shouldEvaluateBreakSuccess(habit: HabitRow): boolean {
  if (parseHabitKind(habit.extra_data) !== 'break') return false;
  if (isBreakHabitSucceeded(habit.extra_data)) return false;
  return parseHabitConsecutiveTargetDays(habit.extra_data) != null;
}

/** 检测单条戒除习惯是否达成连续目标，达成则写入 extra_data */
export async function tryMarkBreakHabitCompleted(
  habit: HabitRow,
  todayYmd: string,
  checkIns?: Record<string, number>
): Promise<boolean> {
  if (!shouldEvaluateBreakSuccess(habit)) return false;

  const target = parseHabitConsecutiveTargetDays(habit.extra_data);
  if (target == null) return false;

  const dailyGoal = parseHabitDailyGoal(habit.extra_data, 'break');
  const cycle = parseBreakHabitCycle(habit.extra_data);
  const map = checkIns ?? (await getCheckInsMapByHabitId(habit.id));
  const streak = computeActiveBreakStreak(map, todayYmd, dailyGoal, cycle);

  if (streak < target) return false;

  const extra = mergeBreakHabitCycleExtra(habit.extra_data, {
    completedAt: todayYmd,
    completedStreak: streak,
  });
  await updateHabit(habit.id, { extra_data: extra });
  return true;
}

/** 批量同步所有进行中的戒除习惯完成状态 */
export async function syncBreakHabitCompletions(): Promise<void> {
  const boundary = await loadTasksDayBoundary();
  const todayYmd = getLogicalLocalYmd(new Date(), boundary);
  const habits = await getHabits();
  const candidates = habits.filter(shouldEvaluateBreakSuccess);
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map(async (habit) => {
      try {
        await tryMarkBreakHabitCompleted(habit, todayYmd);
      } catch (err) {
        console.warn('同步戒除习惯完成状态失败', habit.id, err);
      }
    })
  );
}

/** 重启戒除习惯挑战：清除完成标记，从今日起重新计连续天数 */
export async function restartBreakHabit(habitId: string): Promise<void> {
  const habit = await getHabitById(habitId);
  if (!habit) return;
  if (parseHabitKind(habit.extra_data) !== 'break') return;

  const boundary = await loadTasksDayBoundary();
  const todayYmd = getLogicalLocalYmd(new Date(), boundary);
  const extra = mergeBreakHabitCycleExtra(habit.extra_data, {
    cycleStartedAt: todayYmd,
    completedAt: null,
    completedStreak: null,
  });
  await updateHabit(habitId, { extra_data: extra });
}
