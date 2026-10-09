/** RichDoc 契约（selfapp-richdoc v1）。改此文件须同步桌面 `shared/domain/memo-richdoc/`。 */

export const RICH_DOC_FORMAT = 'selfapp-richdoc' as const;
export const RICH_DOC_VERSION = 1 as const;
/** 与后端 / 桌面一致：512KB UTF-8 */
export const MEMO_BODY_MAX_BYTES = 524288;

/** 首批 marks；新增须升 v 或兼容表 */
export type RichMark = 'bold' | 'italic' | 'strike';

export type RichTextRun = {
  text: string;
  marks: RichMark[];
};

export type ListItem = {
  indent: number;
  runs: RichTextRun[];
};

export type RichBlock =
  | { type: 'paragraph'; runs: RichTextRun[] }
  | { type: 'heading'; level: 1 | 2 | 3; runs: RichTextRun[] }
  | { type: 'bullet_list'; items: ListItem[] }
  | { type: 'ordered_list'; items: ListItem[] }
  | { type: 'todo'; checked: boolean; indent: number; runs: RichTextRun[] }
  | { type: 'quote'; runs: RichTextRun[] }
  | { type: 'code'; language: string | null; text: string }
  | { type: 'divider' }
  | { type: 'image'; uri: string; width: number; height: number };

export type MemoRichDoc = {
  v: number;
  format: string;
  doc: { blocks: RichBlock[] };
};

export const RICH_MARKS: readonly RichMark[] = ['bold', 'italic', 'strike'] as const;
export const RICH_MARK_SET: ReadonlySet<string> = new Set(RICH_MARKS);
