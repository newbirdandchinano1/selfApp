import { isStoredImageUri } from '@/lib/stored-images';

/** 与备忘编辑模型一致的图片行：`![img](/uploads/images/....)` */
const IMAGE_LINE_RE = /^!\[img\]\((.+)\)$/i;

export const WISH_DESCRIPTION_TEXT_MAX = 500;
export const WISH_DESCRIPTION_TOTAL_MAX = 8000;
export const WISH_DESCRIPTION_IMAGE_MAX = 6;

export type WishDescriptionParts = {
  text: string;
  imageUris: string[];
};

export function parseWishDescription(raw: string | null | undefined): WishDescriptionParts {
  const source = raw ?? '';
  if (!source.trim()) return { text: '', imageUris: [] };

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const textLines: string[] = [];
  const imageUris: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(IMAGE_LINE_RE);
    if (match) {
      const uri = match[1]!.trim();
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        imageUris.push(uri);
      }
      continue;
    }
    textLines.push(line);
  }

  // 去掉文末因拆图片行留下的空行
  while (textLines.length > 0 && textLines[textLines.length - 1]!.trim() === '') {
    textLines.pop();
  }

  return { text: textLines.join('\n'), imageUris };
}

export function serializeWishDescription(parts: WishDescriptionParts): string | null {
  const text = parts.text.replace(/\s+$/u, '');
  const images = parts.imageUris
    .map((u) => u.trim())
    .filter((u) => u.length > 0 && !/^data:/i.test(u));
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const uri of images) {
    if (seen.has(uri)) continue;
    seen.add(uri);
    unique.push(uri);
  }

  const chunks: string[] = [];
  if (text) chunks.push(text);
  for (const uri of unique) {
    chunks.push(`![img](${uri})`);
  }
  const out = chunks.join('\n').trim();
  return out || null;
}

/** 列表预览：只保留可见文字，图片用占位。 */
export function wishDescriptionPreview(raw: string | null | undefined): string {
  const { text, imageUris } = parseWishDescription(raw);
  const t = text.trim();
  if (t && imageUris.length > 0) return `${t} · [${imageUris.length} 图]`;
  if (t) return t;
  if (imageUris.length > 0) return `[${imageUris.length} 张图片]`;
  return '';
}

export function collectWishStoredImageUris(raw: string | null | undefined): string[] {
  const { imageUris } = parseWishDescription(raw);
  return imageUris.filter((uri) => isStoredImageUri(uri));
}

export function assertWishDescriptionParts(parts: WishDescriptionParts): void {
  if ([...parts.text].length > WISH_DESCRIPTION_TEXT_MAX) {
    throw new Error(`描述文字最多 ${WISH_DESCRIPTION_TEXT_MAX} 字`);
  }
  if (parts.imageUris.length > WISH_DESCRIPTION_IMAGE_MAX) {
    throw new Error(`描述最多插入 ${WISH_DESCRIPTION_IMAGE_MAX} 张图片`);
  }
  const serialized = serializeWishDescription(parts);
  if (serialized && [...serialized].length > WISH_DESCRIPTION_TOTAL_MAX) {
    throw new Error('描述内容过长');
  }
}
