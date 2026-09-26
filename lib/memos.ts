import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
  markCloudSqliteTableDirty,
} from '@/lib/cloud-sql-dirty-track';
import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { getDatabase } from '@/lib/database';
import { makeTimestampEntityId } from '@/lib/entity-id';
import type * as SQLite from 'expo-sqlite';

export const MEMO_TITLE_MAX = 120;
export const MEMO_BODY_MAX = 8000;

export type MemoItem = {
  id: string;
  title: string;
  body: string;
  /** @deprecated 分类以 tags 为准；仅兼容旧备份 */
  dimension_id?: string;
  /** @deprecated 分类以 tags 为准；仅兼容旧备份 */
  dimension?: string;
  /** 置顶：1/true 置顶 */
  is_pinned?: boolean;
  created_at: string;
  updated_at: string;
  ai_evaluation?: string;
  ai_suggestions?: string;
  ai_review_at?: string;
  linked_task_id?: string;
};

export type MemoSortMode = 'updated' | 'created' | 'title';

type MemoRow = {
  id: string;
  title: string;
  body: string;
  dimension_id: string | null;
  dimension: string | null;
  is_pinned?: number | boolean | null;
  ai_evaluation: string | null;
  ai_suggestions: string | null;
  ai_review_at: string | null;
  linked_task_id: string | null;
  created_at: string;
  updated_at: string;
};

function coercePinned(v: unknown): boolean {
  if (v === true || v === 1 || v === '1') return true;
  return false;
}

function newId(): string {
  return makeTimestampEntityId('', 9);
}

function clampTitle(t: string): string {
  return t.length > MEMO_TITLE_MAX ? t.slice(0, MEMO_TITLE_MAX) : t;
}

function clampBody(t: string): string {
  return t.length > MEMO_BODY_MAX ? t.slice(0, MEMO_BODY_MAX) : t;
}

function clampTagName(t: string): string {
  const x = t.trim();
  return x.length > 32 ? x.slice(0, 32) : x;
}

function rowToMemo(row: MemoRow): MemoItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    ...(coercePinned(row.is_pinned) ? { is_pinned: true } : {}),
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
      const is_pinned = coercePinned(r.is_pinned);
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
        ...(is_pinned ? { is_pinned: true } : {}),
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

