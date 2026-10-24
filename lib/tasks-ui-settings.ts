import { AppSettingKey, getAppSetting, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';

export type TasksMainListView = 'projects' | 'tasks';

export async function loadTasksProjectExpandedState(): Promise<Record<string, boolean> | null> {
  try {
    const parsed = await getAppSetting<Record<string, unknown>>(AppSettingKey.tasksProjectExpanded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const map: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k !== 'string' || typeof v !== 'boolean') continue;
      map[k] = v;
    }
    return map;
  } catch {
    return null;
  }
}

export async function saveTasksProjectExpandedState(next: Record<string, boolean>): Promise<void> {
  await setAppSetting(AppSettingKey.tasksProjectExpanded, next);
}

export async function loadTasksHideCompletedProjectTasks(): Promise<boolean | null> {
  try {
    const raw = await getAppSettingRaw(AppSettingKey.tasksHideCompletedProjectTasks);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

export async function saveTasksHideCompletedProjectTasks(hide: boolean): Promise<void> {
  await setAppSetting(AppSettingKey.tasksHideCompletedProjectTasks, hide ? '1' : '0');
}

export async function loadTasksMainListView(): Promise<TasksMainListView | null> {
  try {
    const raw = await getAppSetting<string>(AppSettingKey.tasksMainListView);
    if (raw === 'projects' || raw === 'tasks') return raw;
    return null;
  } catch {
    return null;
  }
}

export async function saveTasksMainListView(view: TasksMainListView): Promise<void> {
  await setAppSetting(AppSettingKey.tasksMainListView, view);
}

async function loadBoolSetting(key: string, defaultValue: boolean): Promise<boolean> {
  try {
    const raw = await getAppSettingRaw(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

async function saveBoolSetting(key: string, value: boolean): Promise<void> {
  await setAppSetting(key, value ? '1' : '0');
}

export async function loadTasksFocusSync(): Promise<boolean> {
  return loadBoolSetting(AppSettingKey.tasksFocusSync, true);
}

export async function saveTasksFocusSync(enabled: boolean): Promise<void> {
  await saveBoolSetting(AppSettingKey.tasksFocusSync, enabled);
}

export async function loadTasksWifiOnlyAttachments(): Promise<boolean> {
  return loadBoolSetting(AppSettingKey.tasksWifiOnlyAttachments, true);
}

export async function saveTasksWifiOnlyAttachments(enabled: boolean): Promise<void> {
  await saveBoolSetting(AppSettingKey.tasksWifiOnlyAttachments, enabled);
}

export async function loadTasksLocalEncrypt(): Promise<boolean> {
  return loadBoolSetting(AppSettingKey.tasksLocalEncrypt, true);
}

export async function saveTasksLocalEncrypt(enabled: boolean): Promise<void> {
  await saveBoolSetting(AppSettingKey.tasksLocalEncrypt, enabled);
}

export async function loadTasksPreferReduceMotion(): Promise<boolean> {
  return loadBoolSetting(AppSettingKey.tasksPreferReduceMotion, false);
}

export async function saveTasksPreferReduceMotion(enabled: boolean): Promise<void> {
  await saveBoolSetting(AppSettingKey.tasksPreferReduceMotion, enabled);
}
