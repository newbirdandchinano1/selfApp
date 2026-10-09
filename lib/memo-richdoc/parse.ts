import { legacyMarkupToRichDoc } from './legacy';
import { normalizeBlock } from './normalize';
import { RICH_DOC_FORMAT, type MemoRichDoc } from './types';

export function isRichDocString(body: string): boolean {
  if (!body || body.trimStart()[0] !== '{') return false;
  try {
    const o = JSON.parse(body) as Record<string, unknown>;
    return o.format === RICH_DOC_FORMAT && typeof o.v === 'number';
  } catch {
    return false;
  }
}

/**
 * string → RichDoc。
 * trimStart 以 `{` 且 format=selfapp-richdoc → 按 RichDoc 读（未知节点 normalize 降级）；
 * 否则走 legacy markup。
 */
export function parseMemoBody(body: string): MemoRichDoc {
  if (typeof body !== 'string') return legacyMarkupToRichDoc('');
  if (body.trimStart()[0] === '{') {
    try {
      const o = JSON.parse(body) as Record<string, unknown>;
      if (
        o.format === RICH_DOC_FORMAT &&
        typeof o.v === 'number' &&
        o.doc &&
        typeof o.doc === 'object'
      ) {
        const rawBlocks = (o.doc as Record<string, unknown>).blocks;
        const blocks = Array.isArray(rawBlocks)
          ? (rawBlocks as unknown[]).slice(0, 2000).map(normalizeBlock)
          : [];
        return {
          v: o.v,
          format: RICH_DOC_FORMAT,
          doc: {
            blocks: blocks.length
              ? blocks
              : [{ type: 'paragraph', runs: [{ text: '', marks: [] }] }],
          },
        };
      }
    } catch {
      /* fall to legacy */
    }
  }
  return legacyMarkupToRichDoc(body);
}
