import {
  normalizeHabitRewardPoints,
  parseHabitRewardPoints,
} from '@/lib/repositories/habits/habit-reward-points';
import {
  applyCompletionPointsReward,
  applyEntityPointsReward,
} from '@/lib/repositories/points/completion-points-grant';
import { getHabitById } from '@/lib/repositories/habits/habit';
import { isHabitDayGoalMet } from '@/lib/repositories/habits/habit-goal';

function parseBreakReward(extraData: string | null | undefined, field: 'penalty' | 'clean' | 'goal'): number {
  try {
    const extra = extraData ? JSON.parse(extraData) as Record<string, unknown> : {};
    const rewards = extra.breakRewards;
    if (rewards && typeof rewards === 'object' && !Array.isArray(rewards)) {
      // breakRewards.penalty/clean/goal 存的是裸数字，不能走 parseHabitRewardPoints（它只认 { reward_points }）
      return normalizeHabitRewardPoints((rewards as Record<string, unknown>)[field]);
    }
  } catch {
    // ignore malformed optional reward metadata
  }
  // 旧版戒除习惯：单一 reward_points 即「达成连续目标」的奖励
  if (field === 'goal') return parseHabitRewardPoints(extraData);
  return 0;
}

/** 读取戒除习惯三项积分配置（破戒扣分 / 未破戒加分 / 达成加分） */
export function parseBreakHabitReward(
  extraData: string | null | undefined,
  field: 'penalty' | 'clean' | 'goal',
): number {
  return parseBreakReward(extraData, field);
}

async function applyHabitPointsReward(
  habitId: string,
  direction: 'earn' | 'undo',
  reasons: { earnReason: string; undoReason: string },
  opts?: { forceUndo?: boolean; extraData?: string | null; points?: number },
): Promise<number> {
  const row = await getHabitById(habitId);
  if (!row) return 0;
  const extraData = opts?.extraData !== undefined ? opts.extraData : row.extra_data;
  const points = opts?.points ?? parseHabitRewardPoints(extraData);
  if (points === 0) return 0;
  return applyEntityPointsReward({
    refType: 'habit',
    refId: habitId,
    direction,
    points,
    extraData,
    earnReason: reasons.earnReason,
    undoReason: reasons.undoReason,
    forceUndo: opts?.forceUndo,
  });
}

/**
 * 养成类：当日目标达成发奖 / 从达成回退扣回（底层读写，通常经 syncBuildHabitDayPointsReward）。
 * @returns 实际变动的积分数（正=获得，负=扣回）；0 表示无配置或未变动
 */
export async function applyHabitCheckInPointsReward(
  habitId: string,
  direction: 'earn' | 'undo',
  opts?: { forceUndo?: boolean; extraData?: string | null },
): Promise<number> {
  return applyHabitPointsReward(
    habitId,
    direction,
    { earnReason: 'habit_check_in', undoReason: 'habit_check_in_undo' },
    opts,
  );
}

/**
 * 养成类：根据当日目标是否刚达成 / 刚回退，发奖或扣回。
 * 有每日目标时须次数达标才发；不限次数时首次打卡即算达成。中间进度打卡不发积分。
 * @returns 实际变动积分；0 表示无配置或未跨过达成边界
 */
export async function syncBuildHabitDayPointsReward(params: {
  habitId: string;
  prevCount: number;
  nextCount: number;
  dailyGoal: number | null;
  extraData?: string | null;
}): Promise<number> {
  const wasMet = isHabitDayGoalMet({
    kind: 'build',
    todayCount: params.prevCount,
    dailyGoal: params.dailyGoal,
  });
  const nowMet = isHabitDayGoalMet({
    kind: 'build',
    todayCount: params.nextCount,
    dailyGoal: params.dailyGoal,
  });
  if (!wasMet && nowMet) {
    return applyHabitCheckInPointsReward(params.habitId, 'earn', {
      extraData: params.extraData,
    });
  }
  if (wasMet && !nowMet) {
    return applyHabitCheckInPointsReward(params.habitId, 'undo', {
      forceUndo: true,
      extraData: params.extraData,
    });
  }
  return 0;
}

/**
 * 任务类周期目标 / 戒除类挑战目标：达成时发整包积分 / 目标回退或重启时扣回。
 */
export async function applyHabitGoalPointsReward(
  habitId: string,
  direction: 'earn' | 'undo',
  opts?: { forceUndo?: boolean; extraData?: string | null; points?: number },
): Promise<number> {
  return applyHabitPointsReward(
    habitId,
    direction,
    { earnReason: 'habit_goal_complete', undoReason: 'habit_goal_complete_undo' },
    opts,
  );
}

export async function applyBreakHabitReward(
  habitId: string,
  field: 'penalty' | 'clean' | 'goal',
  direction: 'earn' | 'undo' = 'earn',
  opts?: { forceUndo?: boolean; extraData?: string | null },
): Promise<number> {
  const extraData = opts?.extraData !== undefined ? opts.extraData : (await getHabitById(habitId))?.extra_data;
  const raw = applyBreakReward(extraData, field);
  // 破戒扣分：无论用户填正数还是负数，均按扣除处理
  const points = field === 'penalty' ? -Math.abs(raw) : raw;
  return applyHabitPointsReward(
    habitId,
    direction,
    { earnReason: `break_habit_${field}`, undoReason: `break_habit_${field}_undo` },
    { ...opts, extraData, points },
  );
}

function applyBreakReward(extraData: string | null | undefined, field: 'penalty' | 'clean' | 'goal'): number {
  return parseBreakReward(extraData, field);
}

/**
 * 任务类小习惯：根据周期目标是否刚达成 / 刚回退，发整包积分或扣回。
 * @returns 实际变动积分；0 表示无配置或未跨过达成边界
 */
export async function syncTaskHabitPeriodPointsReward(params: {
  habitId: string;
  extraData: string | null;
  logicalYmd: string;
  wasPeriodMet: boolean;
}): Promise<number> {
  const { getCheckInsMapByHabitId } = await import('@/lib/repositories/habits/habit-check-in');
  const { isTaskHabitPeriodGoalMet } = await import('@/lib/repositories/habits/habit-task-period');
  const map = await getCheckInsMapByHabitId(params.habitId);
  const nowMet = isTaskHabitPeriodGoalMet({
    extraData: params.extraData,
    checkIns: map,
    logicalYmd: params.logicalYmd,
  });
  if (!params.wasPeriodMet && nowMet) {
    return applyHabitGoalPointsReward(params.habitId, 'earn', { extraData: params.extraData });
  }
  if (params.wasPeriodMet && !nowMet) {
    return applyHabitGoalPointsReward(params.habitId, 'undo', {
      forceUndo: true,
      extraData: params.extraData,
    });
  }
  return 0;
}

export async function applyTaskCompletionPointsReward(
  taskId: string,
  direction: 'earn' | 'undo',
  extraData?: string | null,
  opts?: { forceUndo?: boolean },
): Promise<number> {
  return applyCompletionPointsReward({
    refType: 'task',
    refId: taskId,
    direction,
    extraData,
    forceUndo: opts?.forceUndo,
  });
}

export async function applyProjectCompletionPointsReward(
  projectId: string,
  direction: 'earn' | 'undo',
  extraData?: string | null,
  opts?: { forceUndo?: boolean },
): Promise<number> {
  return applyCompletionPointsReward({
    refType: 'project',
    refId: projectId,
    direction,
    extraData,
    forceUndo: opts?.forceUndo,
  });
}