async function importMemosToDb(db: SQLite.SQLiteDatabase, items: MemoItem[]): Promise<void> {
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.execAsync('BEGIN IMMEDIATE');
    await db.runAsync('DELETE FROM memos');
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO memos (
          id, title, body, dimension_id, dimension, is_pinned, ai_evaluation, ai_suggestions, ai_review_at, linked_task_id,
          created_at, updated_at, sync_status
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
        [
          item.id,
          clampTitle(item.title),
          clampBody(item.body),
          item.is_pinned ? 1 : 0,
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

async function listMemosFromDb(db: SQLite.SQLiteDatabase): Promise<MemoItem[]> {
  const rows = await db.getAllAsync<MemoRow>(
    `SELECT id, title, body, dimension_id, dimension,
       COALESCE(is_pinned, 0) AS is_pinned,
       ai_evaluation, ai_suggestions, ai_review_at, linked_task_id,
       created_at, updated_at
     FROM memos
     WHERE sync_status != 'pending_delete'
     ORDER BY COALESCE(is_pinned, 0) DESC, updated_at DESC`,
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
  await importMemosToDb(db, items);
}

/**
 * 列表/详情只读本地 SQLite。
 * 远端灌库由 fetchProfileMemoList（pages/profile/memo-list）负责。
 */
export async function listMemos(): Promise<MemoItem[]> {
  const db = await getDatabase();
  return listMemosFromDb(db);
}

export async function getMemo(id: string): Promise<MemoItem | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MemoRow>(
    `SELECT id, title, body, dimension_id, dimension,
       COALESCE(is_pinned, 0) AS is_pinned,
       ai_evaluation, ai_suggestions, ai_review_at, linked_task_id,
       created_at, updated_at
     FROM memos
     WHERE id = ? AND sync_status != 'pending_delete'
     LIMIT 1`,
    [id],
  );
  return row ? rowToMemo(row) : null;
}

export async function createMemo(input: {
  title: string;
  body: string;
  tagIds?: string[];
  is_pinned?: boolean;
}): Promise<MemoItem> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const pinned = Boolean(input.is_pinned);
  const item: MemoItem = {
    id: newId(),
    title: clampTitle(input.title),
    body: clampBody(input.body),
    ...(pinned ? { is_pinned: true } : {}),
    created_at: now,
    updated_at: now,
  };
  await db.runAsync(
    `INSERT INTO memos (
      id, title, body, dimension_id, dimension, is_pinned, ai_evaluation, ai_suggestions, ai_review_at, linked_task_id,
      created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, 'pending_create')`,
    [item.id, item.title, item.body, pinned ? 1 : 0, item.created_at, item.updated_at],
  );
  markMemosDirty();
  if (input.tagIds && input.tagIds.length > 0) {
    const { setMemoTagIds } = await import('@/lib/repositories/tags/tag');
    await setMemoTagIds(item.id, input.tagIds);
    markCloudSqliteTableDirty('tag_links');
  }
  return item;
}

export async function updateMemo(
  id: string,
  patch: { title?: string; body?: string; tagIds?: string[]; is_pinned?: boolean },
): Promise<MemoItem | null> {
  const row = await ensureLocalRowForWrite<MemoRow>('memos', id);
  const prev = row ? rowToMemo(row) : null;
  if (!prev) return null;
  const nextTitle = patch.title !== undefined ? clampTitle(patch.title) : prev.title;
  const nextBody = patch.body !== undefined ? clampBody(patch.body) : prev.body;
  const nextPinned = patch.is_pinned !== undefined ? Boolean(patch.is_pinned) : Boolean(prev.is_pinned);
  const contentChanged =
    (patch.title !== undefined && nextTitle !== prev.title) ||
    (patch.body !== undefined && nextBody !== prev.body);
  const updated_at = new Date().toISOString();
  const db = await getDatabase();
  if (contentChanged) {
    await db.runAsync(
      `UPDATE memos SET title = ?, body = ?, dimension_id = NULL, dimension = NULL, is_pinned = ?,
        ai_evaluation = NULL, ai_suggestions = NULL, ai_review_at = NULL,
        updated_at = ?,
        sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END WHERE id = ?`,
      [nextTitle, nextBody, nextPinned ? 1 : 0, updated_at, id],
    );
  } else {
    await db.runAsync(
      `UPDATE memos SET title = ?, body = ?, dimension_id = NULL, dimension = NULL, is_pinned = ?, updated_at = ?,
        sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [nextTitle, nextBody, nextPinned ? 1 : 0, updated_at, id],
    );
  }
  markMemosDirty();
  if (patch.tagIds !== undefined) {
    const { setMemoTagIds } = await import('@/lib/repositories/tags/tag');
    await setMemoTagIds(id, patch.tagIds);
    markCloudSqliteTableDirty('tag_links');
  }
  const next: MemoItem = {
    id: prev.id,
    title: nextTitle,
    body: nextBody,
    ...(nextPinned ? { is_pinned: true } : {}),
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

export async function setMemoPinned(id: string, pinned: boolean): Promise<MemoItem | null> {
  return updateMemo(id, { is_pinned: pinned });
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
  const row = await db.getFirstAsync<{ sync_status: string }>(
    'SELECT sync_status FROM memos WHERE id = ? LIMIT 1',
    [id],
  );
  if (!row) return false;
  try {
    const { softDeleteTagLinksForEntity } = await import('@/lib/repositories/tags/tag');
    await softDeleteTagLinksForEntity('memo', id);
    markCloudSqliteTableDirty('tag_links');
  } catch {
    /* ignore tag cleanup errors */
  }
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

/**
 * 将旧「维度」一次性迁成全局标签并挂到备忘上（幂等）。
 * 在 DROP memo_dimensions 前由 schema 升级调用。
 */
export async function migrateMemoDimensionsToTagsIfNeeded(db?: SQLite.SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  const flag = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    ['memo_dimensions_to_tags_v1'],
  );
  if (flag?.value === '1') return;

  const tableExists = await database.getFirstAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memo_dimensions' LIMIT 1`,
  );
  if (!tableExists) {
    await database.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
      'memo_dimensions_to_tags_v1',
      '1',
    ]);
    return;
  }

  const dims = await database.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM memo_dimensions WHERE sync_status != 'pending_delete'`,
  );
  if (!dims.length) {
    await database.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
      'memo_dimensions_to_tags_v1',
      '1',
    ]);
    return;
  }

  const { createTag, getMemoTags, setMemoTagIds, getTagIdsByEntity } = await import(
    '@/lib/repositories/tags/tag'
  );

  const existingTags = await getMemoTags();
  const tagIdByName = new Map(existingTags.map(t => [t.name.trim().toLowerCase(), t.id]));

  const dimToTag = new Map<string, string>();
  for (const dim of dims) {
    const name = clampTagName(dim.name);
    if (!name) continue;
    const key = name.toLowerCase();
    let tagId = tagIdByName.get(key);
    if (!tagId) {
      tagId = makeTimestampEntityId('ptag_', 8);
      await createTag({ id: tagId, name, color: '#64748B', domain: 'memo' });
      tagIdByName.set(key, tagId);
    }
    dimToTag.set(dim.id, tagId);
  }

  const memos = await database.getAllAsync<{ id: string; dimension_id: string | null }>(
    `SELECT id, dimension_id FROM memos WHERE sync_status != 'pending_delete'`,
  );
  for (const memo of memos) {
    const dimId = memo.dimension_id?.trim();
    if (!dimId) continue;
    const tagId = dimToTag.get(dimId);
    if (!tagId) continue;
    const existing = await getTagIdsByEntity('memo', memo.id);
    if (existing.includes(tagId)) continue;
    await setMemoTagIds(memo.id, [...existing, tagId]);
  }

  await database.runAsync(
    `UPDATE memos SET dimension_id = NULL, dimension = NULL WHERE dimension_id IS NOT NULL OR dimension IS NOT NULL`,
  );

  await database.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    'memo_dimensions_to_tags_v1',
    '1',
  ]);
  markCloudSqliteTableDirty('tags');
  markCloudSqliteTableDirty('tag_links');
  markMemosDirty();
}

export function sortMemos(items: MemoItem[], mode: MemoSortMode = 'updated'): MemoItem[] {
  const pinRank = (m: MemoItem) => (m.is_pinned ? 0 : 1);
  return [...items].sort((a, b) => {
    const pin = pinRank(a) - pinRank(b);
    if (pin !== 0) return pin;
    if (mode === 'title') {
      const ta = memoListPreviewTitle(a);
      const tb = memoListPreviewTitle(b);
      const c = ta.localeCompare(tb, 'zh-CN');
      if (c !== 0) return c;
      return b.updated_at.localeCompare(a.updated_at);
    }
    if (mode === 'created') {
      const c = b.created_at.localeCompare(a.created_at);
      if (c !== 0) return c;
      return b.updated_at.localeCompare(a.updated_at);
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export function memoMatchesSearch(item: MemoItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.title.toLowerCase().includes(q) || item.body.toLowerCase().includes(q);
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
