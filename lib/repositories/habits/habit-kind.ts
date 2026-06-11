/** 打卡目的：养成 / 戒除 / 周期完成任务（存于 habits.extra_data.habitKind） */
export type HabitKind = 'build' | 'break' | 'task';

export const DEFAULT_HABIT_KIND: HabitKind = 'build';

export function parseHabitKind(extraData: string | null): HabitKind {
  if (!extraData) return DEFAULT_HABIT_KIND;
  try {
    const p = JSON.parse(extraData) as { habitKind?: unknown };
    if (p?.habitKind === 'break') return 'break';
    if (p?.habitKind === 'task') return 'task';
    return 'build';
  } catch {
    return DEFAULT_HABIT_KIND;
  }
}
