/**
 * 日程表时间线重构 · 特性开关
 *
 * 阶段 L：日视图固定时间线（已删经典课表 UI / timeline_ui 开关）。
 * 阶段 J+K：App `timeline_write` 默认开；桌面 write 仍默认关（见桌面 timeline-flags）。
 * 停双写仍待桌面写入稳定 ≥14 天（决议 #17）。
 */
import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';

/**
 * 历史键：阶段 K 曾控制是否展示时间线。阶段 L 起 App 不再读取；
 * 保留键位以免桌面/旧客户端同步冲突。
 */
export const SCHEDULE_TIMELINE_UI_FLAG_KEY = AppSettingKey.scheduleTimelineUiV1;

/** 是否允许按分钟写入（阶段 G 接线；J 完成后默认开） */
export const SCHEDULE_TIMELINE_WRITE_FLAG_KEY = AppSettingKey.scheduleTimelineWriteV1;

export const SCHEDULE_TIMELINE_WRITE_DEFAULT = true;

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

/** @deprecated 阶段 L 日起视图固定时间线；保留读写以免旧设置页/同步报错 */
export async function loadScheduleTimelineUiEnabled(): Promise<boolean> {
  return true;
}

/** @deprecated 阶段 L 不再切换经典课表；写入仍落库但不影响渲染 */
export async function saveScheduleTimelineUiEnabled(enabled: boolean): Promise<void> {
  await saveBoolFlag(SCHEDULE_TIMELINE_UI_FLAG_KEY, enabled);
}

/** 按分钟写入；缺省 / 读失败 → true（阶段 K：J 读路径对齐后默认开） */
export async function loadScheduleTimelineWriteEnabled(): Promise<boolean> {
  return loadBoolFlag(SCHEDULE_TIMELINE_WRITE_FLAG_KEY, SCHEDULE_TIMELINE_WRITE_DEFAULT);
}

export async function saveScheduleTimelineWriteEnabled(enabled: boolean): Promise<void> {
  await saveBoolFlag(SCHEDULE_TIMELINE_WRITE_FLAG_KEY, enabled);
}
