/**
 * 旧 markup → RichDoc（read-compat / legacy-only）。
 * 新保存路径一律写 RichDoc JSON；本模块不得再作为写出权威。
 */
import { sortMarks } from './normalize';
import {
  RICH_DOC_FORMAT,
  RICH_DOC_VERSION,
  type ListItem,
  type MemoRichDoc,
  type RichBlock,
  type RichMark,
  type RichTextRun,
} from './types';

export function emptyRichDoc(): MemoRichDoc {
  return {
    v: RICH_DOC_VERSION,
    format: RICH_DOC_FORMAT,
    doc: { blocks: [{ type: 'paragraph', runs: [{ text: '', marks: [] }] }] },
  };
}

function mergeMarks(base: RichMark[], extra: RichMark[]): RichMark[] {
  return sortMarks([...new Set([...base, ...extra])]);
}

/**
 * 行内：`**bold**` / `*italic*` / `~~strike~~` / `[小]…[/小]` / `[大]…[/大]`。
 * 字号不进首批 marks，剥标签保留正文（可与粗体等嵌套）。
 */
export function parseInlineRuns(line: string, base: RichMark[] = []): RichTextRun[] {
  const runs: RichTextRun[] = [];
  const push = (text: string, marks: RichMark[]) => {
    if (!text) return;
    const sorted = sortMarks(marks);
    const last = runs[runs.length - 1];
    const key = (m: RichMark[]) => m.join('+');
    if (last && key(last.marks) === key(sorted)) {
      last.text += text;
      return;
    }
    runs.push({ text, marks: sorted });
  };

  let i = 0;
  while (i < line.length) {
    if (line.startsWith('**', i)) {
      const c = line.indexOf('**', i + 2);
      if (c !== -1) {
        for (const r of parseInlineRuns(line.slice(i + 2, c), mergeMarks(base, ['bold']))) {
          push(r.text, r.marks);
        }
        i = c + 2;
        continue;
      }
    }
    if (line.startsWith('~~', i)) {
      const c = line.indexOf('~~', i + 2);
      if (c !== -1) {
        for (const r of parseInlineRuns(line.slice(i + 2, c), mergeMarks(base, ['strike']))) {
          push(r.text, r.marks);
        }
        i = c + 2;
        continue;
      }
    }
    if (line[i] === '*' && line[i + 1] !== '*') {
      const c = line.indexOf('*', i + 1);
      if (c !== -1) {
        for (const r of parseInlineRuns(line.slice(i + 1, c), mergeMarks(base, ['italic']))) {
          push(r.text, r.marks);
        }
        i = c + 1;
        continue;
      }
    }
    if (line.startsWith('[小]', i) || line.startsWith('[大]', i)) {
      const tag = line.startsWith('[小]', i) ? '[小]' : '[大]';
      const close = tag === '[小]' ? '[/小]' : '[/大]';
      const c = line.indexOf(close, i + tag.length);
      if (c !== -1) {
        // v1 无 size mark：剥标签保留正文，嵌套 marks 仍生效
        for (const r of parseInlineRuns(line.slice(i + tag.length, c), base)) {
          push(r.text, r.marks);
        }
        i = c + close.length;
        continue;
      }
    }

    const cand = [
      line.indexOf('**', i),
      line.indexOf('~~', i),
      line.indexOf('*', i),
      line.indexOf('[小]', i),
      line.indexOf('[大]', i),
    ].filter((x) => x !== -1);
    const end = cand.length ? Math.min(...cand) : line.length;
    if (end === i) {
      push(line[i]!, base);
      i += 1;
    } else {
      push(line.slice(i, end), base);
      i = end;
    }
  }
  return runs.length ? runs : [{ text: line, marks: sortMarks(base) }];
}

function countIndent(line: string): { indent: number; rest: string } {
  let indent = 0;
  let rest = line;
  while (rest.startsWith('  ')) {
    indent += 1;
    rest = rest.slice(2);
  }
  if (rest.startsWith('\t')) {
    indent += 1;
    rest = rest.slice(1);
  }
  return { indent, rest };
}

/** 旧 markup → RichDoc（读兼容；保存路径写 JSON） */
export function legacyMarkupToRichDoc(body: string): MemoRichDoc {
  if (!body) return emptyRichDoc();

  const lines = body.split('\n');
  const blocks: RichBlock[] = [];
  let bulletBuf: ListItem[] = [];
  let orderedBuf: ListItem[] = [];

  const flush = () => {
    if (bulletBuf.length) {
      blocks.push({ type: 'bullet_list', items: bulletBuf });
      bulletBuf = [];
    }
    if (orderedBuf.length) {
      blocks.push({ type: 'ordered_list', items: orderedBuf });
      orderedBuf = [];
    }
  };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!.replace(/\r$/, '');
    const { indent, rest } = countIndent(line);

    if (!rest.trim()) {
      flush();
      blocks.push({ type: 'paragraph', runs: [{ text: '', marks: [] }] });
      continue;
    }

    let m: RegExpMatchArray | null;

    if ((m = rest.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      blocks.push({
        type: 'heading',
        level: m[1]!.length as 1 | 2 | 3,
        runs: parseInlineRuns(m[2]!),
      });
      continue;
    }
    if ((m = rest.match(/^>\s?(.*)$/))) {
      flush();
      blocks.push({ type: 'quote', runs: parseInlineRuns(m[1]!) });
      continue;
    }
    if (/^---+\s*$/.test(rest)) {
      flush();
      blocks.push({ type: 'divider' });
      continue;
    }
    if ((m = rest.match(/^!\[img\]\(([^)]+)\)\s*$/))) {
      flush();
      const uri = m[1]!.trim();
      if (uri && !/^data:/i.test(uri) && uri.length <= 2048) {
        blocks.push({ type: 'image', uri, width: 0, height: 0 });
      } else {
        blocks.push({ type: 'paragraph', runs: [{ text: '[图片]', marks: [] }] });
      }
      continue;
    }
    if ((m = rest.match(/^```([\w+-]*)\s*$/))) {
      flush();
      const language = m[1] ? m[1] : null;
      const codeLines: string[] = [];
      li += 1;
      while (li < lines.length) {
        const raw = lines[li]!.replace(/\r$/, '');
        if (/^```\s*$/.test(raw.trimEnd()) || raw.trim() === '```') break;
        codeLines.push(raw);
        li += 1;
      }
      blocks.push({ type: 'code', language, text: codeLines.join('\n') });
      continue;
    }
    if ((m = rest.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      flush();
      blocks.push({
        type: 'todo',
        checked: m[1]!.toLowerCase() === 'x',
        indent,
        runs: parseInlineRuns(m[2]!),
      });
      continue;
    }
    if ((m = rest.match(/^[-*]\s+(.*)$/))) {
      if (orderedBuf.length) flush();
      bulletBuf.push({ indent, runs: parseInlineRuns(m[1]!) });
      continue;
    }
    if ((m = rest.match(/^\d+[.)]\s+(.*)$/))) {
      if (bulletBuf.length) flush();
      orderedBuf.push({ indent, runs: parseInlineRuns(m[1]!) });
      continue;
    }

    flush();
    blocks.push({ type: 'paragraph', runs: parseInlineRuns(rest) });
  }

  flush();
  return {
    v: RICH_DOC_VERSION,
    format: RICH_DOC_FORMAT,
    doc: {
      blocks: blocks.length
        ? blocks
        : [{ type: 'paragraph', runs: [{ text: '', marks: [] }] }],
    },
  };
}
