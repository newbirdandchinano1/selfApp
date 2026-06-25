import { apiGetRecord, apiGetTablesMeta, apiListRecords } from '@/lib/api-client';
import {
  getApiTablePrimaryKey,
  isApiReadableTable,
} from '@/lib/api-allowed-tables';
import {
  applyApiRecordMissingToLocal,
  syncApiReadResultToLocal,
} from '@/lib/api-read-local-sync';
import { isApiOnlyReads, isLocalFirstReads } from '@/lib/api-data-mode';
import {
  overlayLocalPendingOnApiRecord,
  overlayLocalPendingOnApiTableRows,
} from '@/lib/api-read-pending-overlay';
import { getDatabase } from '@/lib/database';
import { markPageLoadRestFailed, resolveReadLocalOnly, resolveReadOfflineFallback } from '@/lib/page-api-session';

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
  /** habit_check_ins：record_date 范围（见 CALENDAR_API_FOR_APP.md） */
  startDate?: string;
  endDate?: string;
  dueDateGte?: string;
  dueDateLte?: string;
  frogAssignedOnGte?: string;
  frogAssignedOnLte?: string;
  createdAtGte?: string;
  createdAtLte?: string;
  assignedYmdGte?: string;
  assignedYmdLte?: string;
  calendarRelevant?: boolean;
  fields?: string;
  updatedSince?: string;
  /** summary.count：校验 pagination.total 与最终拉取行数 */
  expectedTotal?: number;
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

/**
 * 本地写入后递增代数；进行中的全量拉取若代数已变则跳过 reconcile 并自动重拉。
 * 不删除 inflight，避免正式包内并行两次全量拉取 + reconcile 互相覆盖（大表常见）。
 */
const tableFetchGeneration = new Map<string, number>();

const MAX_FETCH_ATTEMPTS_AFTER_INVALIDATE = 4;

const CORE_SNAPSHOT_TABLES = new Set<string>();

function isCoreSnapshotTable(table: string): boolean {
  return CORE_SNAPSHOT_TABLES.has(table.trim());
}

/** 同表 reconcile 串行化（bootstrap 与 fetchApiTableAll 共用，正式包并行时避免互相删行） */
const tableSyncLockDepth = new Map<string, number>();
const tableSyncLockTail = new Map<string, Promise<void>>();

export async function withApiTableSyncLock<T>(table: string, fn: () => Promise<T>): Promise<T> {
  const t = table.trim();
  if (!t) return fn();

  const held = tableSyncLockDepth.get(t) ?? 0;
  if (held > 0) {
    tableSyncLockDepth.set(t, held + 1);
    try {
      return await fn();
    } finally {
      tableSyncLockDepth.set(t, held);
    }
  }

  const prev = tableSyncLockTail.get(t) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const chained = prev.then(() => gate).catch(() => gate);
  tableSyncLockTail.set(t, chained);

  await prev.catch(() => {});
  tableSyncLockDepth.set(t, 1);
  try {
    return await fn();
  } finally {
    tableSyncLockDepth.delete(t);
    release();
    if (tableSyncLockTail.get(t) === chained) {
      tableSyncLockTail.delete(t);
    }
  }
}

/** 本地写入后标记进行中的全量拉取已过期，避免 UI 读到写入前的 REST 快照 */
export function invalidateInflightApiTableFetch(table: string): void {
  const t = table.trim();
  if (!t) return;
  tableFetchGeneration.set(t, (tableFetchGeneration.get(t) ?? 0) + 1);
}

/** 加载超时重试：作废全部进行中的全量拉取，避免继续等待陈旧 Promise */
export function invalidateAllInflightApiTableFetches(): void {
  const tables = new Set<string>([
    ...inflightTableFetchAll.keys(),
    ...tableFetchGeneration.keys(),
  ]);
  for (const table of tables) {
    invalidateInflightApiTableFetch(table);
  }
  inflightTableFetchAll.clear();
}

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

export type ApiTablePageFetchProgress = {
  knownTotal?: number;
  fetchedUnique?: number;
};

