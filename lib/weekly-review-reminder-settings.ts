import { AppSettingKey, getAppSettingRaw, removeAppSetting, setAppSetting } from '@/lib/app-settings-store';

export type WeeklyReviewReminderSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
};

/** 默认早于日复盘 21:00，避免同刻双推 */
const DEFAULT_HOUR = 20;
const DEFAULT_MINUTE = 0;

function clampHour(n: number): number {
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function clampMinute(n: number): number {
  return Math.max(0, Math.min(59, Math.floor(n)));
}

export function formatWeeklyReviewReminderClock(hour: number, minute: number): string {
  const h = clampHour(hour);
  const m = clampMinute(minute);
  return `${h < 10 ? `0${h}` : h}:${m < 10 ? `0${m}` : m}`;
}

export function weeklyReviewReminderTimeToDate(hour: number, minute: number): Date {
  return new Date(2000, 0, 1, clampHour(hour), clampMinute(minute), 0, 0);
}

export function readWeeklyReviewReminderTimeFromDate(date: Date): { hour: number; minute: number } {
  return {
    hour: clampHour(date.getHours()),
    minute: clampMinute(date.getMinutes()),
  };
}

export async function getWeeklyReviewReminderSettings(): Promise<WeeklyReviewReminderSettings> {
  const [enabledRaw, hourRaw, minuteRaw] = await Promise.all([
    getAppSettingRaw(AppSettingKey.weeklyReviewReminderEnabled),
    getAppSettingRaw(AppSettingKey.weeklyReviewReminderHour),
    getAppSettingRaw(AppSettingKey.weeklyReviewReminderMinute),
  ]);

  const enabled = enabledRaw === '1' || enabledRaw === 'true';
  const hourParsed = hourRaw != null && hourRaw !== '' ? Number(hourRaw) : DEFAULT_HOUR;
  const minuteParsed = minuteRaw != null && minuteRaw !== '' ? Number(minuteRaw) : DEFAULT_MINUTE;

  return {
    enabled,
    hour: Number.isFinite(hourParsed) ? clampHour(hourParsed) : DEFAULT_HOUR,
    minute: Number.isFinite(minuteParsed) ? clampMinute(minuteParsed) : DEFAULT_MINUTE,
  };
}

export async function setWeeklyReviewReminderSettings(
  settings: WeeklyReviewReminderSettings,
): Promise<void> {
  const hour = clampHour(settings.hour);
  const minute = clampMinute(settings.minute);

  if (!settings.enabled) {
    await Promise.all([
      removeAppSetting(AppSettingKey.weeklyReviewReminderEnabled),
      setAppSetting(AppSettingKey.weeklyReviewReminderHour, String(hour)),
      setAppSetting(AppSettingKey.weeklyReviewReminderMinute, String(minute)),
    ]);
    return;
  }

  await Promise.all([
    setAppSetting(AppSettingKey.weeklyReviewReminderEnabled, '1'),
    setAppSetting(AppSettingKey.weeklyReviewReminderHour, String(hour)),
    setAppSetting(AppSettingKey.weeklyReviewReminderMinute, String(minute)),
  ]);
}
