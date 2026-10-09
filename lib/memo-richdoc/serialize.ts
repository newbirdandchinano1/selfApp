import { sortMarks } from './normalize';
import {
  RICH_DOC_FORMAT,
  RICH_DOC_VERSION,
  type MemoRichDoc,
  type RichTextRun,
} from './types';

function stableRuns(runs: RichTextRun[]): RichTextRun[] {
  return runs.map((r) => ({ text: r.text, marks: sortMarks(r.marks) }));
}

/** RichDoc → 稳定 JSON 字符串（字段顺序固定，减少无意义 diff） */
export function serializeRichDoc(doc: MemoRichDoc): string {
  const blocks = doc.doc.blocks.map((b) => {
    switch (b.type) {
      case 'paragraph':
        return { type: 'paragraph', runs: stableRuns(b.runs) };
      case 'heading':
        return { type: 'heading', level: b.level, runs: stableRuns(b.runs) };
      case 'bullet_list':
        return {
          type: 'bullet_list',
          items: b.items.map((it) => ({ indent: it.indent, runs: stableRuns(it.runs) })),
        };
      case 'ordered_list':
        return {
          type: 'ordered_list',
          items: b.items.map((it) => ({ indent: it.indent, runs: stableRuns(it.runs) })),
        };
      case 'todo':
        return {
          type: 'todo',
          checked: b.checked,
          indent: b.indent,
          runs: stableRuns(b.runs),
        };
      case 'quote':
        return { type: 'quote', runs: stableRuns(b.runs) };
      case 'code':
        return { type: 'code', language: b.language, text: b.text };
      case 'divider':
        return { type: 'divider' };
      case 'image':
        return { type: 'image', uri: b.uri, width: b.width, height: b.height };
    }
  });
  return JSON.stringify({
    v: RICH_DOC_VERSION,
    format: RICH_DOC_FORMAT,
    doc: { blocks },
  });
}