/**
 * 是否继续拉取下一页（配合 fetchApiTableAll 内按主键去重使用）。
 * - 本页有新行 → 继续
 * - 接口返回 total 且尚未拉满 → 继续（空页/重复页也再试，避免正式包只拿到前 50 条）
 * - 不单独依赖 totalPages（接口缺字段或 totalPages 偏小会导致只拉一页）
 */
export function shouldFetchNextApiTablePage(
  listLength: number,
  newRowCount: number,
  progress?: ApiTablePageFetchProgress,
): boolean {
  if (listLength > 0 && newRowCount > 0) return true;
  const total = progress?.knownTotal ?? 0;
  const fetched = progress?.fetchedUnique ?? 0;
  if (total > 0 && fetched < total) return true;
  return false;
}

async function pullAllApiTablePages<T extends Record<string, unknown>>(
  table: string,
  opts?: Omit<ApiListOptions, 'page'> & { maxPages?: number; allowIncomplete?: boolean },
): Promise<T[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 200);
  const maxPages = opts?.maxPages ?? 500;
  const pkCol = getApiTablePrimaryKey(table);
  const seenPk = new Set<string>();
  const all: T[] = [];
  let knownTotal = 0;
  let page = 1;

  while (page <= maxPages) {
    const { list, pagination } = await fetchApiTablePage<T>(table, {
      ...opts,
      page,
      limit,
    });
    if (pagination.total > knownTotal) knownTotal = pagination.total;

    if (opts?.expectedTotal != null && page === 1 && pagination.total !== opts.expectedTotal) {
      throw new Error(
        `[api-read] 表「${table}」pagination.total (${pagination.total}) 与 summary.count (${opts.expectedTotal}) 不一致`,
      );
    }

    let newRowCount = 0;
    for (const row of list) {
      const pkRaw = (row as Record<string, unknown>)[pkCol];
      const pk = pkRaw == null || pkRaw === '' ? '' : String(pkRaw).trim();
      if (!pk) {
        all.push(row);
        newRowCount += 1;
        continue;
      }
      if (seenPk.has(pk)) continue;
      seenPk.add(pk);
      all.push(row);
      newRowCount += 1;
    }

    const progress: ApiTablePageFetchProgress = {
      knownTotal: knownTotal > 0 ? knownTotal : undefined,
      fetchedUnique: seenPk.size,
    };

    if (knownTotal > 0 && seenPk.size >= knownTotal) break;
    if (!shouldFetchNextApiTablePage(list.length, newRowCount, progress)) break;
    page += 1;
  }

  const expectedRows = opts?.expectedTotal ?? (knownTotal > 0 ? knownTotal : 0);
  if (expectedRows > 0 && seenPk.size < expectedRows) {
    const msg = `[api-read] 表「${table}」分页不完整：已拉 ${seenPk.size}/${expectedRows} 条（page limit=${limit}）`;
    console.warn(msg);
    if (!opts?.allowIncomplete) {
      // 分页数据不完整时抛出错误，触发上层重试，避免静默写入不完整数据
      throw new Error(msg);
    }
  }

  if (opts?.expectedTotal != null && seenPk.size !== opts.expectedTotal) {
    const msg = `[api-read] 表「${table}」拉取行数 ${seenPk.size} 与 summary.count ${opts.expectedTotal} 不一致`;
    console.warn(msg);
    if (!opts?.allowIncomplete) {
      throw new Error(msg);
    }
  }

  return all;
}

/** 分页数据不完整时的最大重试次数 */
const MAX_INCOMPLETE_PAGINATION_RETRIES = 3;

