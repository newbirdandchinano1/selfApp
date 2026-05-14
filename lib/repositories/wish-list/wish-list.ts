import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { getDatabase } from '../../database.native';
import type { CreateWishItemInput, UpdateWishItemInput, WishItemRow } from './wish-list.types';

export function createWishItemId(): string {
  return `wish:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 11)}`;
}

/** 将相册临时文件复制到应用文档目录，避免系统清理后丢失（expo-file-system 新版 API） */
export async function persistWishReferenceImage(sourceUri: string | null): Promise<string | null> {
  if (!sourceUri) return null;
  if (Platform.OS === 'web') {
    return sourceUri;
  }

  try {
    const doc = Paths.document;
    const docUri = doc.uri;
    if (!docUri) return sourceUri;

    const docPrefix = docUri.endsWith('/') ? docUri : `${docUri}/`;
    if (sourceUri.startsWith(docPrefix) && sourceUri.includes('wish_refs')) {
      return sourceUri;
    }

    const wishDir = new Directory(doc, 'wish_refs');
    wishDir.create({ idempotent: true, intermediates: true });

    const safeExt =
      sourceUri.match(/\.([a-zA-Z0-9]{1,8})(?:\?|$)/)?.[1]?.toLowerCase() ?? 'jpg';
    const dest = new File(
      wishDir,
      `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`,
    );
    const src = new File(sourceUri);
    src.copy(dest);
    return dest.uri;
  } catch {
    return sourceUri;
  }
}

function assertWishItemPayload(input: CreateWishItemInput) {
  const name = input.name.trim();
  if (!name) {
    throw new Error('请输入好物名称');
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error('预估价格无效');
  }
  const lv = Math.round(input.desire_level);
  if (lv < 1 || lv > 5) {
    throw new Error('欲望等级须在 1～5');
  }
}

export async function createWishItem(input: CreateWishItemInput) {
  assertWishItemPayload(input);
  const db = await getDatabase();
  const id = createWishItemId();
  const refUri = await persistWishReferenceImage(input.reference_image_uri);

  await db.runAsync(
    `INSERT INTO wish_items (
      id, name, price, category_id, category_label, desire_level, reason, reference_image_uri,
      extra_data, created_at, updated_at, deleted_at, sync_status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1)`,
    [
      id,
      input.name.trim(),
      input.price,
      input.category_id,
      input.category_label,
      Math.round(input.desire_level),
      input.reason?.trim() ?? null,
      refUri,
      input.extra_data ?? null,
    ]
  );
  return id;
}

export async function getWishItemById(id: string) {
  const db = await getDatabase();
  return db.getFirstAsync<WishItemRow>(
    'SELECT * FROM wish_items WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id]
  );
}

export async function listWishItems() {
  const db = await getDatabase();
  return db.getAllAsync<WishItemRow>(
    `SELECT * FROM wish_items
     WHERE deleted_at IS NULL
     ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC`
  );
}

export async function updateWishItem(id: string, input: UpdateWishItemInput) {
  const db = await getDatabase();
  const current = await getWishItemById(id);
  if (!current) return;

  let refUri: string | null;
  if (input.reference_image_uri === undefined) {
    refUri = current.reference_image_uri;
  } else if (input.reference_image_uri === null) {
    refUri = null;
  } else {
    refUri = await persistWishReferenceImage(input.reference_image_uri);
  }

  const name = input.name !== undefined ? input.name.trim() : current.name;
  if (!name) {
    throw new Error('请输入好物名称');
  }
  const price = input.price ?? current.price;
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('预估价格无效');
  }
  const desire_level = input.desire_level ?? current.desire_level;
  const lv = Math.round(desire_level);
  if (lv < 1 || lv > 5) {
    throw new Error('欲望等级须在 1～5');
  }

  await db.runAsync(
    `UPDATE wish_items SET
      name = ?, price = ?, category_id = ?, category_label = ?, desire_level = ?, reason = ?, reference_image_uri = ?, extra_data = ?,
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
      version = version + 1
    WHERE id = ?`,
    [
      name,
      price,
      input.category_id !== undefined ? input.category_id : current.category_id,
      input.category_label !== undefined ? input.category_label : current.category_label,
      lv,
      input.reason !== undefined ? input.reason?.trim() ?? null : current.reason,
      refUri,
      input.extra_data !== undefined ? input.extra_data : current.extra_data,
      id,
    ]
  );
}

export async function deleteWishItem(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE wish_items SET
      deleted_at = datetime('now'),
      updated_at = datetime('now'),
      sync_status = 'pending_delete',
      version = version + 1
    WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
}

/** 清空单条 AI 评价（不修改 updated_at；用于编辑保存后等待重新生成）。 */
export async function clearWishItemAiReview(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE wish_items SET
      ai_comment = NULL,
      ai_review_at = NULL,
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
      version = version + 1
    WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
}

/** 写入单条 AI 评价（不修改 updated_at，避免触发「需重新生成」的误判）。 */
export async function patchWishItemAiReview(id: string, ai_comment: string) {
  const db = await getDatabase();
  const trimmed = ai_comment.trim();
  if (!trimmed) return;
  await db.runAsync(
    `UPDATE wish_items SET
      ai_comment = ?,
      ai_review_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
      version = version + 1
    WHERE id = ? AND deleted_at IS NULL`,
    [trimmed, id]
  );
}
