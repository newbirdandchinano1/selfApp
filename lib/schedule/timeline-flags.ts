/**
 * 日程表时间线重构 · 特性开关（阶段 A）
 *
 * 默认双关：旧课表 UI + 旧格子写入。后续阶段再接线；关开关即回滚。
 * 键名与方案 §3.6 对齐，落 `app_settings`。
 */
import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';

/** 是否展示新日视图时间线（阶段 F 接线；默认关） */
export const SCHEDULE_TIMELINE_UI_FLAG_KEY = AppSettingKey.scheduleTimelineUiV1;

/** 是否允许按分钟写入（阶段 G 接线；默认关） */
export const SCHEDULE_TIMELINE_WRITE_FLAG_KEY = AppSettingKey.scheduleTimelineWriteV1;

/**
 * 阶段 A 起藏入口；阶段 L 再删代码。
 * 改 true 可临时恢复旧入口做对照，勿当正式产品默认。
 */
export const SCHEDULE_DEPRECATED_ENTRY = {
  copyLastWeek: false,
  slotNotes: false,
} as const;

function parseBoolFlag(raw: string | null, defaultValue: boolean): boolean {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return defaultValue;
}

async function loadBoolFlag(key: string, defaultValue: boolean): Promise<boolean> {
  try {
    const raw = await getAppSettingRaw(key);
    return parseBoolFlag(raw, defaultValue);
  } catch {
    return defaultValue;
  }
}

async function saveBoolFlag(key: string, enabled: boolean): Promise<void> {
  await setAppSetting(key, enabled ? '1' : '0');
}

/** 新时间线日视图；缺省 / 读失败 → false（旧课表） */
export async function loadScheduleTimelineUiEnabled(): Promise<boolean> {
  return loadBoolFlag(SCHEDULE_TIMELINE_UI_FLAG_KEY, false);
}

export async function saveScheduleTimelineUiEnabled(enabled: boolean): Promise<void> {
  await saveBoolFlag(SCHEDULE_TIMELINE_UI_FLAG_KEY, enabled);
}

/** 按分钟写入；缺省 / 读失败 → false（旧选格写入） */
export async function loadScheduleTimelineWriteEnabled(): Promise<boolean> {
  return loadBoolFlag(SCHEDULE_TIMELINE_WRITE_FLAG_KEY, false);
}

export async function saveScheduleTimelineWriteEnabled(enabled: boolean): Promise<void> {
  await saveBoolFlag(SCHEDULE_TIMELINE_WRITE_FLAG_KEY, enabled);
}
