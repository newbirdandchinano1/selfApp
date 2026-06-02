import { apiGetRecord, apiGetTablesMeta, apiListRecords } from '@/lib/api-client';
import { withApiLoading } from '@/lib/api-loading-tracker';
import {
  getApiTablePrimaryKey,
  isApiReadableTable,
} from '@/lib/api-allowed-tables';
import {
  applyApiRecordMissingToLocal,
  syncApiReadResultToLocal,
} from '@/lib/api-read-local-sync';
import { isApiOnlyReads } from '@/lib/api-data-mode';
import {
  overlayLocalPendingOnApiRecord,
  overlayLocalPendingOnApiTableRows,
} from '@/lib/api-read-pending-overlay';
import { getDatabase } from '@/lib/database';
import { resolveReadLocalOnly } from '@/lib/page-api-session';

export type ApiListOptions = {
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
  signal?: AbortSignal;
  /** 强制从 REST 全量拉取（与默认行为相同，供显式刷新使用） */
  forceRefresh?: boolean;
  /** @deprecated API_ONLY_READS 下无效，始终走 REST */
  localOnly?: boolean;
  offlineFallback?: boolean;
};

export type ApiTableMeta = {
  name: string;
  primaryKey: string;
  hasDeletedAt: boolean;
  columns?: string[];
};

const tableMetaCache = new Map<string, ApiTableMeta>();
let allTablesMetaCache: ApiTableMeta[] | null = null;

/** 同表并发全量拉取去重，避免 reconcileSnapshot 竞态 */
const inflightTableFetchAll = new Map<string, Promise<Record<string, unknown>[]>>();

function assertApiReadable(table: string): void {
  if (!isApiReadableTable(table)) {
    throw new Error(`表「${table}」不允许通过 REST 读取`);
  }
}

/** 拉取表元信息（带内存缓存） */
export async function fetchApiTablesMeta(opts?: { signal?: AbortSignal; refresh?: boolean }): Promise<ApiTableMeta[]> {
  if (!opts?.refresh && allTablesMetaCache) return allTablesMetaCache;

  const raw = await apiGetTablesMeta(opts?.signal);
  const list = Array.isArray(raw) ? raw : [];
  allTablesMetaCache = list.map(row => {
    const name = String(row.name ?? row.table ?? '');
    const meta: ApiTableMeta = {
      name,
      primaryKey: String(row.primaryKey ?? row.primary_key ?? getApiTablePrimaryKey(name)),
      hasDeletedAt: Boolean(row.hasDeletedAt ?? row.has_deleted_at),
      columns: Array.isArray(row.columns) ? row.columns.map(String) : undefined,
    };
    tableMetaCache.set(name, meta);
    return meta;
  });
  return allTablesMetaCache;
}

export async function fetchApiTableMeta(table: string, opts?: { signal?: AbortSignal }): Promise<ApiTableMeta | null> {
  const cached = tableMetaCache.get(table);
  if (cached) return cached;
  await fetchApiTablesMeta(opts);
  return tableMetaCache.get(table) ?? null;
}

/** 分页拉取单页列表 */
export async function fetchApiTablePage<T extends Record<string, unknown>>(
  table: string,
  opts?: ApiListOptions,
): Promise<{ list: T[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  assertApiReadable(table);
  const data = await apiListRecords<T>(table, opts);
  const list = Array.isArray(data.list) ? data.list : [];
  const pagination = data.pagination ?? {
    page: opts?.page ?? 1,
    limit: opts?.limit ?? 50,
    total: list.length,
    totalPages: 1,
  };
  return { list, pagination };
}

/** 拉取全表（自动翻页，limit 最大 200） */
export async function fetchApiTableAll<T extends Record<string, unknown>>(
  table: string,
  opts?: Omit<ApiListOptions, 'page'> & { maxPages?: number },
): Promise<T[]> {
  assertApiReadable(table);
  if (!opts?.forceRefresh) {
    const inflight = inflightTableFetchAll.get(table);
    if (inflight) return inflight as Promise<T[]>;
  }

  const fetchPromise = (async (): Promise<T[]> => {
    const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 200);
    const maxPages = opts?.maxPages ?? 500;
    const all: T[] = [];
    let page = 1;

    while (page <= maxPages) {
      const { list, pagination } = await fetchApiTablePage<T>(table, {
        ...opts,
        page,
        limit,
      });
      all.push(...list);
      if (page >= pagination.totalPages || list.length === 0) break;
      page += 1;
    }

    await syncApiReadResultToLocal(table, all as Record<string, unknown>[], {
      reconcileSnapshot: true,
    });

    return all;
  })();

  inflightTableFetchAll.set(table, fetchPromise as Promise<Record<string, unknown>[]>);
  try {
    return await fetchPromise;
  } finally {
    if (inflightTableFetchAll.get(table) === fetchPromise) {
      inflightTableFetchAll.delete(table);
    }
  }
}

