import type { UserRow } from '@/lib/repositories/users/user.types';

export const USER_WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

const CN_WEEKDAY_FROM_JS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export type UserDayScheduleKind = 'sedentary' | 'workout' | 'rest';

export function parseUserWeekDaysJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is (typeof USER_WEEK_DAYS)[number] =>
        typeof d === 'string' && (USER_WEEK_DAYS as readonly string[]).includes(d),
    );
  } catch {
    return [];
  }
}

export function isFitnessLifestyle(lifestyle?: string | null): boolean {
  return lifestyle === '健身' || lifestyle === '高强度锻炼';
}

export function getChineseWeekdayLabelFromYmd(ymd: string): (typeof CN_WEEKDAY_FROM_JS)[number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return CN_WEEKDAY_FROM_JS[date.getDay()];
}

/** 根据档案健身日与日期判断今日为健身日、休息日或静坐习惯（无周计划） */
export function getUserDayScheduleKind(user: UserRow, ymd: string): UserDayScheduleKind {
  if (!isFitnessLifestyle(user.lifestyle)) return 'sedentary';
  const label = getChineseWeekdayLabelFromYmd(ymd);
  if (!label) return 'rest';
  const workout = parseUserWeekDaysJson(user.workout_days);
  return workout.includes(label) ? 'workout' : 'rest';
}

export function getUserDayScheduleLabelZh(kind: UserDayScheduleKind): string {
  if (kind === 'workout') return '健身日';
  if (kind === 'rest') return '休息日';
  return '静坐习惯';
}

/** 未选中的星期视为休息日 */
export function deriveRestDaysFromWorkoutDays(workoutDays: string[]): string[] {
  const set = new Set(workoutDays);
  return USER_WEEK_DAYS.filter((d) => !set.has(d));
}

export function formatUserWorkoutWeekPlanZh(user: UserRow): string {
  if (!isFitnessLifestyle(user.lifestyle)) return '（未设定周训练计划）';
  const workout = parseUserWeekDaysJson(user.workout_days);
  if (workout.length === 0) return '健身日：未设定（本周每日按休息日估算）';
  const rest = USER_WEEK_DAYS.filter((d) => !workout.includes(d));
  return `健身日：${workout.join('、')}；休息日：${rest.join('、')}`;
}
