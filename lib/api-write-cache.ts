/**
 * 阶段 3：服务器成功后再写 SQLite 缓存。
 * 失败不落 pending、不依赖 requestPush 补传。
 */
import { getApiTablePrimaryKey } from '@/lib/api-allowed-tables';
import {
  apiCreateRecord,
  apiDeleteRecord,
  apiPatchRecord,
  apiUpdateRecord,
  ApiRequestError,
  ensureApiLoggedIn} from '@/lib/api-client';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch} from '@/lib/cloud-sql-dirty-track';
import { getDatabase } from '@/lib/database';

function stripLocalOnlyFields(row: Record<string, unknown>): Record<string, unknown> {
  const body = { ...row };
  delete body.sync_status;
  return body;
}

function withSyncedStatus(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, sync_status: 'synced' };
}

/** 从写接口响应或本地组装行写入缓存（不触发脏表推送） */
export async function cacheServerRowLocally(
  table: string,
  row: Record<string, unknown> | null | undefined): Promise<void> {
  if (!row || typeof row !== 'object') return;
  await syncApiReadResultToLocal(table, withSyncedStatus(row));
  invalidateInflightApiTableFetch(table);
}

/** POST 创建成功后写缓存；失败不改本地 */
export async function createViaApiThenCache(
  table: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal; cacheRow?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  await ensureApiLoggedIn();
  const body = stripLocalOnlyFields(row);
  const created = await apiCreateRecord<Record<string, unknown>>(table, body, {
    signal: opts?.signal});
  const cacheRow =
    created && typeof created === 'object' && !Array.isArray(created)
      ? { ...body, ...created }
      : (opts?.cacheRow ?? body);
  await cacheServerRowLocally(table, cacheRow);
  return cacheRow;
}

/** PUT 全量更新成功后写缓存 */
export async function updateViaApiThenCache(
  table: string,
  id: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal; cacheRow?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  await ensureApiLoggedIn();
  const body = stripLocalOnlyFields(row);
  const updated = await apiUpdateRecord<Record<string, unknown>>(table, id, body, {
    signal: opts?.signal});
  const cacheRow =
    updated && typeof updated === 'object' && !Array.isArray(updated)
      ? { ...body, id, ...updated }
      : (opts?.cacheRow ?? { ...body, id });
  await cacheServerRowLocally(table, cacheRow);
  return cacheRow;
}

/** PATCH 部分更新成功后写缓存 */
export async function patchViaApiThenCache(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  opts?: { signal?: AbortSignal; cacheRow?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  await ensureApiLoggedIn();
  const body = stripLocalOnlyFields(patch);
  const updated = await apiPatchRecord<Record<string, unknown>>(table, id, body, {
    signal: opts?.signal});
  const cacheRow =
    updated && typeof updated === 'object' && !Array.isArray(updated)
      ? { id, ...body, ...updated }
      : (opts?.cacheRow ?? { id, ...body });
  await cacheServerRowLocally(table, cacheRow);
  return cacheRow;
}

/** DELETE 成功后清本地缓存行；404 视为已删 */
export async function deleteViaApiThenCache(
  table: string,
  id: string,
  opts?: { signal?: AbortSignal; expectedRev?: number | null; mutationId?: string | null }): Promise<void> {
  await ensureApiLoggedIn();
  try {
    await apiDeleteRecord(table, id, {
      signal: opts?.signal,
      expectedRev: opts?.expectedRev,
      mutationId: opts?.mutationId});
  } catch (e) {
    if (!(e instanceof ApiRequestError && e.httpStatus === 404)) throw e;
  }
  const db = await getDatabase();
  if (!db) return;
  const pkCol = getApiTablePrimaryKey(table);
  const safeTable = `"${table.replace(/"/g, '""')}"`;
  const safePk = `"${pkCol.replace(/"/g, '""')}"`;
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.runAsync(`DELETE FROM ${safeTable} WHERE ${safePk} = ?`, [id]);
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
  invalidateInflightApiTableFetch(table);
}
