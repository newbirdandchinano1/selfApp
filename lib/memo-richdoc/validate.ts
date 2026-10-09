import { RICH_DOC_FORMAT, MEMO_BODY_MAX_BYTES } from './types';

export function byteLengthUtf8(s: string): number {
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  } catch {
    /* fallback */
  }
  let len = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        len += 4;
        i++;
        continue;
      }
    }
    if (c < 0x80) len += 1;
    else if (c < 0x800) len += 2;
    else len += 3;
  }
  return len;
}

/** 形态 + 字节上限。旧 markup 允许；RichDoc 须合法；禁止 image data-URL。 */
export function validateMemoBody(body: string): { ok: true } | { ok: false; message: string } {
  if (typeof body !== 'string') return { ok: false, message: '正文必须是字符串' };
  if (byteLengthUtf8(body) > MEMO_BODY_MAX_BYTES) {
    return {
      ok: false,
      message: `正文超过上限（${MEMO_BODY_MAX_BYTES / 1024}KB），请删减后保存`,
    };
  }
  if (body.trimStart()[0] === '{') {
    let o: unknown;
    try {
      o = JSON.parse(body);
    } catch {
      return { ok: false, message: '富文本格式损坏，请清空后重试' };
    }
    const r = (o ?? {}) as Record<string, unknown>;
    if (r.format !== RICH_DOC_FORMAT) return { ok: true };
    if (typeof r.v !== 'number' || !r.doc || typeof r.doc !== 'object') {
      return { ok: false, message: '富文本版本号异常' };
    }
    const blocks = (r.doc as Record<string, unknown>).blocks;
    if (!Array.isArray(blocks)) return { ok: false, message: '富文本文档结构异常' };
    for (const b of blocks) {
      const bb = (b ?? {}) as Record<string, unknown>;
      if (bb.type === 'image' && typeof bb.uri === 'string' && /^data:/i.test(bb.uri.trim())) {
        return { ok: false, message: '图片请使用链接，禁止 base64 直存' };
      }
    }
  }
  return { ok: true };
}

export function assertMemoBodyOrThrow(body: string): void {
  const r = validateMemoBody(body);
  if (!r.ok) throw new Error(r.message);
}
