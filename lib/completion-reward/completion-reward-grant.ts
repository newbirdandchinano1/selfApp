import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { grantEarnedRewardFromExtraData } from '@/lib/repositories/earned-rewards/earned-reward';

export async function tryGrantTaskCompletionReward(task: Pick<TaskRow, 'id' | 'title' | 'extra_data'>): Promise<void> {
  try {
    await grantEarnedRewardFromExtraData({
      sourceType: 'task',
      sourceId: task.id,
      sourceTitle: task.title,
      extraData: task.extra_data,
    });
  } catch (e) {
    console.warn('发放任务完成奖励失败', e);
  }
}

export async function tryGrantProjectCompletionReward(
  project: Pick<ProjectRow, 'id' | 'name' | 'extra_data'>,
): Promise<void> {
  try {
    await grantEarnedRewardFromExtraData({
      sourceType: 'project',
      sourceId: project.id,
      sourceTitle: project.name,
      extraData: project.extra_data,
    });
  } catch (e) {
    console.warn('发放项目完成奖励失败', e);
  }
}

export async function tryGrantHabitCompletionReward(
  habit: Pick<HabitRow, 'id' | 'name' | 'extra_data'>,
): Promise<void> {
  try {
    await grantEarnedRewardFromExtraData({
      sourceType: 'habit',
      sourceId: habit.id,
      sourceTitle: habit.name,
      extraData: habit.extra_data,
    });
  } catch (e) {
    console.warn('发放习惯完成奖励失败', e);
  }
}
