import {
  RICH_MARK_SET,
  type ListItem,
  type RichBlock,
  type RichMark,
  type RichTextRun,
} from './types';

export function saneRuns(v: unknown): RichTextRun[] {
  if (!Array.isArray(v)) return [{ text: '', marks: [] }];
  return v.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text : '';
    const marks = Array.isArray(o.marks)
      ? (o.marks as unknown[]).filter((m): m is RichMark => typeof m === 'string' && RICH_MARK_SET.has(m))
      : [];
    return { text, marks: sortMarks([...new Set(marks)]) };
  });
}

export function sortMarks(marks: RichMark[]): RichMark[] {
  const order: Record<RichMark, number> = { bold: 0, italic: 1, strike: 2 };
  return [...marks].sort((a, b) => order[a] - order[b]);
}

export function saneIndent(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : 0;
  return Math.min(8, Math.max(0, Number.isFinite(n) ? n : 0));
}

export function saneItems(v: unknown): ListItem[] {
  if (!Array.isArray(v) || !v.length) return [{ indent: 0, runs: [{ text: '', marks: [] }] }];
  return v.slice(0, 500).map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return { indent: saneIndent(o.indent), runs: saneRuns(o.runs) };
  });
}

/** 未知 type / 脏 image → 降级为段落，不抛崩 */
export function normalizeBlock(b: unknown): RichBlock {
  const o = (b ?? {}) as Record<string, unknown>;
  switch (o.type) {
    case 'heading': {
      const lv = o.level === 2 ? 2 : o.level === 3 ? 3 : 1;
      return { type: 'heading', level: lv as 1 | 2 | 3, runs: saneRuns(o.runs) };
    }
    case 'bullet_list':
      return { type: 'bullet_list', items: saneItems(o.items) };
    case 'ordered_list':
      return { type: 'ordered_list', items: saneItems(o.items) };
    case 'todo':
      return {
        type: 'todo',
        checked: o.checked === true,
        indent: saneIndent(o.indent),
        runs: saneRuns(o.runs),
      };
    case 'quote':
      return { type: 'quote', runs: saneRuns(o.runs) };
    case 'code':
      return {
        type: 'code',
        language: typeof o.language === 'string' ? o.language : null,
        text: typeof o.text === 'string' ? o.text : '',
      };
    case 'divider':
      return { type: 'divider' };
    case 'image': {
      const uri = typeof o.uri === 'string' ? o.uri.trim() : '';
      if (!uri || uri.length > 2048 || /^data:/i.test(uri)) {
        return { type: 'paragraph', runs: [{ text: '[图片]', marks: [] }] };
      }
      const num = (x: unknown) =>
        typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0;
      return { type: 'image', uri, width: num(o.width), height: num(o.height) };
    }
    case 'paragraph':
    default:
      // 未知 type：尽量抽 runs/text，否则空段落
      if (typeof o.text === 'string' && !Array.isArray(o.runs)) {
        return { type: 'paragraph', runs: [{ text: o.text, marks: [] }] };
      }
      return { type: 'paragraph', runs: saneRuns(o.runs) };
  }
}