/** 按主键读单条（404 返回 null） */
export async function fetchApiRecordByPk<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
  opts?: { signal?: AbortSignal },
): Promise<T | null> {
  assertApiReadable(table);
  if (!pkValue.trim()) return null;
  try {
    const row = await apiGetRecord<T>(table, pkValue, opts);
    await syncApiReadResultToLocal(table, row as Record<string, unknown>);
    return row;
  } catch (e) {
    if (e instanceof Error && /404|不存在|not found/i.test(e.message)) {
      await applyApiRecordMissingToLocal(table, pkValue);
      return null;
    }
    throw e;
  }
}

/**
 * 统一读表：API_ONLY_READS 时 REST 全量 + 本地 pending 覆盖；
 * 否则先拉 REST 写入 SQLite 再读本地（兼容旧模式）。
 */
export async function readApiTable<T extends Record<string, unknown>>(
  table: string,
  opts?: ApiListOptions,
): Promise<T[]> {
  if (!isApiReadableTable(table)) {
    if (isApiOnlyReads()) return [];
    return readLocalTableAll<T>(table);
  }

  const skipNetwork = resolveReadLocalOnly(opts);
  if (!skipNetwork) {
    try {
      const rows = await withApiLoading(() => fetchApiTableAll<T>(table, opts));
      if (isApiOnlyReads()) {
        return overlayLocalPendingOnApiTableRows(table, rows);
      }
    } catch (e) {
      if (opts?.offlineFallback && !isApiOnlyReads()) {
        if (__DEV__) console.warn('[api-read] 回退本地 SQLite', table, e);
        return readLocalTableVisible<T>(table);
      }
      throw e;
    }
  }

  if (isApiOnlyReads()) {
    throw new Error(`[api-read] 表「${table}」在仅接口模式下必须请求 REST`);
  }
  return readLocalTableVisible<T>(table);
}

/** 强制从 REST 全量拉取 */
export async function refreshApiTable<T extends Record<string, unknown>>(
  table: string,
  opts?: Omit<ApiListOptions, 'forceRefresh' | 'localOnly'>,
): Promise<T[]> {
  return readApiTable<T>(table, { ...opts, forceRefresh: true, localOnly: false });
}

export async function readApiRecord<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
  opts?: {
    signal?: AbortSignal;
    offlineFallback?: boolean;
    forceRefresh?: boolean;
    localOnly?: boolean;
  },
): Promise<T | null> {
  if (!isApiReadableTable(table)) {
    if (isApiOnlyReads()) return null;
    return readLocalRecordVisible<T>(table, pkValue);
  }

  const skipNetwork = resolveReadLocalOnly(opts);
  if (!skipNetwork) {
    try {
      const row = await withApiLoading(() => fetchApiRecordByPk<T>(table, pkValue, opts));
      if (isApiOnlyReads()) {
        return overlayLocalPendingOnApiRecord(table, pkValue, row);
      }
    } catch (e) {
      if (opts?.offlineFallback && !isApiOnlyReads()) {
        if (__DEV__) console.warn('[api-read] 回退本地 SQLite', table, pkValue, e);
        return readLocalRecordVisible<T>(table, pkValue);
      }
      throw e;
    }
  }

  if (isApiOnlyReads()) {
    throw new Error(`[api-read] 表「${table}」记录在仅接口模式下必须请求 REST`);
  }
  return readLocalRecordVisible<T>(table, pkValue);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableHasSyncStatusColumn(table: string): Promise<boolean> {
  const db = await getDatabase();
  if (!db) return false;
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
  return cols.some(c => c.name === 'sync_status');
}

async function readLocalTableAll<T extends Record<string, unknown>>(table: string): Promise<T[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync(`SELECT * FROM ${quoteIdent(table)}`);
  return (rows as T[]) ?? [];
}

/** 读取本地表并排除待删除行（供 UI 展示） */
async function readLocalTableVisible<T extends Record<string, unknown>>(table: string): Promise<T[]> {
  const db = await getDatabase();
  if (!db) return [];
  const safe = quoteIdent(table);
  if (await tableHasSyncStatusColumn(table)) {
    const rows = await db.getAllAsync<T>(`SELECT * FROM ${safe} WHERE sync_status != 'pending_delete'`);
    return rows ?? [];
  }
  return readLocalTableAll<T>(table);
}

async function readLocalRecordByPk<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
): Promise<T | null> {
  const db = await getDatabase();
  if (!db) return null;
  const pkCol = getApiTablePrimaryKey(table);
  const row = await db.getFirstAsync<T>(
    `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkCol)} = ? LIMIT 1`,
    [pkValue],
  );
  return row ?? null;
}

async function readLocalRecordVisible<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
): Promise<T | null> {
  const row = await readLocalRecordByPk<T>(table, pkValue);
  if (!row) return null;
  const syncStatus = (row as Record<string, unknown>).sync_status;
  if (syncStatus === 'pending_delete') return null;
  return row;
}
