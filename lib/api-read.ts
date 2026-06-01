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
import { getDatabase } from '@/lib/database';

export type ApiListOptions = {
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
  signal?: AbortSignal;
};

export type ApiTableMeta = {
  name: string;
  primaryKey: string;
  hasDeletedAt: boolean;
  columns?: string[];
};

const tableMetaCache = new Map<string, ApiTableMeta>();
let allTablesMetaCache: ApiTableMeta[] | null = null;

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
 * 统一读表：优先 REST；本地只读表（app_meta）回退 SQLite。
 * 网络失败时可选回退本地缓存（offline fallback）。
 */
export async function readApiTable<T extends Record<string, unknown>>(
  table: string,
  opts?: ApiListOptions & { offlineFallback?: boolean },
): Promise<T[]> {
  if (!isApiReadableTable(table)) {
    return readLocalTableAll<T>(table);
  }
  try {
    return await withApiLoading(() => fetchApiTableAll<T>(table, opts));
  } catch (e) {
    if (opts?.offlineFallback) {
      if (__DEV__) console.warn('[api-read] 回退本地 SQLite', table, e);
      return readLocalTableAll<T>(table);
    }
    throw e;
  }
}

export async function readApiRecord<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
  opts?: { signal?: AbortSignal; offlineFallback?: boolean },
): Promise<T | null> {
  if (!isApiReadableTable(table)) {
    return readLocalRecordByPk<T>(table, pkValue);
  }
  try {
    return await withApiLoading(() => fetchApiRecordByPk<T>(table, pkValue, opts));
  } catch (e) {
    if (opts?.offlineFallback) {
      if (__DEV__) console.warn('[api-read] 回退本地 SQLite', table, pkValue, e);
      return readLocalRecordByPk<T>(table, pkValue);
    }
    throw e;
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function readLocalTableAll<T extends Record<string, unknown>>(table: string): Promise<T[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync(`SELECT * FROM ${quoteIdent(table)}`);
  return (rows as T[]) ?? [];
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
