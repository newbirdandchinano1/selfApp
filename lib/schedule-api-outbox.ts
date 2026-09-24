import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScheduleAxisSettings, SchedulePlacementRow } from '@/lib/schedule/types';

const OUTBOX_KEY = '@selfapp/frog_schedule_api_outbox_v1';
const MAX_ITEMS = 80;

export type FrogScheduleOutboxItem =
  | {
      key: string;
      kind: 'axis';
      axis: ScheduleAxisSettings;
      enqueuedAt: string;
    }
  | {
      key: string;
      kind: 'placement_upsert';
      placement: SchedulePlacementRow;
      enqueuedAt: string;
    }
  | {
      key: string;
      kind: 'placement_delete';
      placementId: string;
      enqueuedAt: string;
    };

let flushInFlight: Promise<number> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

async function readOutbox(): Promise<FrogScheduleOutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isOutboxItem);
  } catch {
    return [];
  }
}

async function writeOutbox(items: FrogScheduleOutboxItem[]): Promise<void> {
  const trimmed = items.slice(-MAX_ITEMS);
  if (trimmed.length === 0) {
    await AsyncStorage.removeItem(OUTBOX_KEY);
    return;
  }
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(trimmed));
}

function isOutboxItem(x: unknown): x is FrogScheduleOutboxItem {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.key !== 'string' || typeof o.kind !== 'string' || typeof o.enqueuedAt !== 'string') {
    return false;
  }
  if (o.kind === 'axis') return o.axis != null && typeof o.axis === 'object';
  if (o.kind === 'placement_upsert') return o.placement != null && typeof o.placement === 'object';
  if (o.kind === 'placement_delete') return typeof o.placementId === 'string';
  return false;
}

function mergeItem(
  items: FrogScheduleOutboxItem[],
  next: FrogScheduleOutboxItem,
): FrogScheduleOutboxItem[] {
  if (next.kind === 'axis') {
    return [...items.filter((i) => i.kind !== 'axis'), next];
  }
  const placementId =
    next.kind === 'placement_delete' ? next.placementId : next.placement.id;
  return [
    ...items.filter((i) => {
      if (i.kind === 'axis') return true;
      const id = i.kind === 'placement_delete' ? i.placementId : i.placement.id;
      return id !== placementId;
    }),
    next,
  ];
}

export async function enqueueFrogScheduleAxis(axis: ScheduleAxisSettings): Promise<void> {
  const items = await readOutbox();
  const next: FrogScheduleOutboxItem = {
    key: `axis:${axis.updatedAt}`,
    kind: 'axis',
    axis,
    enqueuedAt: nowIso(),
  };
  await writeOutbox(mergeItem(items, next));
  if (__DEV__) {
    console.warn('[frog-schedule] queued axis push for retry', axis.updatedAt);
  }
}

export async function enqueueFrogSchedulePlacementUpsert(
  placement: SchedulePlacementRow,
): Promise<void> {
  const items = await readOutbox();
  const next: FrogScheduleOutboxItem = {
    key: `upsert:${placement.id}`,
    kind: 'placement_upsert',
    placement,
    enqueuedAt: nowIso(),
  };
  await writeOutbox(mergeItem(items, next));
  if (__DEV__) {
    console.warn('[frog-schedule] queued placement upsert for retry', placement.id);
  }
}

export async function enqueueFrogSchedulePlacementDelete(placementId: string): Promise<void> {
  const items = await readOutbox();
  const next: FrogScheduleOutboxItem = {
    key: `delete:${placementId}`,
    kind: 'placement_delete',
    placementId,
    enqueuedAt: nowIso(),
  };
  await writeOutbox(mergeItem(items, next));
  if (__DEV__) {
    console.warn('[frog-schedule] queued placement delete for retry', placementId);
  }
}

export async function peekFrogScheduleOutboxCount(): Promise<number> {
  return (await readOutbox()).length;
}

/**
 * 重试 frog-schedule REST 出站队列。成功项移除，失败项保留。
 * @returns 本次成功刷出的条数
 */
export async function flushFrogScheduleApiOutbox(): Promise<number> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    const items = await readOutbox();
    if (items.length === 0) return 0;

    const { pushFrogScheduleAxis, pushFrogSchedulePlacement } = await import('@/lib/schedule-api');
    const remaining: FrogScheduleOutboxItem[] = [];
    let ok = 0;

    for (const item of items) {
      try {
        if (item.kind === 'axis') {
          await pushFrogScheduleAxis(item.axis);
        } else if (item.kind === 'placement_upsert') {
          await pushFrogSchedulePlacement({
            action: 'upsert',
            placement: item.placement,
          });
        } else {
          await pushFrogSchedulePlacement({
            action: 'delete',
            id: item.placementId,
          });
        }
        ok += 1;
      } catch (err) {
        remaining.push(item);
        if (__DEV__) {
          console.warn('[frog-schedule] outbox flush item failed', item.kind, err);
        }
      }
    }

    await writeOutbox(remaining);
    if (__DEV__ && ok > 0) {
      console.log('[frog-schedule] outbox flushed', ok, 'remaining', remaining.length);
    }
    return ok;
  })().finally(() => {
    flushInFlight = null;
  });

  return flushInFlight;
}
