import { persistTaskPatchToApi } from '@/lib/task-api-write';

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

/** 直接 PATCH 后端更新任务 extra_data；成功后 best-effort 同步本地库 */
export async function persistTaskFrogExtraToApi(
  taskId: string,
  extraData: string | null,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  await persistTaskPatchToApi(taskId, { extra_data: extraData }, taskRowSnapshot);
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
