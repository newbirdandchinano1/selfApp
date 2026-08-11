import { persistProjectPatchToApi } from '@/lib/project-api-write';
import { persistTaskPatchToApi } from '@/lib/task-api-write';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function normalizeYmd(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return YMD_RE.test(trimmed) ? trimmed : null;
}

/**
 * 读取全部青蛙指派日。
 * 兼容旧数据（仅 frogAssignedOn）与多日数据（frogAssignedDates + frogAssignedOn）。
 */
export function getFrogAssignedDates(extraData: string | null): string[] {
  const parsed = parseTaskExtraObject(extraData);
  const dates = new Set<string>();
  if (Array.isArray(parsed.frogAssignedDates)) {
    for (const item of parsed.frogAssignedDates) {
      const ymd = normalizeYmd(item);
      if (ymd) dates.add(ymd);
    }
  }
  const single = normalizeYmd(parsed.frogAssignedOn);
  if (single) dates.add(single);
  return [...dates].sort();
}

export function isFrogAssignedOn(extraData: string | null, ymd: string): boolean {
  const target = normalizeYmd(ymd);
  if (!target) return false;
  return getFrogAssignedDates(extraData).includes(target);
}

function writeFrogAssignedDates(extraData: string | null, dates: string[]): string | null {
  const current = parseTaskExtraObject(extraData);
  const { frogAssignedOn: _a, frogAssignedDates: _b, ...rest } = current;
  const sorted = [...new Set(dates.map((d) => d.trim()).filter((d) => YMD_RE.test(d)))].sort();
  if (sorted.length === 0) {
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  }
  // frogAssignedOn 保留为「最近一日」供旧接口区间筛选；完整列表在 frogAssignedDates
  const payload: Record<string, unknown> = {
    ...rest,
    frogAssignedOn: sorted[sorted.length - 1],
  };
  if (sorted.length > 1) {
    payload.frogAssignedDates = sorted;
  }
  return JSON.stringify(payload);
}

/** 合并指派日到 extra_data（累加，不覆盖已有指派日） */
export function mergeFrogAssignedOn(extraData: string | null, frogAssignedOn: string): string {
  const ymd = normalizeYmd(frogAssignedOn);
  if (!ymd) {
    const current = parseTaskExtraObject(extraData);
    return JSON.stringify({ ...current, frogAssignedOn });
  }
  const dates = getFrogAssignedDates(extraData);
  if (!dates.includes(ymd)) dates.push(ymd);
  return writeFrogAssignedDates(extraData, dates) ?? JSON.stringify({ frogAssignedOn: ymd });
}

/** 移除某一指派日；无剩余则清除全部青蛙指派字段 */
export function removeFrogAssignedOn(extraData: string | null, ymd: string): string | null {
  const target = normalizeYmd(ymd);
  if (!target) return clearFrogAssignedOn(extraData);
  const next = getFrogAssignedDates(extraData).filter((d) => d !== target);
  return writeFrogAssignedDates(extraData, next);
}

/** 从任务/项目 extra_data 中移除全部青蛙指派标记 */
export function clearFrogAssignedOn(extraData: string | null): string | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return extraData;
    if (!('frogAssignedOn' in parsed) && !('frogAssignedDates' in parsed)) return extraData;
    const { frogAssignedOn: _removed, frogAssignedDates: _dates, ...rest } = parsed;
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  } catch {
    return extraData;
  }
}

/** 项目新增子任务后：清除青蛙指派与当日会话标记 */
export function clearProjectFrogFields(extraData: string | null): string | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return extraData;
    if (
      !('frogAssignedOn' in parsed) &&
      !('frogAssignedDates' in parsed) &&
      !('frogSessionCompletedOn' in parsed)
    ) {
      return extraData;
    }
    const {
      frogAssignedOn: _a,
      frogAssignedDates: _dates,
      frogSessionCompletedOn: _b,
      ...rest
    } = parsed;
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  } catch {
    return extraData;
  }
}

/** @deprecated 优先用 isFrogAssignedOn / getFrogAssignedDates；返回最近指派日（兼容旧调用） */
export function getFrogAssignedOn(extraData: string | null): string {
  const dates = getFrogAssignedDates(extraData);
  return dates.length > 0 ? dates[dates.length - 1]! : '';
}

/** 直接 PATCH 后端更新任务 extra_data；成功后 best-effort 同步本地库 */
export async function persistTaskFrogExtraToApi(
  taskId: string,
  extraData: string | null,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  await persistTaskPatchToApi(taskId, { extra_data: extraData }, taskRowSnapshot);
}

/** 直接 PATCH 后端更新项目 extra_data */
export async function persistProjectFrogExtraToApi(
  projectId: string,
  extraData: string | null,
  projectRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  await persistProjectPatchToApi(projectId, { extra_data: extraData }, projectRowSnapshot);
}

/** 指派为今日/明日青蛙（API 写入 + 本地同步；累加指派日） */
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

/** 取消青蛙指派；传入 ymd 时仅移除该日，否则清除全部 */
export async function unassignFrogFromApi(
  taskId: string,
  extraData: string | null,
  taskRowSnapshot?: Record<string, unknown> | null,
  ymd?: string,
): Promise<void> {
  const next = ymd ? removeFrogAssignedOn(extraData, ymd) : clearFrogAssignedOn(extraData);
  await persistTaskFrogExtraToApi(taskId, next, taskRowSnapshot);
}

/** 将无子任务项目指派为今日/明日青蛙 */
export async function assignProjectFrogToApi(
  projectId: string,
  extraData: string | null,
  frogAssignedOn: string,
  projectRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  await persistProjectFrogExtraToApi(
    projectId,
    mergeFrogAssignedOn(extraData, frogAssignedOn),
    projectRowSnapshot,
  );
}

/** 取消项目的青蛙指派；传入 ymd 时仅移除该日 */
export async function unassignProjectFrogFromApi(
  projectId: string,
  extraData: string | null,
  projectRowSnapshot?: Record<string, unknown> | null,
  ymd?: string,
): Promise<void> {
  const next = ymd ? removeFrogAssignedOn(extraData, ymd) : clearFrogAssignedOn(extraData);
  await persistProjectFrogExtraToApi(projectId, next, projectRowSnapshot);
}
