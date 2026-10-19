import { parseMemoBody } from '@/lib/memo-richdoc';
import {
  bindStoredImage,
  deleteStoredImageByUri,
  isStoredImageUri,
  readLocalImageDataUrl,
  storedImageIdFromUri,
  uploadStoredImage,
} from '@/lib/stored-images';

/** 正文里已落到统一图片库的路径。 */
export function collectMemoStoredImageUris(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const block of parseMemoBody(body).doc.blocks) {
    if (block.type !== 'image') continue;
    const uri = block.uri.trim();
    if (!isStoredImageUri(uri) || seen.has(uri)) continue;
    seen.add(uri);
    out.push(uri);
  }
  return out;
}

/** 把正文里的统一库图片绑到这条备忘。业务行可以后创建，这里补绑定。 */
export async function bindMemoBodyImages(memoId: string, body: string): Promise<void> {
  const id = memoId.trim();
  if (!id) return;
  for (const uri of collectMemoStoredImageUris(body)) {
    const imageId = storedImageIdFromUri(uri);
    if (!imageId) continue;
    await bindStoredImage(imageId, {
      purpose: 'memo',
      owner_table: 'memos',
      owner_id: id,
      owner_field: 'body',
    }).catch(() => undefined);
  }
}

/** 正文里去掉的统一库图片，删登记和文件。 */
export async function releaseRemovedMemoImages(previousBody: string, nextBody: string): Promise<void> {
  const next = new Set(collectMemoStoredImageUris(nextBody));
  for (const uri of collectMemoStoredImageUris(previousBody)) {
    if (!next.has(uri)) await deleteStoredImageByUri(uri).catch(() => undefined);
  }
}

export async function releaseMemoBodyImages(body: string): Promise<void> {
  for (const uri of collectMemoStoredImageUris(body)) {
    await deleteStoredImageByUri(uri).catch(() => undefined);
  }
}

/** 这次编辑上传过、但最终正文没引用的图，避免取消插入后留下文件。 */
export async function forgetUnusedMemoUploads(uploadedUris: string[], body: string): Promise<void> {
  const keep = new Set(collectMemoStoredImageUris(body));
  for (const uri of uploadedUris) {
    if (!keep.has(uri)) await deleteStoredImageByUri(uri).catch(() => undefined);
  }
}

/** 相册 / 本地文件 → 统一图片库。新建备忘还没有 id 时先不绑。 */
export async function uploadMemoImage(input: {
  localUri: string;
  memoId?: string | null;
}): Promise<{ id: string; uri: string }> {
  const data = await readLocalImageDataUrl(input.localUri);
  const memoId = input.memoId?.trim() || '';
  const saved = await uploadStoredImage({
    data,
    purpose: 'memo',
    ...(memoId
      ? { owner_table: 'memos', owner_id: memoId, owner_field: 'body' }
      : {}),
  });
  return { id: saved.id, uri: saved.uri };
}
