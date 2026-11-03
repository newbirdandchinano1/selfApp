import {
  bindStoredImage,
  deleteStoredImageByUri,
  isStoredImageUri,
  readLocalImageDataUrl,
  storedImageIdFromUri,
  uploadStoredImage,
} from '@/lib/stored-images';
import * as ImagePicker from 'expo-image-picker';
import { cutOutPerson, isVisionCutoutAvailable } from 'zheng-vision-cutout';

const PURPOSE = 'wardrobe-item';
const OWNER_TABLE = 'wardrobe_items';

export type WardrobeImageSource = 'camera' | 'library';

export type PreparedWardrobeImages = {
  /** 原图本地 URI（file:// / content://） */
  imageUri: string;
  /** Vision 抠图透明 PNG（若成功） */
  cutoutUri?: string;
  cutoutApplied: boolean;
};

const PICKER_OPTS = {
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: false,
  quality: 0.9,
} as const;

export type PickWardrobeImageResult =
  | { ok: true; uri: string }
  | { ok: false; reason: 'permission' | 'canceled' };

/** 拍照或从相册选一张本地图。 */
export async function pickWardrobeLocalImage(
  source: WardrobeImageSource,
): Promise<PickWardrobeImageResult> {
  if (source === 'library') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'permission' };
    const picked = await ImagePicker.launchImageLibraryAsync(PICKER_OPTS);
    if (picked.canceled || !picked.assets?.[0]?.uri) return { ok: false, reason: 'canceled' };
    return { ok: true, uri: picked.assets[0].uri };
  }

  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'permission' };
  const shot = await ImagePicker.launchCameraAsync(PICKER_OPTS);
  if (shot.canceled || !shot.assets?.[0]?.uri) return { ok: false, reason: 'canceled' };
  return { ok: true, uri: shot.assets[0].uri };
}

/**
 * 对本地图尝试 Vision 人像抠图。
 * 模块不可用 / 非 iOS 实机 / 失败时只保留原图，不抛错。
 */
export async function prepareWardrobeImagesFromLocal(
  localUri: string,
): Promise<PreparedWardrobeImages> {
  const imageUri = localUri.trim();
  if (!imageUri) {
    throw new Error('图片路径为空');
  }

  const available = await isVisionCutoutAvailable();
  if (!available) {
    return { imageUri, cutoutApplied: false };
  }

  try {
    const { uri } = await cutOutPerson(imageUri, { quality: 'accurate' });
    const cutoutUri = uri.trim();
    if (!cutoutUri) return { imageUri, cutoutApplied: false };
    return { imageUri, cutoutUri, cutoutApplied: true };
  } catch {
    return { imageUri, cutoutApplied: false };
  }
}

type WardrobeImageField = 'image_uri' | 'cutout_uri' | 'note_image_uri';

function isRemoteOrStored(uri: string): boolean {
  const t = uri.trim();
  return isStoredImageUri(t) || t.startsWith('/uploads/') || /^https?:\/\//i.test(t);
}

/** 本地临时图 → 统一图片库；已是库路径则原样返回。 */
export async function uploadWardrobeOwnedImage(input: {
  localUri: string;
  itemId?: string | null;
  field: WardrobeImageField;
}): Promise<string> {
  const raw = input.localUri.trim();
  if (!raw) throw new Error('图片路径为空');
  if (isRemoteOrStored(raw)) return raw;

  const data = await readLocalImageDataUrl(raw);
  const itemId = input.itemId?.trim() || '';
  const saved = await uploadStoredImage({
    data,
    purpose: PURPOSE,
    ...(itemId
      ? {
          owner_table: OWNER_TABLE,
          owner_id: itemId,
          owner_field: input.field,
        }
      : {}),
  });
  return saved.uri;
}

export async function bindWardrobeItemImages(
  itemId: string,
  uris: { image_uri?: string; cutout_uri?: string; note_image_uri?: string },
): Promise<void> {
  const id = itemId.trim();
  if (!id) return;

  const pairs: { field: WardrobeImageField; uri?: string }[] = [
    { field: 'image_uri', uri: uris.image_uri },
    { field: 'cutout_uri', uri: uris.cutout_uri },
    { field: 'note_image_uri', uri: uris.note_image_uri },
  ];

  for (const { field, uri } of pairs) {
    const imageId = uri ? storedImageIdFromUri(uri) : null;
    if (!imageId) continue;
    await bindStoredImage(imageId, {
      purpose: PURPOSE,
      owner_table: OWNER_TABLE,
      owner_id: id,
      owner_field: field,
    }).catch(() => undefined);
  }
}

/** 换图后释放旧的统一库文件（本地 file URI 忽略）。 */
export async function releaseReplacedWardrobeImages(
  previous: { image_uri?: string; cutout_uri?: string; note_image_uri?: string },
  next: { image_uri?: string; cutout_uri?: string; note_image_uri?: string },
): Promise<void> {
  const keys: (keyof typeof previous)[] = ['image_uri', 'cutout_uri', 'note_image_uri'];
  for (const key of keys) {
    const prev = previous[key]?.trim();
    const cur = next[key]?.trim();
    if (prev && prev !== cur) {
      await deleteStoredImageByUri(prev).catch(() => undefined);
    }
  }
}

/**
 * 把表单里的本地 URI 全部升到统一库；已是远程路径则跳过。
 * 新建时尚无 itemId，上传后由 `bindWardrobeItemImages` 补绑定。
 */
export async function ensureWardrobeItemRemoteImages(input: {
  itemId?: string | null;
  image_uri?: string;
  cutout_uri?: string;
  note_image_uri?: string;
}): Promise<{ image_uri?: string; cutout_uri?: string; note_image_uri?: string }> {
  const itemId = input.itemId?.trim() || '';
  const out: { image_uri?: string; cutout_uri?: string; note_image_uri?: string } = {};

  if (input.image_uri?.trim()) {
    out.image_uri = await uploadWardrobeOwnedImage({
      localUri: input.image_uri,
      itemId,
      field: 'image_uri',
    });
  }
  if (input.cutout_uri?.trim()) {
    out.cutout_uri = await uploadWardrobeOwnedImage({
      localUri: input.cutout_uri,
      itemId,
      field: 'cutout_uri',
    });
  }
  if (input.note_image_uri?.trim()) {
    out.note_image_uri = await uploadWardrobeOwnedImage({
      localUri: input.note_image_uri,
      itemId,
      field: 'note_image_uri',
    });
  }

  return out;
}
