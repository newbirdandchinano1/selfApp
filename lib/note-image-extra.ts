/** 项目 / 任务备注附图：优先 `extra_data.note_image_uris`，兼容旧版单图 `note_image_uri`。 */

export const NOTE_IMAGE_MAX_COUNT = 9;

function normalizeUriList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const uri = item.trim();
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      out.push(uri);
      if (out.length >= NOTE_IMAGE_MAX_COUNT) break;
    }
    return out;
  }
  if (typeof raw === 'string') {
    const uri = raw.trim();
    return uri ? [uri] : [];
  }
  return [];
}

export function parseNoteImageUris(extraData: string | null | undefined): string[] {
  if (!extraData?.trim()) return [];
  try {
    const parsed = JSON.parse(extraData) as {
      note_image_uris?: unknown;
      note_image_uri?: unknown;
    };
    const fromList = normalizeUriList(parsed.note_image_uris);
    if (fromList.length > 0) return fromList;
    return normalizeUriList(parsed.note_image_uri);
  } catch {
    return [];
  }
}

export function parseNoteImageUrisFromObject(
  extra: Record<string, unknown> | null | undefined,
): string[] {
  if (!extra) return [];
  const fromList = normalizeUriList(extra.note_image_uris);
  if (fromList.length > 0) return fromList;
  return normalizeUriList(extra.note_image_uri);
}

export function noteImageUrisEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 写入或清除备注图列表；空数组会删掉新旧字段。 */
export function mergeNoteImageUrisIntoExtraData(
  extraData: string | null | undefined,
  noteImageUris: string[] | null | undefined,
): string | null {
  let base: Record<string, unknown> = {};
  if (extraData?.trim()) {
    try {
      const parsed = JSON.parse(extraData) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      base = {};
    }
  }
  const next = mergeNoteImageUrisIntoExtraObject(base, noteImageUris);
  return Object.keys(next).length > 0 ? JSON.stringify(next) : null;
}

export function mergeNoteImageUrisIntoExtraObject<T extends Record<string, unknown>>(
  extra: T,
  noteImageUris: string[] | null | undefined,
): T {
  const next = { ...extra } as Record<string, unknown>;
  const list = normalizeUriList(noteImageUris ?? []);
  delete next.note_image_uri;
  if (list.length > 0) next.note_image_uris = list;
  else delete next.note_image_uris;
  return next as T;
}
