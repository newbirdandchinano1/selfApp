import { apiRequest } from '@/lib/api-client';
import type { ScheduleAxisSettings, SchedulePlacementRow, ScheduleSubjectKind } from '@/lib/schedule/types';

export type FrogScheduleWeekPayload = {
  weekStartYmd: string;
  axis: {
    startMinutes: number;
    endMinutes: number;
    slotHours: number;
    breaks?: Array<{ startMinutes: number; endMinutes: number; label: string }>;
    fromSnapshot?: boolean;
  };
  placements: Array<{
    id: string;
    weekStartYmd: string;
    weekday: number;
    startSlotIndex: number | null;
    spanSlots: number;
    subjectKind: ScheduleSubjectKind;
    subjectId: string;
    orphaned: number;
  }>;
};

export async function apiGetFrogScheduleWeek(
  weekStartYmd: string,
  signal?: AbortSignal,
): Promise<FrogScheduleWeekPayload | null> {
  try {
    return await apiRequest<FrogScheduleWeekPayload>(
      `/api/app/pages/tasks/frog-schedule?weekStartYmd=${encodeURIComponent(weekStartYmd)}`,
      { method: 'GET', signal },
    );
  } catch (err) {
    if (__DEV__) console.warn('[frog-schedule] week GET failed', weekStartYmd, err);
    return null;
  }
}

/** 直接推送轴设置（失败抛错，供出站队列 flush 使用） */
export async function pushFrogScheduleAxis(
  axis: ScheduleAxisSettings,
  signal?: AbortSignal,
): Promise<void> {
  await apiRequest('/api/app/pages/tasks/frog-schedule/axis', {
    method: 'POST',
    body: {
      startMinutes: axis.startMinutes,
      endMinutes: axis.endMinutes,
      slotHours: axis.slotHours,
      breaks: axis.breaks ?? [],
      updatedAt: axis.updatedAt,
    },
    signal,
  });
}

/** 直接推送占用（失败抛错，供出站队列 flush 使用） */
export async function pushFrogSchedulePlacement(body: {
  action: 'upsert' | 'delete';
  placement?: SchedulePlacementRow;
  id?: string;
  signal?: AbortSignal;
}): Promise<void> {
  await apiRequest('/api/app/pages/tasks/frog-schedule/placement', {
    method: 'POST',
    body: {
      action: body.action,
      placement: body.placement,
      id: body.id,
    },
    signal: body.signal,
  });
}

/** 直连服务器保存轴设置；失败抛错，不入出站队列 */
export async function apiSaveFrogScheduleAxis(
  axis: ScheduleAxisSettings,
  signal?: AbortSignal,
): Promise<void> {
  await pushFrogScheduleAxis(axis, signal);
}

/** 直连服务器 upsert/delete 占用；失败抛错，不入出站队列 */
export async function apiPostFrogSchedulePlacement(body: {
  action: 'upsert' | 'delete';
  placement?: SchedulePlacementRow;
  id?: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (body.action === 'delete' && body.id) {
    await pushFrogSchedulePlacement({ action: 'delete', id: body.id, signal: body.signal });
    return;
  }
  if (body.action === 'upsert' && body.placement) {
    await pushFrogSchedulePlacement({
      action: 'upsert',
      placement: body.placement,
      signal: body.signal,
    });
  }
}

export async function apiCopyFrogScheduleWeek(body: {
  thisWeekStartYmd: string;
  overwrite: boolean;
  signal?: AbortSignal;
}): Promise<{ copied: number; skipped: number; overwritten: number }> {
  return apiRequest('/api/app/pages/tasks/frog-schedule/copy-week', {
    method: 'POST',
    body: {
      thisWeekStartYmd: body.thisWeekStartYmd,
      overwrite: body.overwrite,
    },
    signal: body.signal,
  });
}
