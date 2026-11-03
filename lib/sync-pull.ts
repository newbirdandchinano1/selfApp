import { isApiReadableTable } from '@/lib/api-allowed-tables';
import { apiRequest } from '@/lib/api/http';
import { getApiAuthToken } from '@/lib/api-config';
import { clearSyncChangeCursor, getSyncChangeCursor, setSyncChangeCursor } from '@/lib/sync-cursor';
import { applyOneEvent, decide, readLocalRowState } from '@/lib/sync-apply';

export type SyncChangeEvent = {
  id: number;
  table: string;
  pk: string;
  op: 'upsert' | 'delete';
  updatedAt: string | null;
  deviceId: string | null;
  serverRev: number | null;
  mutationId: string | null;
  row: Record<string, unknown> | null;
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

export const SYNC_PULL_POLL_INTERVAL_MS = 60_000;

let pullInFlight: Promise<SyncPullResult> | null = null;
let pullQueued = false;

type DirtyListener = (dirtyTables: string[], needFullSync?: boolean) => void;
const dirtyListeners = new Set<DirtyListener>();

/** 合并短时内多次 dirty，避免同步/连写时 UI 重载风暴 */
const DIRTY_COALESCE_MS = 120;
let pendingDirtyTables = new Set<string>();
let pendingNeedFullSync = false;
let dirtyFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribeSyncDirty(listener: DirtyListener): () => void {
  dirtyListeners.add(listener);
  return () => {
    dirtyListeners.delete(listener);
  };
}

/** apply 后通知 UI 重读本地；cursor 无关 */
export const subscribeLocalDataChanged = subscribeSyncDirty;

function flushDirtyNow(): void {
  dirtyFlushTimer = null;
  const tables = [...pendingDirtyTables].sort();
  const needFullSync = pendingNeedFullSync;
  pendingDirtyTables = new Set();
  pendingNeedFullSync = false;
  if (tables.length === 0 && !needFullSync) return;
  for (const fn of dirtyListeners) {
    try {
      fn(tables, needFullSync);
    } catch (e) {
      console.warn('[sync-pull] dirty listener error', e);
    }
  }
}

function emitDirty(tables: string[], needFullSync = false): void {
  if (tables.length === 0 && !needFullSync) return;
  for (const t of tables) {
    const cleaned = t.trim();
    if (cleaned) pendingDirtyTables.add(cleaned);
  }
  if (needFullSync) pendingNeedFullSync = true;
  if (dirtyFlushTimer) clearTimeout(dirtyFlushTimer);
  dirtyFlushTimer = setTimeout(flushDirtyNow, DIRTY_COALESCE_MS);
}

/** 本地写入后通知订阅方重读 SQLite（不触发 pull） */
export function notifyLocalDataChanged(tables: string[]): void {
  const cleaned = tables.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return;
  emitDirty(cleaned, false);
}

async function fetchChangesPage(since: number): Promise<SyncChangesPayload> {
  return apiRequest<SyncChangesPayload>(
    `/api/app/sync/changes?since=${encodeURIComponent(String(since))}&limit=${PULL_PAGE_LIMIT}`,
    { method: 'GET', skipGlobalLoading: true, perAttemptTimeoutMs: 12_000 },
  );
}

function foldPage(events: SyncChangeEvent[]): SyncChangeEvent[] {
  const m = new Map<string, SyncChangeEvent>();
  for (const ev of events) {
    const table = ev.table?.trim();
    const pk = ev.pk?.trim();
    if (!table || !pk) continue;
    if (!isApiReadableTable(table)) continue;
    m.set(`${table}::${pk}`, ev);
  }
  // ????????task_execution_events ???? tasks/projects?
  // ???????????? FOREIGN KEY constraint failed
  const PARENT_FIRST = new Map<string, number>([
    ['users', 0],
    ['project_categories', 1],
    ['task_categories', 2],
    ['finance_accounts', 3],
    ['finance_flow_categories', 4],
    ['projects', 5],
    ['tasks', 6],
    ['habits', 7],
    ['tags', 8],
    ['health_records', 9],
    ['finance_transactions', 10],
  ]);
  return [...m.values()].sort((a, b) => {
    const oa = PARENT_FIRST.get(a.table) ?? 10;
    const ob = PARENT_FIRST.get(b.table) ?? 10;
    if (oa !== ob) return oa - ob;
    return a.id - b.id;
  });
}

export async function pullAndApplySyncChanges(opts?: { signal?: AbortSignal }): Promise<SyncPullResult> {
  if (opts?.signal?.aborted) {
    return { applied: false, needFullSync: false, dirtyTables: [], cursor: await getSyncChangeCursor() };
  }
  const token = await getApiAuthToken();
  if (!token) {
    return { applied: false, needFullSync: false, dirtyTables: [], cursor: await getSyncChangeCursor() };
  }
  if (pullInFlight) {
    pullQueued = true;
    return pullInFlight;
  }
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
          // Phase 3: needFullSync �� bootstrap ?�?���?�?� cursor����? /sync/full��
          void import('@/lib/sync-bootstrap').then((m) => m.handleNeedFullSync().catch(() => undefined));
          break;
        }
        const folded = foldPage(page.events ?? []);
        for (const ev of folded) {
          try {
            const local = await readLocalRowState(ev.table, ev.pk);
            const d = decide(local, {
              id: ev.id, table: ev.table, pk: ev.pk, op: ev.op,
              serverRev: ev.serverRev, mutationId: ev.mutationId, row: ev.row,
            });
            await applyOneEvent(ev.table, ev.pk, {
              id: ev.id, table: ev.table, pk: ev.pk, op: ev.op,
              serverRev: ev.serverRev, mutationId: ev.mutationId, row: ev.row,
            }, d);
            allDirty.add(ev.table);
          } catch (e) {
            console.warn(`[sync-pull] apply?? ${ev.table}:${ev.pk}`, e);
          }
        }
        for (const t of page.dirtyTables ?? []) allDirty.add(t);
        if (page.cursor > cursor) {
          cursor = page.cursor;
          await setSyncChangeCursor(cursor);
        }
        if (!page.hasMore) break;
      }
      const dirtyTables = [...allDirty].sort();
      if (dirtyTables.length > 0 && !needFullSync) {
        try {
          const { reloadDayBoundaryFromStore } = await import('@/lib/tasks-logical-day');
          if (dirtyTables.includes('app_settings')) await reloadDayBoundaryFromStore();
        } catch (e) {
          console.warn('[sync-pull] ??????', e);
        }
      }
      if (dirtyTables.length > 0 || needFullSync) emitDirty(dirtyTables, needFullSync);
      return { applied: dirtyTables.length > 0 || needFullSync, needFullSync, dirtyTables, cursor };
    } catch (e) {
      console.warn('[sync-pull] pull ??', e);
      return { applied: false, needFullSync: false, dirtyTables: [], cursor };
    }
  })();
  try {
    return await pullInFlight;
  } finally {
    pullInFlight = null;
    if (pullQueued) {
      pullQueued = false;
      void pullAndApplySyncChanges();
    }
  }
}

export async function pullChanges(opts?: { signal?: AbortSignal }): Promise<SyncPullResult> {
  return pullAndApplySyncChanges(opts);
}

export { clearSyncChangeCursor };
