import { isApiReadableTable } from '@/lib/api-allowed-tables';
import { REST_SKIP_TABLES } from '@/lib/api-incremental-sync';
import { fetchApiTableAll } from '@/lib/api-read';
import { apiRequest } from '@/lib/api/http';
import { getApiAuthToken } from '@/lib/api-config';
import {
  clearSyncChangeCursor,
  getSyncChangeCursor,
  setSyncChangeCursor,
} from '@/lib/sync-cursor';
import {
  markTabPagesDirtyForRemoteSync,
  markAllTabPagesNeedRemoteSync,
} from '@/lib/page-api-session';
import { startSyncSse, stopSyncSse } from '@/lib/sync-sse';

export type SyncChangeEvent = {
  id: number;
  table: string;
  pk: string;
  op: 'upsert' | 'delete';
  updatedAt: string | null;
  deviceId: string | null;
};

export type SyncChangesPayload = {
  serverTime: string;
  cursor: number;
  hasMore: boolean;
  needFullSync: boolean;
  events: SyncChangeEvent[];
  dirtyTables: string[];
};

export type SyncPullResult = {
  applied: boolean;
  needFullSync: boolean;
  dirtyTables: string[];
  cursor: number;
};

const PULL_PAGE_LIMIT = 200;
const MAX_PULL_PAGES = 20;

/** Phase 3：SSE 为主，轮询仅作 60s 兜底 */
export const SYNC_PULL_POLL_INTERVAL_MS = 60_000;

/** SSE 触发 pull 的防抖 */
const SSE_PULL_DEBOUNCE_MS = 400;

let pullInFlight: Promise<SyncPullResult> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let sseDebounceTimer: ReturnType<typeof setTimeout> | null = null;

type DirtyListener = (dirtyTables: string[]) => void;
const dirtyListeners = new Set<DirtyListener>();

export function subscribeSyncDirty(listener: DirtyListener): () => void {
  dirtyListeners.add(listener);
  return () => {
    dirtyListeners.delete(listener);
  };
}

function emitDirty(tables: string[]): void {
  if (tables.length === 0) return;
  for (const fn of dirtyListeners) {
    try {
      fn(tables);
    } catch (e) {
      console.warn('[sync-pull] dirty listener error', e);
    }
  }
}

async function fetchChangesPage(since: number): Promise<SyncChangesPayload> {
  return apiRequest<SyncChangesPayload>(
    `/api/app/sync/changes?since=${encodeURIComponent(String(since))}&limit=${PULL_PAGE_LIMIT}`,
    {
      method: 'GET',
      skipGlobalLoading: true,
      perAttemptTimeoutMs: 12_000,
    },
  );
}

async function refreshDirtyTables(tables: string[]): Promise<void> {
  const unique = [...new Set(tables.map((t) => t.trim()).filter(Boolean))];
  for (const table of unique) {
    markTabPagesDirtyForRemoteSync(table);
    // 课表走专用接口，由任务页 REST 刷新覆盖；不走通用 List
    if (REST_SKIP_TABLES.has(table)) continue;
    if (!isApiReadableTable(table)) continue;
    try {
      await fetchApiTableAll(table, { forceRefresh: true });
    } catch (e) {
      console.warn(`[sync-pull] 刷新表 ${table} 失败`, e);
    }
  }
}

/**
 * 按游标追赶 Change Log；有脏表则灌入本地并通知页面 REST 刷新。
 * 并发调用合并为同一次 inflight。
 */
export async function pullAndApplySyncChanges(opts?: {
  signal?: AbortSignal;
}): Promise<SyncPullResult> {
  if (opts?.signal?.aborted) {
    return { applied: false, needFullSync: false, dirtyTables: [], cursor: await getSyncChangeCursor() };
  }

  const token = await getApiAuthToken();
  if (!token) {
    return { applied: false, needFullSync: false, dirtyTables: [], cursor: await getSyncChangeCursor() };
  }

  if (pullInFlight) return pullInFlight;

  pullInFlight = (async (): Promise<SyncPullResult> => {
    let cursor = await getSyncChangeCursor();
    const allDirty = new Set<string>();
    let needFullSync = false;
    let pages = 0;

    try {
      while (pages < MAX_PULL_PAGES) {
        pages += 1;
        if (opts?.signal?.aborted) break;
        const page = await fetchChangesPage(cursor);
        if (page.needFullSync) {
          needFullSync = true;
          markAllTabPagesNeedRemoteSync();
          // 全量兜底后对齐到服务端游标，避免反复 needFullSync
          await setSyncChangeCursor(page.cursor);
          cursor = page.cursor;
          break;
        }
        for (const t of page.dirtyTables ?? []) allDirty.add(t);
        if (page.cursor > cursor) {
          cursor = page.cursor;
          await setSyncChangeCursor(cursor);
        }
        if (!page.hasMore) break;
      }

      const dirtyTables = [...allDirty].sort();
      if (dirtyTables.length > 0) {
        await refreshDirtyTables(dirtyTables);
        emitDirty(dirtyTables);
      }

      return {
        applied: dirtyTables.length > 0 || needFullSync,
        needFullSync,
        dirtyTables,
        cursor,
      };
    } catch (e) {
      console.warn('[sync-pull] pull 失败', e);
      return {
        applied: false,
        needFullSync: false,
        dirtyTables: [],
        cursor,
      };
    }
  })();

  try {
    return await pullInFlight;
  } finally {
    pullInFlight = null;
  }
}

function schedulePullFromSse(): void {
  if (sseDebounceTimer != null) clearTimeout(sseDebounceTimer);
  sseDebounceTimer = setTimeout(() => {
    sseDebounceTimer = null;
    void pullAndApplySyncChanges();
  }, SSE_PULL_DEBOUNCE_MS);
}

/**
 * 启动多端同步：SSE 实时信号 + 60s 轮询兜底。
 * 重连成功后立即 pull 一次，补齐断线窗口。
 */
export function startSyncPullPolling(intervalMs = SYNC_PULL_POLL_INTERVAL_MS): void {
  stopSyncPullPolling();
  void pullAndApplySyncChanges();
  pollTimer = setInterval(() => {
    void pullAndApplySyncChanges();
  }, intervalMs);

  startSyncSse({
    onChanges: () => schedulePullFromSse(),
    onConnected: () => {
      void pullAndApplySyncChanges();
    },
  });
}

export function stopSyncPullPolling(): void {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (sseDebounceTimer != null) {
    clearTimeout(sseDebounceTimer);
    sseDebounceTimer = null;
  }
  stopSyncSse();
}

export { clearSyncChangeCursor };
