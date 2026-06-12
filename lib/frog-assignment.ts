import { apiPatchRecord, ensureApiLoggedIn } from '@/lib/api-client';
import { fetchApiRecordByPk, invalidateInflightApiTableFetch } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';

function parseTaskExtraObject(extraData: string | null): Record<string, unknown> {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** 合并 frogAssignedOn 到 extra_data JSON */
export function mergeFrogAssignedOn(extraData: string | null, frogAssignedOn: string): string {
  const current = parseTaskExtraObject(extraData);
  return JSON.stringify({ ...current, frogAssignedOn });
}

/** 从任务 extra_data 中移除今日青蛙指派标记 */
export function clearFrogAssignedOn(extraData: string | null): string | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return extraData;
    if (!('frogAssignedOn' in parsed)) return extraData;
    const { frogAssignedOn: _removed, ...rest } = parsed;
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  } catch {
    return extraData;
  }
}

export function getFrogAssignedOn(extraData: string | null): string {
  if (!extraData) return '';
  try {
    const parsed = JSON.parse(extraData) as { frogAssignedOn?: unknown };
    return typeof parsed.frogAssignedOn === 'string' ? parsed.frogAssignedOn.trim() : '';
  } catch {
    return '';
  }
}

/**
 * API 写入成功后对齐本地 SQLite（不抛错、不阻断指派）。
 * 优先拉服务端最新行；失败则用页面快照 seed；再失败则仅更新已有行的 extra_data。
 */
async function bestEffortSyncTaskFrogToLocal(
  taskId: string,
  extraData: string | null,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await fetchApiRecordByPk('tasks', taskId);
    return;
  } catch (e) {
    if (__DEV__) console.warn('[frog-assignment] 拉取服务端任务同步本地失败，尝试快照', e);
  }

  if (taskRowSnapshot) {
    try {
      const merged = { ...taskRowSnapshot, id: taskId, extra_data: extraData };
      const { seedApiRowToLocalForWrite } = await import('@/lib/api-local-row-seed');
      const seeded = await seedApiRowToLocalForWrite('tasks', merged);
      if (seeded) return;
      await syncApiReadResultToLocal('tasks', merged);
      return;
    } catch (e) {
      if (__DEV__) console.warn('[frog-assignment] 快照写入本地失败', e);
    }
  }

  try {
    const { getDatabase } = await import('@/lib/database');
    const db = await getDatabase();
    if (!db) return;
    await db.runAsync(
      `UPDATE tasks SET extra_data = ?, updated_at = datetime('now'), sync_status = 'synced' WHERE id = ?`,
      [extraData, taskId],
    );
  } catch (e) {
    if (__DEV__) console.warn('[frog-assignment] 本地 extra_data 对齐失败', e);
  }
}

/** 直接 PATCH 后端更新任务 extra_data；成功后 best-effort 同步本地库 */
export async function persistTaskFrogExtraToApi(
  taskId: string,
  extraData: string | null,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  await ensureApiLoggedIn();
  await apiPatchRecord('tasks', taskId, { extra_data: extraData });
  invalidateInflightApiTableFetch('tasks');
  await bestEffortSyncTaskFrogToLocal(taskId, extraData, taskRowSnapshot);
}

/** 指派为今日青蛙（API 写入 + 本地同步） */
export async function assignFrogToApi(
  taskId: string,
  extraData: string | null,
  frogAssignedOn: string,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  await persistTaskFrogExtraToApi(
    taskId,
    mergeFrogAssignedOn(extraData, frogAssignedOn),
    taskRowSnapshot,
  );
}

/** 取消今日青蛙指派（API 写入 + 本地同步） */
export async function unassignFrogFromApi(
  taskId: string,
  extraData: string | null,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  await persistTaskFrogExtraToApi(taskId, clearFrogAssignedOn(extraData), taskRowSnapshot);
}
