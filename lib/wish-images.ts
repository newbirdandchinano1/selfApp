import {
  collectWishStoredImageUris,
} from '@/lib/wish-description';
import {
  bindStoredImage,
  deleteStoredImageByUri,
  readLocalImageDataUrl,
  storedImageIdFromUri,
  uploadStoredImage,
} from '@/lib/stored-images';

const PURPOSE = 'wish-board';
const OWNER_TABLE = 'wish_board_items';
const OWNER_FIELD = 'description';

/** 把描述里的统一库图片绑到这条心愿。业务行可以后创建，这里补绑定。 */
export async function bindWishDescriptionImages(
  wishId: string,
  description: string | null | undefined,
): Promise<void> {
  const id = wishId.trim();
  if (!id) return;
  for (const uri of collectWishStoredImageUris(description)) {
    const imageId = storedImageIdFromUri(uri);
    if (!imageId) continue;
    await bindStoredImage(imageId, {
      purpose: PURPOSE,
      owner_table: OWNER_TABLE,
      owner_id: id,
      owner_field: OWNER_FIELD,
    }).catch(() => undefined);
  }
}

/** 描述里去掉的统一库图片，删登记和文件。 */
export async function releaseRemovedWishImages(
  previousDescription: string | null | undefined,
  nextDescription: string | null | undefined,
): Promise<void> {
  const next = new Set(collectWishStoredImageUris(nextDescription));
  for (const uri of collectWishStoredImageUris(previousDescription)) {
    if (!next.has(uri)) await deleteStoredImageByUri(uri).catch(() => undefined);
  }
}

export async function releaseWishDescriptionImages(
  description: string | null | undefined,
): Promise<void> {
  for (const uri of collectWishStoredImageUris(description)) {
    await deleteStoredImageByUri(uri).catch(() => undefined);
  }
}

/** 这次编辑上传过、但最终描述没引用的图，避免取消插入后留下文件。 */
export async function forgetUnusedWishUploads(
  uploadedUris: string[],
  description: string | null | undefined,
): Promise<void> {
  const keep = new Set(collectWishStoredImageUris(description));
  for (const uri of uploadedUris) {
    if (!keep.has(uri)) await deleteStoredImageByUri(uri).catch(() => undefined);
  }
}

/** 相册 / 本地文件 → 统一图片库。新建心愿还没有 id 时先不绑。 */
export async function uploadWishImage(input: {
  localUri: string;
  wishId?: string | null;
}): Promise<{ id: string; uri: string }> {
  const data = await readLocalImageDataUrl(input.localUri);
  const wishId = input.wishId?.trim() || '';
  const saved = await uploadStoredImage({
    data,
    purpose: PURPOSE,
    ...(wishId
      ? { owner_table: OWNER_TABLE, owner_id: wishId, owner_field: OWNER_FIELD }
      : {}),
  });
  return { id: saved.id, uri: saved.uri };
}
