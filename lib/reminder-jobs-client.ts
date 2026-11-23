/**
 * 客户端 → 服务端 reminder_jobs 上报（带轻量合并，避免连发 PUT）。
 */
import {
  apiPutReminderJobs,
  type PutReminderJobsBody,
  type ReminderJobUpsertItem,
} from '@/lib/api/endpoints/reminders';

const FLUSH_MS = 280;

type QueueState = {
  upsert: Map<string, ReminderJobUpsertItem>;
  cancelDedupeKeys: Set<string>;
  cancelPrefixes: Set<string>;
  replaceCategories: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
};

const queue: QueueState = {
  upsert: new Map(),
  cancelDedupeKeys: new Set(),
  cancelPrefixes: new Set(),
  replaceCategories: new Set(),
  timer: null,
  inFlight: null,
};

	/** 同一 dedupeKey 只保留最后一次 fireAt，避免同批上报多条 pending。 */
	function jobKey(item: ReminderJobUpsertItem): string {
	  return item.dedupeKey;
	}

async function flushQueue(): Promise<void> {
  if (queue.inFlight) {
    await queue.inFlight;
  }

  const body: PutReminderJobsBody = {};
  if (queue.upsert.size > 0) {
    body.upsert = [...queue.upsert.values()];
    queue.upsert.clear();
  }
  if (queue.cancelDedupeKeys.size > 0) {
    body.cancelDedupeKeys = [...queue.cancelDedupeKeys];
    queue.cancelDedupeKeys.clear();
  }
  if (queue.cancelPrefixes.size > 0) {
    body.cancelPrefixes = [...queue.cancelPrefixes];
    queue.cancelPrefixes.clear();
  }
  if (queue.replaceCategories.size > 0) {
    body.replaceCategories = [...queue.replaceCategories];
    queue.replaceCategories.clear();
  }

  if (
    !body.upsert?.length &&
    !body.cancelDedupeKeys?.length &&
    !body.cancelPrefixes?.length &&
    !body.replaceCategories?.length
  ) {
    return;
  }

  queue.inFlight = (async () => {
    try {
      await apiPutReminderJobs(body);
    } catch (e) {
      if (__DEV__) console.warn('[reminder-jobs] put failed', e);
    } finally {
      queue.inFlight = null;
    }
  })();

  await queue.inFlight;
}

function scheduleFlush(): void {
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = setTimeout(() => {
    queue.timer = null;
    void flushQueue();
  }, FLUSH_MS);
}

export function enqueueReminderJobsUpsert(items: ReminderJobUpsertItem[]): void {
  for (const item of items) {
    const dedupeKey = String(item.dedupeKey ?? '').trim();
    const fireAt = String(item.fireAt ?? '').trim();
    if (!dedupeKey || !fireAt) continue;
    const normalized: ReminderJobUpsertItem = {
      ...item,
      dedupeKey,
      fireAt,
      category: String(item.category ?? '').trim(),
      title: String(item.title ?? '').trim() || '提醒',
    };
    if (!normalized.category) continue;
    queue.upsert.set(jobKey(normalized), normalized);
  }
  scheduleFlush();
}

export function enqueueReminderJobsCancel(params: {
  dedupeKeys?: string[];
  prefixes?: string[];
  replaceCategories?: string[];
}): void {
  for (const k of params.dedupeKeys ?? []) {
    const t = String(k ?? '').trim();
    if (t) queue.cancelDedupeKeys.add(t);
  }
  for (const p of params.prefixes ?? []) {
    const t = String(p ?? '').trim();
    if (t) queue.cancelPrefixes.add(t);
  }
  for (const c of params.replaceCategories ?? []) {
    const t = String(c ?? '').trim();
    if (t) queue.replaceCategories.add(t);
  }
  scheduleFlush();
}

/** 立刻刷出队列（cancel 后紧接 upsert 时可用） */
export async function flushReminderJobsQueue(): Promise<void> {
  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }
  await flushQueue();
}
