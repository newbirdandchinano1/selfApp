import { apiRequest } from '@/lib/api-client';
import type { ScheduleAxisSettings, SchedulePlacementRow, ScheduleSubjectKind } from '@/lib/schedule/types';

export type FrogScheduleWeekPayload = {
  weekStartYmd: string;
  axis: {
    startMinutes: number;
    endMinutes: number;
    slotHours: number;
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
  } catch {
    return null;
  }
}

export async function apiSaveFrogScheduleAxis(
  axis: ScheduleAxisSettings,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await apiRequest('/api/pages/tasks/frog-schedule/axis', {
      method: 'POST',
      body: JSON.stringify({
        startMinutes: axis.startMinutes,
        endMinutes: axis.endMinutes,
        slotHours: axis.slotHours,
        updatedAt: axis.updatedAt,
      }),
      signal,
    });
  } catch {
    /* 离线不阻塞本地设置 */
  }
}

export async function apiPostFrogSchedulePlacement(body: {
  action: 'upsert' | 'delete';
  placement?: SchedulePlacementRow;
  id?: string;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await apiRequest('/api/pages/tasks/frog-schedule/placement', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: body.signal,
    });
  } catch {
    /* 离线不阻塞本地占用写入 */
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
