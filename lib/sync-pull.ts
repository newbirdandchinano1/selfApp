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

export function subscribeSyncDirty(listener: DirtyListener): () => void {
  dirtyListeners.add(listener);
  return () => {
    dirtyListeners.delete(listener);
  };
}

/** apply ???? UI ?????? cursor????? */
export const subscribeLocalDataChanged = subscribeSyncDirty;

function emitDirty(tables: string[], needFullSync = false): void {
  if (tables.length === 0 && !needFullSync) return;
  for (const fn of dirtyListeners) {
    try {
      fn(tables, needFullSync);
    } catch (e) {
      console.warn('[sync-pull] dirty listener error', e);
    }
  }
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
    ['project_categories', 0],
    ['task_categories', 1],
    ['projects', 2],
    ['tasks', 3],
    ['habits', 4],
    ['tags', 5],
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
          // Phase 3: needFullSync  bootstrap ???? cursor? /sync/full
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