/** 拉取全表（自动翻页，limit 最大 200） */
export async function fetchApiTableAll<T extends Record<string, unknown>>(
  table: string,
  opts?: Omit<ApiListOptions, 'page'> & { maxPages?: number },
): Promise<T[]> {
  assertApiReadable(table);

  const existingInflight = inflightTableFetchAll.get(table);
  if (opts?.forceRefresh && existingInflight) {
    invalidateInflightApiTableFetch(table);
    try {
      await existingInflight;
    } catch {
      /* 作废进行中的陈旧全量拉取，随后发起新的 forceRefresh */
    }
  } else if (existingInflight) {
    return existingInflight as Promise<T[]>;
  }

  const isIncompletePaginationError = (e: unknown): boolean =>
    e instanceof Error && /分页不完整/.test(e.message);

  const fetchPromise = withApiTableSyncLock(table, async (): Promise<T[]> => {
    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS_AFTER_INVALIDATE; attempt += 1) {
      const startGen = tableFetchGeneration.get(table) ?? 0;
      let all: T[];
      try {
        all = await pullAllApiTablePages<T>(table, opts);
      } catch (e) {
        // 分页不完整错误：重试而非直接失败
        if (isIncompletePaginationError(e) && attempt < MAX_INCOMPLETE_PAGINATION_RETRIES - 1) {
          console.warn(`[api-read] 表「${table}」分页不完整，重试 ${attempt + 1}/${MAX_INCOMPLETE_PAGINATION_RETRIES}`);
          continue;
        }
        throw e;
      }
      const endGen = tableFetchGeneration.get(table) ?? 0;
      if (startGen !== endGen) {
        continue;
      }
      await syncApiReadResultToLocal(table, all as Record<string, unknown>[], {
        reconcileSnapshot: true,
      });
      if (isApiOnlyReads()) {
        return readLocalTableVisible<T>(table);
      }
      return all;
    }

    let all: T[];
    try {
      all = await pullAllApiTablePages<T>(table, opts);
    } catch (e) {
      if (isIncompletePaginationError(e)) {
        if (isCoreSnapshotTable(table)) {
          console.warn(`[api-read] 表「${table}」重试后分页仍不完整，拒绝写入不完整快照`);
          throw e;
        }
        console.warn(`[api-read] 表「${table}」重试后分页仍不完整，接受已有数据`);
        const fallbackAll = await pullAllApiTablePages<T>(table, { ...opts, allowIncomplete: true });
        await syncApiReadResultToLocal(table, fallbackAll as Record<string, unknown>[], {
          reconcileSnapshot: true,
        });
        if (isApiOnlyReads()) return readLocalTableVisible<T>(table);
        return fallbackAll;
      }
      throw e;
    }
    await syncApiReadResultToLocal(table, all as Record<string, unknown>[], {
      reconcileSnapshot: true,
    });
    if (isApiOnlyReads()) {
      return readLocalTableVisible<T>(table);
    }
    return all;
  });

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
    if (isApiOnlyReads()) {
      return readLocalRecordVisible<T>(table, pkValue);
    }
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
 * 统一读表：local-first 时已同步页面直接读 SQLite；否则 REST 拉取并写入本地。
 * 接口失败且 offlineFallback 时回退 SQLite。API_ONLY 模式下优先 REST 再叠加 pending。
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
      const apiRows = await fetchApiTableAll<T>(table, opts);
      if (isApiOnlyReads()) {
        return overlayLocalPendingOnApiTableRows(table, apiRows);
      }
    } catch (e) {
      if (resolveReadOfflineFallback(opts?.offlineFallback)) {
        markPageLoadRestFailed();
        console.warn('[api-read] 接口不可用，回退本地 SQLite', table, e);
        return readLocalTableVisible<T>(table);
      }
      throw e;
    }
  }

  if (isApiOnlyReads()) {
    throw new Error(`[api-read] 表「${table}」在仅接口模式下必须请求 REST`);
  }
  const localRows = await readLocalTableVisible<T>(table);
  if (isLocalFirstReads() && !skipNetwork) {
    return overlayLocalPendingOnApiTableRows(table, localRows);
  }
  return localRows;
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
      const apiRow = await fetchApiRecordByPk<T>(table, pkValue, opts);
      if (isApiOnlyReads()) {
        return overlayLocalPendingOnApiRecord(table, pkValue, apiRow);
      }
    } catch (e) {
      if (resolveReadOfflineFallback(opts?.offlineFallback)) {
        markPageLoadRestFailed();
        console.warn('[api-read] 接口不可用，回退本地 SQLite', table, pkValue, e);
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
