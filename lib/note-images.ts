import { NOTE_IMAGE_MAX_COUNT } from '@/lib/note-image-extra';
import {
  bindStoredImage,
  deleteStoredImageByUri,
  isStoredImageUri,
  readLocalImageDataUrl,
  resolveStoredImageDisplayUri,
  storedImageIdFromUri,
  uploadStoredImage,
} from '@/lib/stored-images';
import * as ImagePicker from 'expo-image-picker';

export type NoteImageOwner = {
  table: 'tasks' | 'projects';
  id?: string | null;
};

const PURPOSE_BY_TABLE: Record<NoteImageOwner['table'], string> = {
  tasks: 'task-note',
  projects: 'project-note',
};

const OWNER_FIELD = 'note_image_uris';

export type PickNoteImagesResult =
  | { ok: true; uris: string[] }
  | { ok: false; reason: 'permission' | 'canceled' };

/** 从相册选若干张备注附图（受剩余名额限制）。 */
export async function pickNoteImagesFromLibrary(
  remainingSlots: number = NOTE_IMAGE_MAX_COUNT,
): Promise<PickNoteImagesResult> {
  const limit = Math.max(0, Math.min(NOTE_IMAGE_MAX_COUNT, Math.floor(remainingSlots)));
  if (limit <= 0) return { ok: false, reason: 'canceled' };

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'permission' };

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.85,
    allowsMultipleSelection: true,
    selectionLimit: limit,
  });
  if (picked.canceled || !picked.assets?.length) return { ok: false, reason: 'canceled' };

  const uris: string[] = [];
  const seen = new Set<string>();
  for (const asset of picked.assets) {
    const uri = asset?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    uris.push(uri);
    if (uris.length >= limit) break;
  }
  if (uris.length === 0) return { ok: false, reason: 'canceled' };
  return { ok: true, uris };
}

function isRemoteOrStored(uri: string): boolean {
  const t = uri.trim();
  return isStoredImageUri(t) || t.startsWith('/uploads/') || /^https?:\/\//i.test(t);
}

/** 本地临时图 → 统一图片库；已是库路径则原样返回。 */
export async function ensureNoteImageRemote(input: {
  localUri: string;
  owner: NoteImageOwner;
}): Promise<string> {
  const raw = input.localUri.trim();
  if (!raw) throw new Error('图片路径为空');
  if (isRemoteOrStored(raw)) return raw;

  const data = await readLocalImageDataUrl(raw);
  const ownerId = input.owner.id?.trim() || '';
  const purpose = PURPOSE_BY_TABLE[input.owner.table];
  const saved = await uploadStoredImage({
    data,
    purpose,
    ...(ownerId
      ? {
          owner_table: input.owner.table,
          owner_id: ownerId,
          owner_field: OWNER_FIELD,
        }
      : {}),
  });
  return saved.uri;
}

export async function ensureNoteImagesRemote(input: {
  localUris: string[];
  owner: NoteImageOwner;
}): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const localUri of input.localUris) {
    const remote = await ensureNoteImageRemote({
      localUri,
      owner: input.owner,
    });
    if (!remote || seen.has(remote)) continue;
    seen.add(remote);
    out.push(remote);
    if (out.length >= NOTE_IMAGE_MAX_COUNT) break;
  }
  return out;
}

export async function bindNoteImages(
  owner: NoteImageOwner & { id: string },
  uris: string[] | null | undefined,
): Promise<void> {
  for (const uri of uris ?? []) {
    const imageId = storedImageIdFromUri(uri);
    if (!imageId) continue;
    await bindStoredImage(imageId, {
      purpose: PURPOSE_BY_TABLE[owner.table],
      owner_table: owner.table,
      owner_id: owner.id,
      owner_field: OWNER_FIELD,
    }).catch(() => undefined);
  }
}

/** 列表里去掉的统一库图片，删登记和文件。 */
export async function releaseRemovedNoteImages(
  previousUris: string[] | null | undefined,
  nextUris: string[] | null | undefined,
): Promise<void> {
  const next = new Set((nextUris ?? []).map((u) => u.trim()).filter(Boolean));
  for (const uri of previousUris ?? []) {
    const prev = uri.trim();
    if (prev && !next.has(prev)) {
      await deleteStoredImageByUri(prev).catch(() => undefined);
    }
  }
}

export { resolveStoredImageDisplayUri };
