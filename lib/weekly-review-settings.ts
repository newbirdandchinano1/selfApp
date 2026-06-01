import { AppSettingKey, getAppSettingRaw, removeAppSetting, setAppSetting } from '@/lib/app-settings-store';

/** 与 `Date.getDay()` 一致：0=周日 … 6=周六 */
export const WEEKLY_REVIEW_WEEKDAY_LABELS: readonly string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export async function getWeeklyReviewConfiguredWeekday(): Promise<number | null> {
  const raw = await getAppSettingRaw(AppSettingKey.weeklyReviewWeekday);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 6) return null;
  return n;
}

export async function setWeeklyReviewConfiguredWeekday(dow: number): Promise<void> {
  const n = Math.round(dow);
  if (n < 0 || n > 6) throw new Error('invalid weekday');
  await setAppSetting(AppSettingKey.weeklyReviewWeekday, String(n));
}

/** 清除周复盘「固定星期几」配置（与云端 null 对齐）。 */
export async function clearWeeklyReviewConfiguredWeekday(): Promise<void> {
  await removeAppSetting(AppSettingKey.weeklyReviewWeekday);
}

export function isTodayConfiguredWeeklyReviewDay(configuredDow: number, now: Date = new Date()): boolean {
  return now.getDay() === configuredDow;
}

/** 周期终点（每周复盘日）当天不做日复盘，改填周复盘。 */
export function isDailyReviewSkippedOnWeeklyReviewDay(
  ymd: string,
  cycleEndYmd: string,
  configuredDow: number | null,
): boolean {
  return configuredDow !== null && ymd === cycleEndYmd;
}
