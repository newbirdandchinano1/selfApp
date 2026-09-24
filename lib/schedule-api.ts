import { apiRequest } from '@/lib/api-client';
import {
  enqueueFrogScheduleAxis,
  enqueueFrogSchedulePlacementDelete,
  enqueueFrogSchedulePlacementUpsert,
} from '@/lib/schedule-api-outbox';
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
      `/api/pages/tasks/frog-schedule?weekStartYmd=${encodeURIComponent(weekStartYmd)}`,
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
  await apiRequest('/api/pages/tasks/frog-schedule/axis', {
    method: 'POST',
    body: JSON.stringify({
      startMinutes: axis.startMinutes,
      endMinutes: axis.endMinutes,
      slotHours: axis.slotHours,
      breaks: axis.breaks ?? [],
      updatedAt: axis.updatedAt,
    }),
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
  await apiRequest('/api/pages/tasks/frog-schedule/placement', {
    method: 'POST',
    body: JSON.stringify({
      action: body.action,
      placement: body.placement,
      id: body.id,
    }),
    signal: body.signal,
  });
}

/** 本地优先：失败入出站队列，不阻塞 UI */
export async function apiSaveFrogScheduleAxis(
  axis: ScheduleAxisSettings,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await pushFrogScheduleAxis(axis, signal);
  } catch (err) {
    if (__DEV__) console.warn('[frog-schedule] axis push failed → outbox', err);
    try {
      await enqueueFrogScheduleAxis(axis);
    } catch (enqueueErr) {
      if (__DEV__) console.warn('[frog-schedule] axis outbox enqueue failed', enqueueErr);
    }
  }
}

/** 本地优先：失败入出站队列，不阻塞 UI */
export async function apiPostFrogSchedulePlacement(body: {
  action: 'upsert' | 'delete';
  placement?: SchedulePlacementRow;
  id?: string;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await pushFrogSchedulePlacement(body);
  } catch (err) {
    if (__DEV__) console.warn('[frog-schedule] placement push failed → outbox', body.action, err);
    try {
      if (body.action === 'delete' && body.id) {
        await enqueueFrogSchedulePlacementDelete(body.id);
      } else if (body.action === 'upsert' && body.placement) {
        await enqueueFrogSchedulePlacementUpsert(body.placement);
      }
    } catch (enqueueErr) {
      if (__DEV__) console.warn('[frog-schedule] placement outbox enqueue failed', enqueueErr);
    }
  }
}

export async function apiCopyFrogScheduleWeek(body: {
  thisWeekStartYmd: string;
  overwrite: boolean;
  signal?: AbortSignal;
}): Promise<{ copied: number; skipped: number; overwritten: number }> {
  return apiRequest('/api/pages/tasks/frog-schedule/copy-week', {
    method: 'POST',
    body: JSON.stringify({
      thisWeekStartYmd: body.thisWeekStartYmd,
      overwrite: body.overwrite,
    }),
    signal: body.signal,
  });
}
