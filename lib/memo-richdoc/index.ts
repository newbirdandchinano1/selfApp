/**
 * 备忘录 RichDoc 权威层（APP）。
 * 桌面镜像：`selfAPP_destop/.../shared/domain/memo-richdoc/` — 改一处必须同步另一处。
 */
export {
  MEMO_BODY_MAX_BYTES,
  RICH_DOC_FORMAT,
  RICH_DOC_VERSION,
  RICH_MARKS,
  type ListItem,
  type MemoRichDoc,
  type RichBlock,
  type RichMark,
  type RichTextRun,
} from './types';

export { normalizeBlock } from './normalize';
export { emptyRichDoc, legacyMarkupToRichDoc, parseInlineRuns } from './legacy';
export { isRichDocString, parseMemoBody } from './parse';
export { serializeRichDoc } from './serialize';
export { plainTextFromBody, plainTextFromRichDoc } from './plain-text';
export { assertMemoBodyOrThrow, byteLengthUtf8, validateMemoBody } from './validate';
export { migrateRichDoc } from './migrate';
export {
  editModelToRichDoc,
  richDocToEditModel,
  serializeEditModelToBody,
  type BridgeCharStyle,
  type BridgeEditModel,
} from './edit-bridge';
