import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
  markCloudSqliteTableDirty,
} from '@/lib/cloud-sql-dirty-track';
import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import type { PageApiReadOpts } from '@/lib/page-api-session';
import { sortBySortOrderAsc, sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getDatabase } from '@/lib/database';
import { makeTimestampEntityId } from '@/lib/entity-id';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as SQLite from 'expo-sqlite';

/** 旧版个人页单条备忘，迁移用 */
const LEGACY_SINGLE_MEMO_KEY = 'profile_screen_memo_v1';
const MEMO_LIST_KEY = 'memo_list_v2';
const MEMOS_ASYNC_MIGRATED_KEY = 'memos_async_migrated_v1';

export const MEMO_TITLE_MAX = 120;
export const MEMO_BODY_MAX = 8000;
export const MEMO_DIMENSION_MAX = 32;

export type MemoDimension = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MemoItem = {
  id: string;
  title: string;
  body: string;
  dimension_id?: string;
  dimension?: string;
  created_at: string;
  updated_at: string;
  ai_evaluation?: string;
  ai_suggestions?: string;
  ai_review_at?: string;
  linked_task_id?: string;
};

type MemoDimensionRow = {
  id: string;
  name: string;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

type MemoRow = {
  id: string;
  title: string;
  body: string;
  dimension_id: string | null;
  dimension: string | null;
  ai_evaluation: string | null;
  ai_suggestions: string | null;
  ai_review_at: string | null;
  linked_task_id: string | null;
  created_at: string;
  updated_at: string;
};

function newId(): string {
  return makeTimestampEntityId('', 9);
}

function newDimensionId(): string {
  return makeTimestampEntityId('md_', 8);
}

function clampTitle(t: string): string {
  return t.length > MEMO_TITLE_MAX ? t.slice(0, MEMO_TITLE_MAX) : t;
}

function clampBody(t: string): string {
  return t.length > MEMO_BODY_MAX ? t.slice(0, MEMO_BODY_MAX) : t;
}

function clampDimension(t: string): string {
  const x = t.trim();
  return x.length > MEMO_DIMENSION_MAX ? x.slice(0, MEMO_DIMENSION_MAX) : x;
}

function rowToDimension(row: MemoDimensionRow & { title?: string | null }): MemoDimension {
  return {
    id: row.id,
    name: (row.name ?? row.title ?? '').trim(),
    sort_order: Number(row.sort_order ?? 1000),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToMemo(row: MemoRow): MemoItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    ...(row.dimension_id?.trim() ? { dimension_id: row.dimension_id.trim() } : {}),
    ...(row.dimension?.trim() ? { dimension: row.dimension.trim() } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.ai_evaluation?.trim() ? { ai_evaluation: row.ai_evaluation.trim() } : {}),
    ...(row.ai_suggestions?.trim() ? { ai_suggestions: row.ai_suggestions.trim() } : {}),
    ...(row.ai_review_at?.trim() ? { ai_review_at: row.ai_review_at.trim() } : {}),
    ...(row.linked_task_id?.trim() ? { linked_task_id: row.linked_task_id.trim() } : {}),
  };
}

export function parseMemoItemsFromJson(raw: string | null): MemoItem[] {
  if (raw == null || raw === '') return [];
  try {
    const x = JSON.parse(raw) as unknown;
    if (!Array.isArray(x)) return [];
    const out: MemoItem[] = [];
    for (const row of x) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : '';
      const title = typeof r.title === 'string' ? r.title : '';
      const body = typeof r.body === 'string' ? r.body : '';
      const dimension_id = typeof r.dimension_id === 'string' ? r.dimension_id : undefined;
      const dimension = typeof r.dimension === 'string' ? r.dimension : undefined;
      const created_at = typeof r.created_at === 'string' ? r.created_at : '';
      const updated_at = typeof r.updated_at === 'string' ? r.updated_at : '';
      const ai_evaluation = typeof r.ai_evaluation === 'string' ? r.ai_evaluation : undefined;
      const ai_suggestions = typeof r.ai_suggestions === 'string' ? r.ai_suggestions : undefined;
      const ai_review_at = typeof r.ai_review_at === 'string' ? r.ai_review_at : undefined;
      const linked_task_id = typeof r.linked_task_id === 'string' ? r.linked_task_id : undefined;
      if (!id || !created_at || !updated_at) continue;
      out.push({
        id,
        title,
        body,
        ...(dimension_id != null && dimension_id.trim() !== '' ? { dimension_id: dimension_id.trim() } : {}),
        ...(dimension != null && dimension.trim() !== '' ? { dimension: clampDimension(dimension) } : {}),
        created_at,
        updated_at,
        ...(ai_evaluation != null && ai_evaluation !== '' ? { ai_evaluation } : {}),
        ...(ai_suggestions != null && ai_suggestions !== '' ? { ai_suggestions } : {}),
        ...(ai_review_at != null && ai_review_at !== '' ? { ai_review_at } : {}),
        ...(linked_task_id != null && linked_task_id !== '' ? { linked_task_id } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function markMemosDirty(): void {
  markCloudSqliteTableDirty('memos');
  void import('@/lib/api-write-sync').then(m => m.pushLocalChangesToApi());
}

function markMemoDimensionsDirty(): void {
  markCloudSqliteTableDirty('memo_dimensions');
  void import('@/lib/api-write-sync').then(m => m.pushLocalChangesToApi());
}

async function readAsyncStorageMemosForMigration(): Promise<MemoItem[]> {
  const raw = await AsyncStorage.getItem(MEMO_LIST_KEY);
  if (raw != null && raw !== '') {
    return parseMemoItemsFromJson(raw);
  }
  const legacy = await AsyncStorage.getItem(LEGACY_SINGLE_MEMO_KEY);
  if (legacy?.trim()) {
    const now = new Date().toISOString();
    return [
      {
        id: newId(),
        title: '备忘录',
        body: legacy.trim(),
        created_at: now,
        updated_at: now,
      },
    ];
  }
  return [];
}

async function importMemosToDb(db: SQLite.SQLiteDatabase, items: MemoItem[]): Promise<void> {
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.execAsync('BEGIN IMMEDIATE');
    await db.runAsync('DELETE FROM memos');
    const dimensionIdsByName = new Map<string, string>();
    const existingDims = await db.getAllAsync<MemoDimensionRow>(
      'SELECT id, name, sort_order, created_at, updated_at FROM memo_dimensions',
    );
    for (const dim of existingDims) {
      dimensionIdsByName.set(dim.name.trim(), dim.id);
    }
    for (const item of items) {
      let dimensionId = item.dimension_id?.trim() || null;
      const dimensionName = item.dimension ? clampDimension(item.dimension) : '';
      if (!dimensionId && dimensionName) {
        dimensionId = dimensionIdsByName.get(dimensionName) ?? null;
        if (!dimensionId) {
          dimensionId = newDimensionId();
          dimensionIdsByName.set(dimensionName, dimensionId);
          await db.runAsync(
            `INSERT INTO memo_dimensions (
              id, name, sort_order, created_at, updated_at, sync_status
            ) VALUES (?, ?, ?, ?, ?, 'synced')`,
            [dimensionId, dimensionName, dimensionIdsByName.size * 1000, item.created_at, item.updated_at],
          );
        }
      }
      await db.runAsync(
        `INSERT INTO memos (
          id, title, body, dimension_id, dimension, ai_evaluation, ai_suggestions, ai_review_at, linked_task_id,
          created_at, updated_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
        [
          item.id,
          clampTitle(item.title),
          clampBody(item.body),
          dimensionId,
          dimensionName || null,
          item.ai_evaluation?.trim() || null,
          item.ai_suggestions?.trim() || null,
          item.ai_review_at?.trim() || null,
          item.linked_task_id?.trim() || null,
          item.created_at,
          item.updated_at,
        ],
      );
    }
    await db.execAsync('COMMIT');
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
  markMemosDirty();
  markMemoDimensionsDirty();
}

/** 启动时：将 AsyncStorage 中的备忘一次性迁入 SQLite */
export async function migrateMemosStorageToSqliteIfNeeded(db?: SQLite.SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  const flag = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [MEMOS_ASYNC_MIGRATED_KEY],
  );
  if (flag?.value === '1') return;

  const count = await database.getFirstAsync<{ c: number }>(
    'SELECT COUNT(1) AS c FROM memos',
  );
  const hasSqliteData = Number(count?.c ?? 0) > 0;

  await backfillMemoDimensionsIfNeeded(database);

  if (!hasSqliteData) {
    const asyncItems = await readAsyncStorageMemosForMigration();
    if (asyncItems.length > 0) {
      await importMemosToDb(database, asyncItems);
    }
  }

  await AsyncStorage.multiRemove([MEMO_LIST_KEY, LEGACY_SINGLE_MEMO_KEY]);
  await database.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    MEMOS_ASYNC_MIGRATED_KEY,
    '1',
  ]);
}

async function backfillMemoDimensionsIfNeeded(db: SQLite.SQLiteDatabase): Promise<void> {
  const flag = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    ['memo_dimensions_backfilled_v1'],
  );
  if (flag?.value === '1') return;

  const rows = await db.getAllAsync<{ dimension: string }>(
    `SELECT DISTINCT TRIM(dimension) AS dimension
     FROM memos
     WHERE dimension IS NOT NULL AND TRIM(dimension) != ''`,
  );
  let sort = 1000;
  for (const row of rows) {
    const name = clampDimension(row.dimension);
    if (!name) continue;
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM memo_dimensions WHERE name = ? LIMIT 1',
      [name],
    );
    const dimensionId = existing?.id ?? newDimensionId();
    if (!existing) {
      await db.runAsync(
        `INSERT INTO memo_dimensions (
          id, name, sort_order, created_at, updated_at, sync_status
        ) VALUES (?, ?, ?, datetime('now'), datetime('now'), 'synced')`,
        [dimensionId, name, sort],
      );
      sort += 1000;
    }
    await db.runAsync(
      `UPDATE memos SET dimension_id = ?
       WHERE dimension_id IS NULL AND TRIM(COALESCE(dimension, '')) = ?`,
      [dimensionId, name],
    );
  }
  await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    'memo_dimensions_backfilled_v1',
    '1',
  ]);
}

async function repairEmptyMemoDimensionNames(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `UPDATE memo_dimensions
     SET name = COALESCE(
       (
         SELECT TRIM(m.dimension)
         FROM memos m
         WHERE m.dimension_id = memo_dimensions.id
           AND TRIM(COALESCE(m.dimension, '')) != ''
         LIMIT 1
       ),
       '未命名维度'
     ),
     updated_at = datetime('now')
     WHERE TRIM(COALESCE(name, '')) = ''`,
  );
}

/** 启动时：从 memos.dimension 回填 memo_dimensions，并修复空名称 */
export async function ensureMemoDimensionsBackfilled(db?: SQLite.SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  await backfillMemoDimensionsIfNeeded(database);
  await repairEmptyMemoDimensionNames(database);
}

async function listMemosFromApi(dimensionId?: string, opts?: PageApiReadOpts): Promise<MemoItem[]> {
  const readOpts = { offlineFallback: true as const, localOnly: opts?.localOnly };
  const [memoRows, dimensionRows] = await Promise.all([
    readApiTable<MemoRow>('memos', readOpts),
    readApiTable<MemoDimensionRow>('memo_dimensions', readOpts),
  ]);
  const dimNameById = new Map(dimensionRows.map(d => [d.id, d.name]));
  let filtered = memoRows;
  if (dimensionId) filtered = memoRows.filter(m => m.dimension_id === dimensionId);
  return sortByUpdatedDesc(filtered).map(row =>
    rowToMemo({
      ...row,
      dimension: dimNameById.get(row.dimension_id ?? '') ?? row.dimension ?? '',
    }),
  );
}

async function getMemoFromApi(id: string): Promise<MemoItem | null> {
  const row = await readApiRecord<MemoRow>('memos', id, { offlineFallback: true });
  if (!row) return null;
  let dimension = row.dimension ?? '';
  if (row.dimension_id) {
    const dim = await readApiRecord<MemoDimensionRow>('memo_dimensions', row.dimension_id, {
      offlineFallback: true,
    });
    if (dim?.name) dimension = dim.name;
  }
  return rowToMemo({ ...row, dimension });
}

async function listMemosFromDb(db: SQLite.SQLiteDatabase, dimensionId?: string): Promise<MemoItem[]> {
  const where = dimensionId
    ? 'WHERE memos.dimension_id = ?'
    : '';
  const rows = await db.getAllAsync<MemoRow>(
    `SELECT memos.id, memos.title, memos.body, memos.dimension_id,
       COALESCE(memo_dimensions.name, memos.dimension) AS dimension,
       memos.ai_evaluation, memos.ai_suggestions, memos.ai_review_at, memos.linked_task_id,
       memos.created_at, memos.updated_at
     FROM memos
     LEFT JOIN memo_dimensions ON memo_dimensions.id = memos.dimension_id
     ${where}
     ORDER BY memos.updated_at DESC`,
    dimensionId ? [dimensionId] : [],
  );
  return rows.map(rowToMemo);
}

/** 从云备份 kv payload 解析备忘列表。 */
export function memoItemsFromBackupPayload(payload: unknown): MemoItem[] {
  if (!Array.isArray(payload)) return [];
  return parseMemoItemsFromJson(JSON.stringify(payload));
}

/** 云恢复：用备份中的备忘列表整表覆盖本地。 */
export async function replaceMemosFromCloudRestore(items: MemoItem[]): Promise<void> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  await importMemosToDb(db, items);
}

export async function listMemoDimensions(opts?: PageApiReadOpts): Promise<MemoDimension[]> {
  await ensureMemoDimensionsBackfilled();
  const rows = await readApiTable<MemoDimensionRow>('memo_dimensions', {
    offlineFallback: true,
    localOnly: opts?.localOnly,
  });
  return sortBySortOrderAsc(rows).map(rowToDimension).filter(d => d.id);
}

export async function createMemoDimension(input: { name: string }): Promise<MemoDimension> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  const name = clampDimension(input.name);
  if (!name) throw new Error('维度名称不能为空');
  const now = new Date().toISOString();
  const maxSort = await db.getFirstAsync<{ v: number }>(
    'SELECT MAX(COALESCE(sort_order, 0)) AS v FROM memo_dimensions',
  );
  const item: MemoDimension = {
    id: newDimensionId(),
    name,
    sort_order: Number(maxSort?.v ?? 0) + 1000,
    created_at: now,
    updated_at: now,
  };
  await db.runAsync(
    `INSERT INTO memo_dimensions (
      id, name, sort_order, created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, 'pending_create')`,
    [item.id, item.name, item.sort_order, item.created_at, item.updated_at],
  );
  markMemoDimensionsDirty();
  return item;
}

export async function updateMemoDimension(id: string, patch: { name: string }): Promise<MemoDimension | null> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  const name = clampDimension(patch.name);
  if (!name) throw new Error('维度名称不能为空');
  const prev = await ensureLocalRowForWrite<MemoDimensionRow>('memo_dimensions', id);
  if (!prev) return null;
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE memo_dimensions
     SET name = ?, updated_at = ?,
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [name, now, id],
  );
  await db.runAsync(
    `UPDATE memos
     SET dimension = ?, updated_at = ?,
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE dimension_id = ?`,
    [name, now, id],
  );
  markMemoDimensionsDirty();
  markMemosDirty();
  return rowToDimension({ ...prev, name, updated_at: now });
}

export async function deleteMemoDimension(id: string): Promise<boolean> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  const dim = await db.getFirstAsync<{ sync_status: string }>(
    'SELECT sync_status FROM memo_dimensions WHERE id = ? LIMIT 1',
    [id],
  );
  if (!dim) return false;

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    const memos = await db.getAllAsync<{ id: string; sync_status: string }>(
      'SELECT id, sync_status FROM memos WHERE dimension_id = ?',
      [id],
    );
    for (const m of memos) {
      if (m.sync_status === 'pending_create') {
        await db.runAsync('DELETE FROM memos WHERE id = ?', [m.id]);
      } else {
        await db.runAsync(
          `UPDATE memos SET updated_at = datetime('now'), sync_status = 'pending_delete' WHERE id = ?`,
          [m.id],
        );
      }
    }
    if (dim.sync_status === 'pending_create') {
      await db.runAsync('DELETE FROM memo_dimensions WHERE id = ?', [id]);
    } else {
      await db.runAsync(
        `UPDATE memo_dimensions SET updated_at = datetime('now'), sync_status = 'pending_delete' WHERE id = ?`,
        [id],
      );
    }
    await db.execAsync('COMMIT');
    markMemoDimensionsDirty();
    markMemosDirty();
    return true;
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export async function listMemos(dimensionId?: string, opts?: PageApiReadOpts): Promise<MemoItem[]> {
  return listMemosFromApi(dimensionId, opts);
}

export async function getMemo(id: string): Promise<MemoItem | null> {
  return getMemoFromApi(id);
}

export async function createMemo(input: { title: string; body: string; dimensionId: string }): Promise<MemoItem> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  const dimension = await db.getFirstAsync<MemoDimensionRow>(
    'SELECT id, name, sort_order, created_at, updated_at FROM memo_dimensions WHERE id = ? LIMIT 1',
    [input.dimensionId],
  );
  if (!dimension) throw new Error('请先选择有效维度');
  const now = new Date().toISOString();
  const item: MemoItem = {
    id: newId(),
    title: clampTitle(input.title),
    body: clampBody(input.body),
    dimension_id: dimension.id,
    dimension: dimension.name,
    created_at: now,
    updated_at: now,
  };
  await db.runAsync(
    `INSERT INTO memos (
      id, title, body, dimension_id, dimension, ai_evaluation, ai_suggestions, ai_review_at, linked_task_id,
      created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, 'pending_create')`,
    [item.id, item.title, item.body, item.dimension_id ?? null, item.dimension ?? null, item.created_at, item.updated_at],
  );
  markMemosDirty();
  return item;
}

export async function updateMemo(
  id: string,
  patch: { title?: string; body?: string; dimensionId?: string },
): Promise<MemoItem | null> {
  const row = await ensureLocalRowForWrite<MemoRow>('memos', id);
  const prev = row ? rowToMemo(row) : null;
  if (!prev) return null;
  const nextTitle = patch.title !== undefined ? clampTitle(patch.title) : prev.title;
  const nextBody = patch.body !== undefined ? clampBody(patch.body) : prev.body;
  let nextDimensionId = patch.dimensionId !== undefined ? patch.dimensionId.trim() : prev.dimension_id ?? '';
  let nextDimension = prev.dimension ?? '';
  const db = await getDatabase();
  if (nextDimensionId) {
    const dim = await db.getFirstAsync<MemoDimensionRow>(
      'SELECT id, name, sort_order, created_at, updated_at FROM memo_dimensions WHERE id = ? LIMIT 1',
      [nextDimensionId],
    );
    if (!dim) throw new Error('请选择有效维度');
    nextDimensionId = dim.id;
    nextDimension = dim.name;
  }
  const contentChanged =
    (patch.title !== undefined && nextTitle !== prev.title) ||
    (patch.body !== undefined && nextBody !== prev.body);
  const updated_at = new Date().toISOString();
  if (contentChanged) {
    await db.runAsync(
      `UPDATE memos SET title = ?, body = ?, dimension_id = ?, dimension = ?, ai_evaluation = NULL, ai_suggestions = NULL, ai_review_at = NULL,
        updated_at = ?,
        sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END WHERE id = ?`,
      [nextTitle, nextBody, nextDimensionId || null, nextDimension || null, updated_at, id],
    );
  } else {
    await db.runAsync(
      `UPDATE memos SET title = ?, body = ?, dimension_id = ?, dimension = ?, updated_at = ?,
        sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [nextTitle, nextBody, nextDimensionId || null, nextDimension || null, updated_at, id],
    );
  }
  markMemosDirty();
  const next: MemoItem = {
    id: prev.id,
    title: nextTitle,
    body: nextBody,
    ...(nextDimensionId ? { dimension_id: nextDimensionId } : {}),
    ...(nextDimension ? { dimension: nextDimension } : {}),
    created_at: prev.created_at,
    updated_at,
  };
  if (!contentChanged) {
    if (prev.ai_evaluation) next.ai_evaluation = prev.ai_evaluation;
    if (prev.ai_suggestions) next.ai_suggestions = prev.ai_suggestions;
    if (prev.ai_review_at) next.ai_review_at = prev.ai_review_at;
  }
  if (prev.linked_task_id) next.linked_task_id = prev.linked_task_id;
  return next;
}

export async function setMemoAiReview(
  id: string,
  payload: { evaluation: string; suggestions: string },
): Promise<MemoItem | null> {
  const prev = await getMemo(id);
  if (!prev) return null;
  const now = new Date().toISOString();
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE memos SET ai_evaluation = ?, ai_suggestions = ?, ai_review_at = ?, updated_at = ?,
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END WHERE id = ?`,
    [payload.evaluation.trim(), payload.suggestions.trim(), now, now, id],
  );
  markMemosDirty();
  return {
    ...prev,
    ai_evaluation: payload.evaluation.trim(),
    ai_suggestions: payload.suggestions.trim(),
    ai_review_at: now,
    updated_at: now,
  };
}

/**
 * 推荐：`POST /api/app/memos/:id/ai-review`（服务端分析并落库），再刷新本地。
 * 失败时抛出，由调用方决定是否回退到纯分析接口。
 */
export async function runMemoAiReviewOnServer(id: string): Promise<MemoItem | null> {
  const { appMemoAiReview } = await import('@/lib/api-app-domain');
  const data = await appMemoAiReview(id);
  const evaluation =
    typeof data.ai_evaluation === 'string'
      ? data.ai_evaluation.trim()
      : typeof data.evaluation === 'string'
        ? data.evaluation.trim()
        : '';
  const suggestions =
    typeof data.ai_suggestions === 'string'
      ? data.ai_suggestions.trim()
      : typeof data.suggestions === 'string'
        ? data.suggestions.trim()
        : '';
  if (!evaluation && !suggestions) return null;

  const prev = await getMemo(id);
  if (!prev) return null;
  const now =
    typeof data.ai_review_at === 'string' && data.ai_review_at.trim()
      ? data.ai_review_at.trim()
      : new Date().toISOString();
  const updatedAt =
    typeof data.updated_at === 'string' && data.updated_at.trim()
      ? data.updated_at.trim()
      : now;

  const db = await getDatabase();
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.runAsync(
      `UPDATE memos SET ai_evaluation = ?, ai_suggestions = ?, ai_review_at = ?, updated_at = ?,
        sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'synced' END
       WHERE id = ?`,
      [evaluation, suggestions, now, updatedAt, id],
    );
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }

  return {
    ...prev,
    ...(evaluation ? { ai_evaluation: evaluation } : {}),
    ...(suggestions ? { ai_suggestions: suggestions } : {}),
    ai_review_at: now,
    updated_at: updatedAt,
  };
}

export async function deleteMemo(id: string): Promise<boolean> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  const row = await db.getFirstAsync<{ sync_status: string }>(
    'SELECT sync_status FROM memos WHERE id = ? LIMIT 1',
    [id],
  );
  if (!row) return false;
  if (row.sync_status === 'pending_create') {
    await db.runAsync('DELETE FROM memos WHERE id = ?', [id]);
  } else {
    await db.runAsync(
      `UPDATE memos SET updated_at = datetime('now'), sync_status = 'pending_delete' WHERE id = ?`,
      [id],
    );
  }
  markMemosDirty();
  return true;
}

export function memoListPreviewTitle(row: MemoItem): string {
  const t = row.title.trim();
  if (t) return t;
  const first = row.body.trim().split(/\n/)[0]?.trim() ?? '';
  if (first) return first.length > 48 ? `${first.slice(0, 48)}…` : first;
  return '无标题';
}

export function memoListPreviewBody(row: MemoItem): string {
  const b = row.body.trim();
  if (!b) return '（无正文）';
  const one = b.split(/\n/)[0]!.trim();
  return one.length > 80 ? `${one.slice(0, 80)}…` : one;
}

export function memoContextForAiReview(row: MemoItem): string {
  const title = row.title.trim();
  const body = row.body.trim();
  if (!title && !body) return '';
  const parts: string[] = [];
  const bodyLines = body ? body.split(/\n/).filter(l => l.trim().length > 0).length : 0;
  const dimension = row.dimension?.trim() || '';
  const updatedLabel = row.updated_at
    ? new Date(row.updated_at).toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '未知';
  parts.push(
    `【元信息】标题 ${title.length} 字；正文 ${body.length} 字${bodyLines > 0 ? `（约 ${bodyLines} 段/行）` : ''}；维度 ${dimension || '未设置'}；最近更新 ${updatedLabel}`,
  );
  if (dimension) parts.push(`【维度】\n${dimension}`);
  if (title) parts.push(`【标题】\n${title}`);
  if (body) parts.push(`【正文】\n${body}`);
  return parts.join('\n\n');
}
