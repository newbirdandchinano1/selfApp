import { AppSettingKey, getAppSettingRaw, removeAppSetting, setAppSetting } from '@/lib/app-settings-store';

export type DailyReviewReminderSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
};

const DEFAULT_HOUR = 21;
const DEFAULT_MINUTE = 0;

function clampHour(n: number): number {
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function clampMinute(n: number): number {
  return Math.max(0, Math.min(59, Math.floor(n)));
}

export function formatDailyReviewReminderClock(hour: number, minute: number): string {
  const h = clampHour(hour);
  const m = clampMinute(minute);
  return `${h < 10 ? `0${h}` : h}:${m < 10 ? `0${m}` : m}`;
}

export async function getDailyReviewReminderSettings(): Promise<DailyReviewReminderSettings> {
  const [enabledRaw, hourRaw, minuteRaw] = await Promise.all([
    getAppSettingRaw(AppSettingKey.dailyReviewReminderEnabled),
    getAppSettingRaw(AppSettingKey.dailyReviewReminderHour),
    getAppSettingRaw(AppSettingKey.dailyReviewReminderMinute),
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

export async function setDailyReviewReminderSettings(
  settings: DailyReviewReminderSettings,
): Promise<void> {
  const hour = clampHour(settings.hour);
  const minute = clampMinute(settings.minute);

  if (!settings.enabled) {
    await Promise.all([
      removeAppSetting(AppSettingKey.dailyReviewReminderEnabled),
      setAppSetting(AppSettingKey.dailyReviewReminderHour, String(hour)),
      setAppSetting(AppSettingKey.dailyReviewReminderMinute, String(minute)),
    ]);
    return;
  }

  await Promise.all([
    setAppSetting(AppSettingKey.dailyReviewReminderEnabled, '1'),
    setAppSetting(AppSettingKey.dailyReviewReminderHour, String(hour)),
    setAppSetting(AppSettingKey.dailyReviewReminderMinute, String(minute)),
  ]);
}
