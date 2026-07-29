import { readAppMeta, writeAppMeta } from '@/lib/api-local-bootstrap';
import {
  fetchApiTablePage,
  shouldFetchNextApiTablePage,
  withApiTableSyncLock,
} from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { getApiTablePrimaryKey } from '@/lib/api-allowed-tables';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';

const TASKS_TABLE_LAST_SYNC_META_KEY = 'tasks_table_last_sync_at_v1';
const PAGE_LIMIT = 200;
const MAX_PAGES = 500;

async function readTasksTableLastSyncAt(): Promise<string | null> {
  const raw = await readAppMeta(TASKS_TABLE_LAST_SYNC_META_KEY);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

async function writeTasksTableLastSyncAt(iso: string): Promise<void> {
  await writeAppMeta(TASKS_TABLE_LAST_SYNC_META_KEY, iso);
}

/** 清库 / 强制全量后重置 tasks 增量游标 */
export async function clearTasksTableSyncCache(): Promise<void> {
  await writeAppMeta(TASKS_TABLE_LAST_SYNC_META_KEY, '');
}

/**
 * 将远端 tasks 变更写入本地（updatedSince 增量；forceRefresh 时全量 upsert）。
 * 不做 reconcileSnapshot：筛选视图与增量结果都不是全表权威快照。
 */
export async function syncTasksTableFromApi(opts?: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<number> {
  throwIfAborted(opts?.signal);

  const forceRefresh = Boolean(opts?.forceRefresh);
  const lastSyncAt = forceRefresh ? null : await readTasksTableLastSyncAt();
  const pkCol = getApiTablePrimaryKey('tasks');
  const seenPk = new Set<string>();
  const all: Record<string, unknown>[] = [];
  let knownTotal = 0;
  let maxUpdatedAt = '';
  let page = 1;

  while (page <= MAX_PAGES) {
    throwIfAborted(opts?.signal);
    const { list, pagination } = await fetchApiTablePage<Record<string, unknown>>('tasks', {
      page,
      limit: PAGE_LIMIT,
      updatedSince: lastSyncAt ?? undefined,
      signal: opts?.signal,
    });
    if (pagination.total > knownTotal) knownTotal = pagination.total;

    let newRowCount = 0;
    for (const row of list) {
      const pkRaw = row[pkCol];
      const pk = pkRaw == null || pkRaw === '' ? '' : String(pkRaw).trim();
      if (pk) {
        if (seenPk.has(pk)) continue;
        seenPk.add(pk);
      }
      all.push(row);
      newRowCount += 1;
      const updated = typeof row.updated_at === 'string' ? row.updated_at.trim() : '';
      if (updated && updated > maxUpdatedAt) maxUpdatedAt = updated;
    }

    const progress = {
      knownTotal: knownTotal > 0 ? knownTotal : undefined,
      fetchedUnique: seenPk.size,
    };
    if (knownTotal > 0 && seenPk.size >= knownTotal) break;
    if (!shouldFetchNextApiTablePage(list.length, newRowCount, progress)) break;
    page += 1;
  }

  if (all.length > 0) {
    await withApiTableSyncLock('tasks', async () => {
      await syncApiReadResultToLocal('tasks', all, { reconcileSnapshot: false });
    });
  }

  if (maxUpdatedAt) {
    await writeTasksTableLastSyncAt(maxUpdatedAt);
  } else if (!lastSyncAt) {
    await writeTasksTableLastSyncAt(new Date().toISOString());
  }

  return all.length;
}
