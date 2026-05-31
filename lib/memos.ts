import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as SQLite from 'expo-sqlite';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '@/lib/database';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
  markCloudSqliteTableDirty,
} from '@/lib/cloud-sql-dirty-track';

/** 旧版个人页单条备忘，迁移用 */
const LEGACY_SINGLE_MEMO_KEY = 'profile_screen_memo_v1';
const MEMO_LIST_KEY = 'memo_list_v2';
const MEMOS_ASYNC_MIGRATED_KEY = 'memos_async_migrated_v1';

export const MEMO_TITLE_MAX = 120;
export const MEMO_BODY_MAX = 8000;

export type MemoItem = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  ai_evaluation?: string;
  ai_suggestions?: string;
  ai_review_at?: string;
  linked_task_id?: string;
};

type MemoRow = {
  id: string;
  title: string;
  body: string;
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

function clampTitle(t: string): string {
  return t.length > MEMO_TITLE_MAX ? t.slice(0, MEMO_TITLE_MAX) : t;
}

function clampBody(t: string): string {
  return t.length > MEMO_BODY_MAX ? t.slice(0, MEMO_BODY_MAX) : t;
}

function rowToMemo(row: MemoRow): MemoItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
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
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO memos (
          id, title, body, ai_evaluation, ai_suggestions, ai_review_at, linked_task_id,
          created_at, updated_at, deleted_at, sync_status, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 1)`,
        [
          item.id,
          clampTitle(item.title),
          clampBody(item.body),
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
    'SELECT COUNT(1) AS c FROM memos WHERE deleted_at IS NULL',
  );
  const hasSqliteData = Number(count?.c ?? 0) > 0;

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

async function listMemosFromDb(db: SQLite.SQLiteDatabase): Promise<MemoItem[]> {
  const rows = await db.getAllAsync<MemoRow>(
    `SELECT id, title, body, ai_evaluation, ai_suggestions, ai_review_at, linked_task_id, created_at, updated_at
     FROM memos WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
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

export async function listMemos(): Promise<MemoItem[]> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  return listMemosFromDb(db);
}

export async function getMemo(id: string): Promise<MemoItem | null> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  const row = await db.getFirstAsync<MemoRow>(
    `SELECT id, title, body, ai_evaluation, ai_suggestions, ai_review_at, linked_task_id, created_at, updated_at
     FROM memos WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return row ? rowToMemo(row) : null;
}

export async function createMemo(input: { title: string; body: string }): Promise<MemoItem> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  const now = new Date().toISOString();
  const item: MemoItem = {
    id: newId(),
    title: clampTitle(input.title),
    body: clampBody(input.body),
    created_at: now,
    updated_at: now,
  };
  await db.runAsync(
    `INSERT INTO memos (
      id, title, body, ai_evaluation, ai_suggestions, ai_review_at, linked_task_id,
      created_at, updated_at, deleted_at, sync_status, version
    ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL, 'synced', 1)`,
    [item.id, item.title, item.body, item.created_at, item.updated_at],
  );
  markMemosDirty();
  return item;
}

export async function updateMemo(
  id: string,
  patch: { title?: string; body?: string },
): Promise<MemoItem | null> {
  const prev = await getMemo(id);
  if (!prev) return null;
  const nextTitle = patch.title !== undefined ? clampTitle(patch.title) : prev.title;
  const nextBody = patch.body !== undefined ? clampBody(patch.body) : prev.body;
  const contentChanged =
    (patch.title !== undefined && nextTitle !== prev.title) ||
    (patch.body !== undefined && nextBody !== prev.body);
  const updated_at = new Date().toISOString();
  const db = await getDatabase();
  if (contentChanged) {
    await db.runAsync(
      `UPDATE memos SET title = ?, body = ?, ai_evaluation = NULL, ai_suggestions = NULL, ai_review_at = NULL,
        updated_at = ?, sync_status = 'synced', version = version + 1 WHERE id = ? AND deleted_at IS NULL`,
      [nextTitle, nextBody, updated_at, id],
    );
  } else {
    await db.runAsync(
      `UPDATE memos SET title = ?, body = ?, updated_at = ?, sync_status = 'synced', version = version + 1
       WHERE id = ? AND deleted_at IS NULL`,
      [nextTitle, nextBody, updated_at, id],
    );
  }
  markMemosDirty();
  const next: MemoItem = {
    id: prev.id,
    title: nextTitle,
    body: nextBody,
    created_at: prev.created_at,
    updated_at,
  };
  if (!contentChanged) {
    if (prev.ai_evaluation) next.ai_evaluation = prev.ai_evaluation;
    if (prev.ai_suggestions) next.ai_suggestions = prev.ai_suggestions;
    if (prev.ai_review_at) next.ai_review_at = prev.ai_review_at;
    if (prev.linked_task_id) next.linked_task_id = prev.linked_task_id;
  }
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
      sync_status = 'synced', version = version + 1 WHERE id = ? AND deleted_at IS NULL`,
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

export async function deleteMemo(id: string): Promise<boolean> {
  const db = await getDatabase();
  await migrateMemosStorageToSqliteIfNeeded(db);
  const result = await db.runAsync('DELETE FROM memos WHERE id = ?', [id]);
  if ((result.changes ?? 0) < 1) return false;
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
    `【元信息】标题 ${title.length} 字；正文 ${body.length} 字${bodyLines > 0 ? `（约 ${bodyLines} 段/行）` : ''}；最近更新 ${updatedLabel}`,
  );
  if (title) parts.push(`【标题】\n${title}`);
  if (body) parts.push(`【正文】\n${body}`);
  return parts.join('\n\n');
}
