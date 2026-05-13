import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'weekly_review_weekday_dow';

/** 与 `Date.getDay()` 一致：0=周日 … 6=周六 */
export const WEEKLY_REVIEW_WEEKDAY_LABELS: readonly string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export async function getWeeklyReviewConfiguredWeekday(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 6) return null;
  return n;
}

export async function setWeeklyReviewConfiguredWeekday(dow: number): Promise<void> {
  const n = Math.round(dow);
  if (n < 0 || n > 6) throw new Error('invalid weekday');
  await AsyncStorage.setItem(STORAGE_KEY, String(n));
}

export function isTodayConfiguredWeeklyReviewDay(configuredDow: number, now: Date = new Date()): boolean {
  return now.getDay() === configuredDow;
}
