import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { makeTimestampEntityId } from '@/lib/entity-id';
import { readLocalRowForWrite } from '@/lib/api-local-row';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import type { PageApiReadOpts } from '@/lib/page-api-session';
import { sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import {
  parseWishItemExtra,
  serializeWishItemExtra,
  type WishItemExtraPayload,
} from './wish-list-extra';
import type { CreateWishItemInput, UpdateWishItemInput, WishItemRow } from './wish-list.types';

export function createWishItemId(): string {
  return makeTimestampEntityId('wish:', 9);
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
    throw new Error('心动等级须在 1～5');
  }
}

export async function createWishItem(input: CreateWishItemInput) {
  assertWishItemPayload(input);
  const db = await getDatabase();
  const id = input.id?.trim() || createWishItemId();
  const refUri = await persistWishReferenceImage(input.reference_image_uri);

  await db.runAsync(
    `INSERT INTO wish_items (
      id, name, price, category_id, category_label, desire_level, reason, reference_image_uri,
      extra_data, created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create')`,
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
  return readApiRecord<WishItemRow>('wish_items', id, { offlineFallback: true });
}

export async function listWishItems(opts?: PageApiReadOpts) {
  const rows = await readApiTable<WishItemRow>('wish_items', {
    offlineFallback: true,
    localOnly: opts?.localOnly,
  });
  return sortByUpdatedDesc(rows);
}

export async function updateWishItem(id: string, input: UpdateWishItemInput) {
  const db = await getDatabase();
  const current = await readLocalRowForWrite<WishItemRow>('wish_items', id);
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
    throw new Error('心动等级须在 1～5');
  }

  await db.runAsync(
    `UPDATE wish_items SET
      name = ?, price = ?, category_id = ?, category_label = ?, desire_level = ?, reason = ?, reference_image_uri = ?, extra_data = ?,
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
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
      updated_at = datetime('now'),
      sync_status = 'pending_delete'
    WHERE id = ?`,
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
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
    WHERE id = ?`,
    [id]
  );
}

/** 写入单条 AI 评价（不修改 updated_at，避免触发「需重新生成」的误判）。 */
/** 标记心愿已实现或未实现（写入 extra_data.fulfilled_at） */
export async function setWishItemFulfilled(id: string, fulfilled: boolean) {
  const current = await readLocalRowForWrite<WishItemRow>('wish_items', id);
  if (!current) return;
  const extra: WishItemExtraPayload = parseWishItemExtra(current.extra_data) ?? {};
  if (fulfilled) {
    extra.fulfilled_at = new Date().toISOString();
  } else {
    delete extra.fulfilled_at;
  }
  await updateWishItem(id, { extra_data: serializeWishItemExtra(extra) });
}

export async function patchWishItemAiReview(id: string, ai_comment: string) {
  const db = await getDatabase();
  const trimmed = ai_comment.trim();
  if (!trimmed) return;
  await db.runAsync(
    `UPDATE wish_items SET
      ai_comment = ?,
      ai_review_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
    WHERE id = ?`,
    [trimmed, id]
  );
}
