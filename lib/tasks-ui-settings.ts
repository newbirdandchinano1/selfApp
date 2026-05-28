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
