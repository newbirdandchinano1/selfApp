import { RICH_DOC_VERSION, type MemoRichDoc } from './types';

/**
 * 版本升级预留。当前仅 v1，原样返回（并钳制 format/v）。
 */
export function migrateRichDoc(doc: MemoRichDoc): MemoRichDoc {
  if (doc.v === RICH_DOC_VERSION) return doc;
  // 未来：v1 → v2 在此转换
  return {
    ...doc,
    v: RICH_DOC_VERSION,
    format: 'selfapp-richdoc',
  };
}
