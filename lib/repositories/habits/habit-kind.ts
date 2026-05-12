/** 打卡目的：养成正向习惯 / 戒除坏习惯（存于 habits.extra_data.habitKind） */
export type HabitKind = 'build' | 'break';

export const DEFAULT_HABIT_KIND: HabitKind = 'build';

export function parseHabitKind(extraData: string | null): HabitKind {
  if (!extraData) return DEFAULT_HABIT_KIND;
  try {
    const p = JSON.parse(extraData) as { habitKind?: unknown };
    if (p?.habitKind === 'break') return 'break';
    return 'build';
  } catch {
    return DEFAULT_HABIT_KIND;
  }
}
