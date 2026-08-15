import { parseHabitRewardPoints } from '@/lib/repositories/habits/habit-reward-points';
import {
  applyCompletionPointsReward,
  applyEntityPointsReward,
} from '@/lib/repositories/points/completion-points-grant';
import { getHabitById } from '@/lib/repositories/habits/habit';

/**
 * 习惯打卡成功发奖 / 撤销扣回。
 * @returns 实际变动的积分数（正=获得，负=扣回）；0 表示无配置或未变动
 */
export async function applyHabitCheckInPointsReward(
  habitId: string,
  direction: 'earn' | 'undo',
  opts?: { forceUndo?: boolean; extraData?: string | null },
): Promise<number> {
  const row = await getHabitById(habitId);
  if (!row) return 0;
  const extraData = opts?.extraData !== undefined ? opts.extraData : row.extra_data;
  const points = parseHabitRewardPoints(extraData);
  if (points <= 0) return 0;
  return applyEntityPointsReward({
    refType: 'habit',
    refId: habitId,
    direction,
    points,
    extraData,
    earnReason: 'habit_check_in',
    undoReason: 'habit_check_in_undo',
    forceUndo: opts?.forceUndo,
  });
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
