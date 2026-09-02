import { parseHabitRewardPoints } from '@/lib/repositories/habits/habit-reward-points';
import {
  applyCompletionPointsReward,
  applyEntityPointsReward,
} from '@/lib/repositories/points/completion-points-grant';
import { getHabitById } from '@/lib/repositories/habits/habit';

async function applyHabitPointsReward(
  habitId: string,
  direction: 'earn' | 'undo',
  reasons: { earnReason: string; undoReason: string },
  opts?: { forceUndo?: boolean; extraData?: string | null },
): Promise<number> {
  const row = await getHabitById(habitId);
  if (!row) return 0;
  const extraData = opts?.extraData !== undefined ? opts.extraData : row.extra_data;
  const points = parseHabitRewardPoints(extraData);
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
 * 养成类：每次完成打卡发奖 / 撤销扣回。
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
 * 任务类周期目标 / 戒除类挑战目标：达成时发整包积分 / 目标回退或重启时扣回。
 */
export async function applyHabitGoalPointsReward(
  habitId: string,
  direction: 'earn' | 'undo',
  opts?: { forceUndo?: boolean; extraData?: string | null },
): Promise<number> {
  return applyHabitPointsReward(
    habitId,
    direction,
    { earnReason: 'habit_goal_complete', undoReason: 'habit_goal_complete_undo' },
    opts,
  );
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
