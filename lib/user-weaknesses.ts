import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as SQLite from 'expo-sqlite';
import { getDatabase } from '@/lib/database';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
  markCloudSqliteTableDirty,
} from '@/lib/cloud-sql-dirty-track';

const WEAKNESS_LIST_KEY = 'user_weaknesses_v1';
const USER_WEAKNESSES_ASYNC_MIGRATED_KEY = 'user_weaknesses_async_migrated_v1';

export const WEAKNESS_TITLE_MAX = 120;
export const WEAKNESS_DETAIL_MAX = 8000;

export type UserWeaknessItem = {
  id: string;
  title: string;
  detail: string;
  created_at: string;
  updated_at: string;
  ai_evaluation?: string;
  ai_suggestions?: string;
  ai_review_at?: string;
};

type WeaknessRow = {
  id: string;
  title: string;
  detail: string;
  ai_evaluation: string | null;
  ai_suggestions: string | null;
  ai_review_at: string | null;
  created_at: string;
  updated_at: string;
};

function newId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function clampTitle(t: string): string {
  return t.length > WEAKNESS_TITLE_MAX ? t.slice(0, WEAKNESS_TITLE_MAX) : t;
}

function clampDetail(t: string): string {
  return t.length > WEAKNESS_DETAIL_MAX ? t.slice(0, WEAKNESS_DETAIL_MAX) : t;
}

function rowToWeakness(row: WeaknessRow): UserWeaknessItem {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.ai_evaluation?.trim() ? { ai_evaluation: row.ai_evaluation.trim() } : {}),
    ...(row.ai_suggestions?.trim() ? { ai_suggestions: row.ai_suggestions.trim() } : {}),
    ...(row.ai_review_at?.trim() ? { ai_review_at: row.ai_review_at.trim() } : {}),
  };
}

