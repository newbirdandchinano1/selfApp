import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { isTaskTerminalStatus, type TaskStatus } from '@/lib/repositories/tasks/task.types';

function parseExtraRecord(extraData: string | null): Record<string, unknown> {
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

/** 任务是否为长期任务（青蛙完成时可仅结束当日会话，不勾选任务完成） */
export function getIsLongTermTask(extraData: string | null): boolean {
  const parsed = parseExtraRecord(extraData);
  return parsed.isLongTermTask === true;
}

export function mergeLongTermTaskIntoExtraData(extraData: string | null, isLongTerm: boolean): string | null {
  const parsed = parseExtraRecord(extraData);
  if (!isLongTerm) {
    if (!('isLongTermTask' in parsed)) return extraData;
    const { isLongTermTask: _removed, ...rest } = parsed;
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  }
  return JSON.stringify({ ...parsed, isLongTermTask: true });
}

/** 项目是否为长期项目（无子任务时可作青蛙；完成时可仅结束当日会话） */
export function getIsLongTermProject(extraData: string | null): boolean {
  const parsed = parseExtraRecord(extraData);
  return parsed.isLongTermProject === true;
}

export function mergeLongTermProjectIntoExtraData(extraData: string | null, isLongTerm: boolean): string | null {
  const parsed = parseExtraRecord(extraData);
  if (!isLongTerm) {
    if (!('isLongTermProject' in parsed)) return extraData;
    const { isLongTermProject: _removed, ...rest } = parsed;
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  }
  return JSON.stringify({ ...parsed, isLongTermProject: true });
}

/** 青蛙主体：任务或项目是否显示为长期 */
export function getIsLongTermFrog(extraData: string | null): boolean {
  return getIsLongTermTask(extraData) || getIsLongTermProject(extraData);
}

/** 当日青蛙会话已结束（任务本身可仍为未完成） */
export function getFrogSessionCompletedOn(extraData: string | null): string {
  const parsed = parseExtraRecord(extraData);
  return typeof parsed.frogSessionCompletedOn === 'string' ? parsed.frogSessionCompletedOn.trim() : '';
}

export function setFrogSessionCompletedOn(extraData: string | null, ymd: string): string {
  const parsed = parseExtraRecord(extraData);
  const { frogSessionAbandonedOn: _abandoned, ...rest } = parsed;
  return JSON.stringify({ ...rest, frogSessionCompletedOn: ymd });
}

export function clearFrogSessionCompletedOn(extraData: string | null): string | null {
  const parsed = parseExtraRecord(extraData);
  if (!('frogSessionCompletedOn' in parsed)) return extraData;
  const { frogSessionCompletedOn: _removed, ...rest } = parsed;
  return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
}

/** 当日青蛙已放弃（保留课表占用；通常已 unassign 该日） */
export function getFrogSessionAbandonedOn(extraData: string | null): string {
  const parsed = parseExtraRecord(extraData);
  return typeof parsed.frogSessionAbandonedOn === 'string'
    ? parsed.frogSessionAbandonedOn.trim()
    : '';
}

export function isFrogAbandonedOn(extraData: string | null, ymd: string): boolean {
  return getFrogSessionAbandonedOn(extraData) === ymd;
}

/** 写入放弃日；与会话完成互斥 */
export function setFrogSessionAbandonedOn(extraData: string | null, ymd: string): string {
  const parsed = parseExtraRecord(extraData);
  const { frogSessionCompletedOn: _completed, ...rest } = parsed;
  return JSON.stringify({ ...rest, frogSessionAbandonedOn: ymd });
}

export function clearFrogSessionAbandonedOn(extraData: string | null): string | null {
  const parsed = parseExtraRecord(extraData);
  if (!('frogSessionAbandonedOn' in parsed)) return extraData;
  const { frogSessionAbandonedOn: _removed, ...rest } = parsed;
  return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
}

/**
 * 指定日是否已处理完（实体完结 / 会话完成 / 放弃今日）。
 * 放弃后通常已去掉该日指派，故 abandoned 不依赖 isFrogAssignedOn。
 */
export function isFrogDoneForToday(
  extraData: string | null,
  status: TaskStatus | string,
  todayYmd: string,
): boolean {
  if (isTaskTerminalStatus(status)) return true;
  if (isFrogAbandonedOn(extraData, todayYmd)) return true;
  if (!isFrogAssignedOn(extraData, todayYmd)) return false;
  return getFrogSessionCompletedOn(extraData) === todayYmd;
}
