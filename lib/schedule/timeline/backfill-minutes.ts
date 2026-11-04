/**
 * 阶段 D：存量 placement 回填 start_minutes / end_minutes / all_day
 *
 * - 仅处理 start_minutes IS NULL、未 orphan、有 slot、非 pending_delete
 * - 轴优先用该周 `schedule_week_axis_snapshot`；无快照则用当前全局轴并打日志
 * - **绝不**因无法派生而批量标 orphaned
 * - 回填后 sync_status → pending_update，并尝试推 frog-schedule REST
 * - 版本号落 app_settings，避免重复跑
 */
import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';
import { normalizeAxisSettings } from '@/lib/schedule/axis';
import type { ScheduleAxisSettings } from '@/lib/schedule/types';
import {
  computePlacementMinutesBackfill,
  pickAxisForBackfillWeek,
} from '@/lib/schedule/timeline/backfill-minutes-logic';
import {
  applyPlacementMinutesBackfillBatch,
  ensureScheduleTables,
  getScheduleAxisSettings,
  getWeekAxisSnapshot,
  listPendingSchedulePlacements,
  listPlacementsMissingStoredMinutes,
} from '@/lib/repositories/schedule/schedule-store';
import { pushFrogSchedulePlacement } from '@/lib/schedule-api';

export {
  computePlacementMinutesBackfill,
  pickAxisForBackfillWeek,
  type BackfillAxisSource,
} from '@/lib/schedule/timeline/backfill-minutes-logic';

/** 迁移版本；改算法时 bump 并另开 key 或升版本 */
export const SCHEDULE_PLACEMENT_MINUTES_BACKFILL_VERSION = '1';

export const SCHEDULE_PLACEMENT_MINUTES_BACKFILL_KEY =
  AppSettingKey.schedulePlacementMinutesBackfillV1;

export type PlacementMinutesBackfillResult = {
  scanned: number;
  updated: number;
  skipped: number;
  weeksUsingCurrentAxis: string[];
  pushed: number;
};

async function pushPendingAfterBackfill(): Promise<number> {
  const pending = await listPendingSchedulePlacements();
  let pushed = 0;
  for (const p of pending) {
    try {
      if (p.syncStatus === 'pending_delete') {
        await pushFrogSchedulePlacement({ action: 'delete', id: p.id });
      } else {
        await pushFrogSchedulePlacement({ action: 'upsert', placement: p });
      }
      pushed += 1;
    } catch (err) {
      if (__DEV__) {
        console.warn('[frog-schedule] backfill push failed', p.id, err);
      }
    }
  }
  return pushed;
}

/**
 * 一次性迁移。已跑过版本则直接返回 null。
 * 启动时调用；失败不写版本号，下次可重试。
 */
export async function migratePlacementMinutesBackfillIfNeeded(): Promise<PlacementMinutesBackfillResult | null> {
  const flag = await getAppSettingRaw(SCHEDULE_PLACEMENT_MINUTES_BACKFILL_KEY);
  if (flag === SCHEDULE_PLACEMENT_MINUTES_BACKFILL_VERSION) {
    return null;
  }

  await ensureScheduleTables();

  const missing = await listPlacementsMissingStoredMinutes();
  const currentAxis: ScheduleAxisSettings = await getScheduleAxisSettings();
  const normalizedCurrent = normalizeAxisSettings(currentAxis);

  const byWeek = new Map<string, typeof missing>();
  for (const p of missing) {
    const list = byWeek.get(p.weekStartYmd);
    if (list) list.push(p);
    else byWeek.set(p.weekStartYmd, [p]);
  }

  const patches: Array<{
    id: string;
    startMinutes: number;
    endMinutes: number;
    allDay: number;
  }> = [];
  const weeksUsingCurrentAxis: string[] = [];
  let skipped = 0;

  for (const [weekStartYmd, rows] of byWeek) {
    const snap = await getWeekAxisSnapshot(weekStartYmd);
    const { axis, source } = pickAxisForBackfillWeek(snap, normalizedCurrent);
    if (source === 'current') {
      weeksUsingCurrentAxis.push(weekStartYmd);
      if (__DEV__) {
        console.log(
          '[frog-schedule] minutes backfill: no week axis snapshot, using current axis',
          weekStartYmd,
        );
      }
    }

    for (const p of rows) {
      const computed = computePlacementMinutesBackfill(p, axis);
      if (!computed) {
        skipped += 1;
        if (__DEV__) {
          console.warn(
            '[frog-schedule] minutes backfill skip (cannot derive, not orphaning)',
            {
              placementId: p.id,
              weekStartYmd: p.weekStartYmd,
              weekday: p.weekday,
              startSlotIndex: p.startSlotIndex,
              spanSlots: p.spanSlots,
              axisSource: source,
            },
          );
        }
        continue;
      }
      if (__DEV__) {
        console.log('[frog-schedule] minutes backfill', {
          placementId: p.id,
          weekStartYmd: p.weekStartYmd,
          oldSlot: { start: p.startSlotIndex, span: p.spanSlots },
          next: computed,
          axisSource: source,
        });
      }
      patches.push({ id: p.id, ...computed });
    }
  }

  if (patches.length > 0) {
    await applyPlacementMinutesBackfillBatch(patches);
  }

  // 先落版本：本地已有分钟。推送不阻塞启动；失败留 pending_update，周同步再推（决议 #11）
  await setAppSetting(
    SCHEDULE_PLACEMENT_MINUTES_BACKFILL_KEY,
    SCHEDULE_PLACEMENT_MINUTES_BACKFILL_VERSION,
  );

  const result: PlacementMinutesBackfillResult = {
    scanned: missing.length,
    updated: patches.length,
    skipped,
    weeksUsingCurrentAxis,
    pushed: 0,
  };

  void pushPendingAfterBackfill()
    .then((n) => {
      if (__DEV__) console.log('[frog-schedule] minutes backfill push done', n);
    })
    .catch((err) => {
      if (__DEV__) console.warn('[frog-schedule] minutes backfill push batch failed', err);
    });

  if (__DEV__) {
    console.log('[frog-schedule] minutes backfill done', result);
  }

  return result;
}