export function parseUserWeaknessItemsFromJson(raw: string | null): UserWeaknessItem[] {
  if (raw == null || raw === '') return [];
  try {
    const x = JSON.parse(raw) as unknown;
    if (!Array.isArray(x)) return [];
    const out: UserWeaknessItem[] = [];
    for (const row of x) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : '';
      const title = typeof r.title === 'string' ? r.title : '';
      const detail =
        typeof r.detail === 'string'
          ? r.detail
          : typeof r.body === 'string'
            ? r.body
            : '';
      const created_at = typeof r.created_at === 'string' ? r.created_at : '';
      const updated_at = typeof r.updated_at === 'string' ? r.updated_at : '';
      const ai_evaluation = typeof r.ai_evaluation === 'string' ? r.ai_evaluation : undefined;
      const ai_suggestions = typeof r.ai_suggestions === 'string' ? r.ai_suggestions : undefined;
      const ai_review_at = typeof r.ai_review_at === 'string' ? r.ai_review_at : undefined;
      if (!id || !created_at || !updated_at) continue;
      out.push({
        id,
        title,
        detail,
        created_at,
        updated_at,
        ...(ai_evaluation != null && ai_evaluation !== '' ? { ai_evaluation } : {}),
        ...(ai_suggestions != null && ai_suggestions !== '' ? { ai_suggestions } : {}),
        ...(ai_review_at != null && ai_review_at !== '' ? { ai_review_at } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function markWeaknessesDirty(): void {
  markCloudSqliteTableDirty('user_weaknesses');
}

async function importWeaknessesToDb(db: SQLite.SQLiteDatabase, items: UserWeaknessItem[]): Promise<void> {
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.execAsync('BEGIN IMMEDIATE');
    await db.runAsync('DELETE FROM user_weaknesses');
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO user_weaknesses (
          id, title, detail, ai_evaluation, ai_suggestions, ai_review_at,
          created_at, updated_at, deleted_at, sync_status, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 1)`,
        [
          item.id,
          clampTitle(item.title),
          clampDetail(item.detail),
          item.ai_evaluation?.trim() || null,
          item.ai_suggestions?.trim() || null,
          item.ai_review_at?.trim() || null,
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
  markWeaknessesDirty();
}

/** 启动时：将 AsyncStorage 中的缺点列表一次性迁入 SQLite */
export async function migrateUserWeaknessesStorageToSqliteIfNeeded(
  db?: SQLite.SQLiteDatabase,
): Promise<void> {
  const database = db ?? (await getDatabase());
  const flag = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [USER_WEAKNESSES_ASYNC_MIGRATED_KEY],
  );
  if (flag?.value === '1') return;

  const count = await database.getFirstAsync<{ c: number }>(
    'SELECT COUNT(1) AS c FROM user_weaknesses WHERE deleted_at IS NULL',
  );
  const hasSqliteData = Number(count?.c ?? 0) > 0;

  if (!hasSqliteData) {
    const raw = await AsyncStorage.getItem(WEAKNESS_LIST_KEY);
    const asyncItems = parseUserWeaknessItemsFromJson(raw);
    if (asyncItems.length > 0) {
      await importWeaknessesToDb(database, asyncItems);
    }
  }

  await AsyncStorage.removeItem(WEAKNESS_LIST_KEY);
  await database.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    USER_WEAKNESSES_ASYNC_MIGRATED_KEY,
    '1',
  ]);
}

/** 从云备份 kv payload 解析缺点列表。 */
export function userWeaknessItemsFromBackupPayload(payload: unknown): UserWeaknessItem[] {
  if (!Array.isArray(payload)) return [];
  return parseUserWeaknessItemsFromJson(JSON.stringify(payload));
}

/** 云恢复：用备份中的缺点列表整表覆盖本地。 */
export async function replaceUserWeaknessesFromCloudRestore(items: UserWeaknessItem[]): Promise<void> {
  const db = await getDatabase();
  await migrateUserWeaknessesStorageToSqliteIfNeeded(db);
  await importWeaknessesToDb(db, items);
}

export async function listUserWeaknesses(): Promise<UserWeaknessItem[]> {
  const db = await getDatabase();
  await migrateUserWeaknessesStorageToSqliteIfNeeded(db);
  const rows = await db.getAllAsync<WeaknessRow>(
    `SELECT id, title, detail, ai_evaluation, ai_suggestions, ai_review_at, created_at, updated_at
     FROM user_weaknesses WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
  );
  return rows.map(rowToWeakness);
}

export async function getUserWeakness(id: string): Promise<UserWeaknessItem | null> {
  const db = await getDatabase();
  await migrateUserWeaknessesStorageToSqliteIfNeeded(db);
  const row = await db.getFirstAsync<WeaknessRow>(
    `SELECT id, title, detail, ai_evaluation, ai_suggestions, ai_review_at, created_at, updated_at
     FROM user_weaknesses WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return row ? rowToWeakness(row) : null;
}

export async function createUserWeakness(input: {
  title: string;
  detail: string;
}): Promise<UserWeaknessItem> {
  const db = await getDatabase();
  await migrateUserWeaknessesStorageToSqliteIfNeeded(db);
  const now = new Date().toISOString();
  const item: UserWeaknessItem = {
    id: newId(),
    title: clampTitle(input.title),
    detail: clampDetail(input.detail),
    created_at: now,
    updated_at: now,
  };
  await db.runAsync(
    `INSERT INTO user_weaknesses (
      id, title, detail, ai_evaluation, ai_suggestions, ai_review_at,
      created_at, updated_at, deleted_at, sync_status, version
    ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, 'synced', 1)`,
    [item.id, item.title, item.detail, item.created_at, item.updated_at],
  );
  markWeaknessesDirty();
  return item;
}

export async function updateUserWeakness(
  id: string,
  patch: { title?: string; detail?: string },
): Promise<UserWeaknessItem | null> {
  const prev = await getUserWeakness(id);
  if (!prev) return null;
  const nextTitle = patch.title !== undefined ? clampTitle(patch.title) : prev.title;
  const nextDetail = patch.detail !== undefined ? clampDetail(patch.detail) : prev.detail;
  const contentChanged =
    (patch.title !== undefined && nextTitle !== prev.title) ||
    (patch.detail !== undefined && nextDetail !== prev.detail);
  const updated_at = new Date().toISOString();
  const db = await getDatabase();
  if (contentChanged) {
    await db.runAsync(
      `UPDATE user_weaknesses SET title = ?, detail = ?, ai_evaluation = NULL, ai_suggestions = NULL, ai_review_at = NULL,
        updated_at = ?, sync_status = 'synced', version = version + 1 WHERE id = ? AND deleted_at IS NULL`,
      [nextTitle, nextDetail, updated_at, id],
    );
  } else {
    await db.runAsync(
      `UPDATE user_weaknesses SET title = ?, detail = ?, updated_at = ?, sync_status = 'synced', version = version + 1
       WHERE id = ? AND deleted_at IS NULL`,
      [nextTitle, nextDetail, updated_at, id],
    );
  }
  markWeaknessesDirty();
  const next: UserWeaknessItem = {
    id: prev.id,
    title: nextTitle,
    detail: nextDetail,
    created_at: prev.created_at,
    updated_at,
  };
  if (!contentChanged) {
    if (prev.ai_evaluation) next.ai_evaluation = prev.ai_evaluation;
    if (prev.ai_suggestions) next.ai_suggestions = prev.ai_suggestions;
    if (prev.ai_review_at) next.ai_review_at = prev.ai_review_at;
  }
  return next;
}

export async function setUserWeaknessAiReview(
  id: string,
  payload: { evaluation: string; suggestions: string },
): Promise<UserWeaknessItem | null> {
  const prev = await getUserWeakness(id);
  if (!prev) return null;
  const now = new Date().toISOString();
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE user_weaknesses SET ai_evaluation = ?, ai_suggestions = ?, ai_review_at = ?, updated_at = ?,
      sync_status = 'synced', version = version + 1 WHERE id = ? AND deleted_at IS NULL`,
    [payload.evaluation.trim(), payload.suggestions.trim(), now, now, id],
  );
  markWeaknessesDirty();
  return {
    ...prev,
    ai_evaluation: payload.evaluation.trim(),
    ai_suggestions: payload.suggestions.trim(),
    ai_review_at: now,
    updated_at: now,
  };
}

export async function deleteUserWeakness(id: string): Promise<boolean> {
  const db = await getDatabase();
  await migrateUserWeaknessesStorageToSqliteIfNeeded(db);
  const result = await db.runAsync('DELETE FROM user_weaknesses WHERE id = ?', [id]);
  if ((result.changes ?? 0) < 1) return false;
  markWeaknessesDirty();
  return true;
}

export function weaknessListPreviewTitle(row: UserWeaknessItem): string {
  const t = row.title.trim();
  if (t) return t;
  const first = row.detail.trim().split(/\n/)[0]?.trim() ?? '';
  if (first) return first;
  return '未命名缺点';
}

export function weaknessListPreviewDetail(row: UserWeaknessItem): string {
  const b = row.detail.trim();
  return b || '（无详情）';
}

export function weaknessHasAiReview(row: UserWeaknessItem): boolean {
  return Boolean(row.ai_review_at?.trim());
}

export function weaknessContextForAiReview(row: UserWeaknessItem): string {
  const title = row.title.trim();
  const detail = row.detail.trim();
  if (!title && !detail) return '';
  const parts: string[] = [];
  const detailLines = detail ? detail.split(/\n/).filter(l => l.trim().length > 0).length : 0;
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
    `【元信息】名称 ${title.length} 字；详情 ${detail.length} 字${detailLines > 0 ? `（约 ${detailLines} 段/行）` : ''}；最近更新 ${updatedLabel}`,
  );
  if (title) parts.push(`【缺点名称】\n${title}`);
  if (detail) parts.push(`【详情说明】\n${detail}`);
  return parts.join('\n\n');
}
