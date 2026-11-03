/** 打卡目的：养成 / 戒除 / 周期配额（存于 habits.extra_data.habitKind；值为 task） */
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

/** 用户可见完整类型名 */
export function habitKindLabel(kind: HabitKind): string {
  if (kind === 'break') return '戒除';
  if (kind === 'task') return '周期配额';
  return '养成';
}

/** 卡片徽章等短标签 */
export function habitKindBadgeLabel(kind: HabitKind): string {
  if (kind === 'break') return '戒除';
  if (kind === 'task') return '配额';
  return '养成';
}
