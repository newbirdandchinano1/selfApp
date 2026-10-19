import { getApiBaseUrl } from '@/lib/api-config';
import { apiRequest } from '@/lib/api/http';
import { File } from 'expo-file-system';

/** 统一图片库对外路径前缀，与后端 `IMAGES_PUBLIC_PREFIX` 一致。 */
export const STORED_IMAGE_URI_PREFIX = '/uploads/images/';

export type StoredImageRecord = {
  id: string;
  uri: string;
  mime: string;
  byte_size: number;
  purpose: string | null;
  owner_table: string | null;
  owner_id: string | null;
  owner_field: string | null;
};

export type UploadStoredImageInput = {
  /** data URL 或纯 base64 */
  data: string;
  mime?: string;
  purpose?: string;
  owner_table?: string;
  owner_id?: string;
  owner_field?: string;
};

export function isStoredImageUri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.trim().startsWith(STORED_IMAGE_URI_PREFIX);
}

export function storedImageIdFromUri(uri: string): string | null {
  const match = uri.trim().match(/^\/uploads\/images\/([0-9a-f-]{36})\.[a-z0-9]+$/i);
  return match?.[1] ?? null;
}

/** 展示用：`/uploads/...` 拼后端 origin；本地 file/content URI 原样返回。 */
export async function resolveStoredImageDisplayUri(
  uri: string | null | undefined,
): Promise<string | null> {
  const raw = uri?.trim();
  if (!raw) return null;
  if (!raw.startsWith('/uploads/')) return raw;
  const base = (await getApiBaseUrl()).replace(/\/$/, '');
  return `${base}${raw}`;
}

export async function uploadStoredImage(input: UploadStoredImageInput): Promise<StoredImageRecord> {
  return apiRequest<StoredImageRecord>('/api/app/images', {
    method: 'POST',
    body: input,
    skipGlobalLoading: true,
    perAttemptTimeoutMs: 60_000,
  });
}

export async function bindStoredImage(
  id: string,
  input: {
    purpose?: string;
    owner_table: string;
    owner_id: string;
    owner_field: string;
  },
): Promise<StoredImageRecord> {
  return apiRequest<StoredImageRecord>(`/api/app/images/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
    skipGlobalLoading: true,
  });
}

export async function deleteStoredImageById(id: string): Promise<void> {
  await apiRequest(`/api/app/images/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    skipGlobalLoading: true,
  });
}

/** 仅删除统一库路径；本地 file URI 忽略。 */
export async function deleteStoredImageByUri(uri: string | null | undefined): Promise<void> {
  if (!isStoredImageUri(uri)) return;
  const id = storedImageIdFromUri(uri);
  if (!id) return;
  await deleteStoredImageById(id);
}

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6) {
    const head = String.fromCharCode(...bytes.subarray(0, 6));
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('无法编码图片');
  }
  return globalThis.btoa(binary);
}

async function readImageBytes(uri: string): Promise<Uint8Array> {
  try {
    const file = new File(uri);
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('无法读取图片');
    return new Uint8Array(await res.arrayBuffer());
  }
}

/**
 * 把相册 / 本地临时文件读成 data URL，供 `POST /api/app/images`。
 * 已是 `/uploads/images/` 或 http(s) 的路径不在这里处理。
 */
export async function readLocalImageDataUrl(uri: string): Promise<string> {
  const raw = uri.trim();
  if (raw.toLowerCase().startsWith('data:')) return raw;
  const bytes = await readImageBytes(raw);
  if (bytes.byteLength === 0) throw new Error('图片是空的');
  const mime = sniffImageMime(bytes);
  if (!mime) throw new Error('只接受 jpg、png、webp、gif');
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
