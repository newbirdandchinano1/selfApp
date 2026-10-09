/**
 * RichDoc ↔ 编辑模型（plain + char styles）双向桥接。
 * 块结构用行前缀表达；行内 marks 落在正文字符 styles 上。
 */
import { emptyRichDoc } from './legacy';
import { sortMarks } from './normalize';
import { serializeRichDoc } from './serialize';
import { assertMemoBodyOrThrow } from './validate';
import {
  RICH_DOC_FORMAT,
  RICH_DOC_VERSION,
  type ListItem,
  type MemoRichDoc,
  type RichBlock,
  type RichMark,
  type RichTextRun,
} from './types';

export type BridgeCharStyle = {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
};

export type BridgeEditModel = {
  plain: string;
  styles: BridgeCharStyle[];
};

function marksToStyle(marks: RichMark[]): BridgeCharStyle {
  const s: BridgeCharStyle = {};
  if (marks.includes('bold')) s.bold = true;
  if (marks.includes('italic')) s.italic = true;
  if (marks.includes('strike')) s.strike = true;
  return s;
}

function styleToMarks(s: BridgeCharStyle | undefined): RichMark[] {
  const m: RichMark[] = [];
  if (s?.bold) m.push('bold');
  if (s?.italic) m.push('italic');
  if (s?.strike) m.push('strike');
  return sortMarks(m);
}

function appendText(
  plain: string[],
  styles: BridgeCharStyle[],
  text: string,
  style: BridgeCharStyle,
): void {
  for (const ch of text) {
    plain.push(ch);
    styles.push({ ...style });
  }
}

function appendRuns(plain: string[], styles: BridgeCharStyle[], runs: RichTextRun[]): void {
  for (const r of runs) appendText(plain, styles, r.text, marksToStyle(r.marks));
}

function nl(plain: string[], styles: BridgeCharStyle[]): void {
  plain.push('\n');
  styles.push({});
}

/** RichDoc → 编辑模型（块前缀 + 行内 styles） */
export function richDocToEditModel(doc: MemoRichDoc): BridgeEditModel {
  const plain: string[] = [];
  const styles: BridgeCharStyle[] = [];
  const blocks = doc.doc.blocks;

  for (let bi = 0; bi < blocks.length; bi++) {
    if (bi > 0) nl(plain, styles);
    const b = blocks[bi]!;
    switch (b.type) {
      case 'heading': {
        appendText(plain, styles, `${'#'.repeat(b.level)} `, {});
        appendRuns(plain, styles, b.runs);
        break;
      }
      case 'bullet_list':
        for (let i = 0; i < b.items.length; i++) {
          if (i > 0) nl(plain, styles);
          const it = b.items[i]!;
          appendText(plain, styles, `${'  '.repeat(it.indent)}- `, {});
          appendRuns(plain, styles, it.runs);
        }
        break;
      case 'ordered_list':
        for (let i = 0; i < b.items.length; i++) {
          if (i > 0) nl(plain, styles);
          const it = b.items[i]!;
          appendText(plain, styles, `${'  '.repeat(it.indent)}${i + 1}. `, {});
          appendRuns(plain, styles, it.runs);
        }
        break;
      case 'todo':
        appendText(
          plain,
          styles,
          `${'  '.repeat(b.indent)}- [${b.checked ? 'x' : ' '}] `,
          {},
        );
        appendRuns(plain, styles, b.runs);
        break;
      case 'quote':
        appendText(plain, styles, '> ', {});
        appendRuns(plain, styles, b.runs);
        break;
      case 'code': {
        appendText(plain, styles, `\`\`\`${b.language ?? ''}`, {});
        nl(plain, styles);
        appendText(plain, styles, b.text, {});
        nl(plain, styles);
        appendText(plain, styles, '```', {});
        break;
      }
      case 'divider':
        appendText(plain, styles, '---', {});
        break;
      case 'image':
        appendText(plain, styles, `![img](${b.uri})`, {});
        break;
      case 'paragraph':
      default:
        if ('runs' in b) appendRuns(plain, styles, b.runs);
        break;
    }
  }

  return { plain: plain.join(''), styles };
}

function runsFromRange(model: BridgeEditModel, start: number, end: number): RichTextRun[] {
  if (end <= start) return [{ text: '', marks: [] }];
  const runs: RichTextRun[] = [];
  let i = start;
  while (i < end) {
    const marks = styleToMarks(model.styles[i]);
    let j = i + 1;
    while (j < end) {
      const m2 = styleToMarks(model.styles[j]);
      if (m2.join('+') !== marks.join('+')) break;
      j += 1;
    }
    runs.push({ text: model.plain.slice(i, j), marks });
    i = j;
  }
  return runs.length ? runs : [{ text: '', marks: [] }];
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

/** 编辑模型 → RichDoc（保存权威出口） */
export function editModelToRichDoc(model: BridgeEditModel): MemoRichDoc {
  if (!model.plain) return emptyRichDoc();

  const lines = model.plain.split('\n');
  const blocks: RichBlock[] = [];
  let bulletBuf: ListItem[] = [];
  let orderedBuf: ListItem[] = [];
  let offset = 0;

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
    const line = lines[li]!;
    const lineStart = offset;
    offset += line.length + (li < lines.length - 1 ? 1 : 0);

    const { indent, rest } = countIndent(line);
    if (!rest.trim()) {
      flush();
      blocks.push({ type: 'paragraph', runs: [{ text: '', marks: [] }] });
      continue;
    }

    let m: RegExpMatchArray | null;

    if ((m = rest.match(/^!\[img\]\(([^)]+)\)\s*$/))) {
      flush();
      const uri = m[1]!.trim();
      if (uri && !/^data:/i.test(uri)) {
        blocks.push({ type: 'image', uri, width: 0, height: 0 });
      } else {
        blocks.push({ type: 'paragraph', runs: [{ text: '[图片]', marks: [] }] });
      }
      continue;
    }

    if ((m = rest.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      const contentStart = lineStart + (line.length - rest.length) + m[1]!.length + 1;
      const contentEnd = lineStart + line.length;
      blocks.push({
        type: 'heading',
        level: m[1]!.length as 1 | 2 | 3,
        runs: runsFromRange(model, contentStart, contentEnd),
      });
      continue;
    }

    if ((m = rest.match(/^>\s?(.*)$/))) {
      flush();
      const prefixLen = rest.length - m[1]!.length;
      const contentStart = lineStart + (line.length - rest.length) + prefixLen;
      blocks.push({
        type: 'quote',
        runs: runsFromRange(model, contentStart, lineStart + line.length),
      });
      continue;
    }

    if (/^---+\s*$/.test(rest)) {
      flush();
      blocks.push({ type: 'divider' });
      continue;
    }

    if ((m = rest.match(/^```([\w+-]*)\s*$/))) {
      flush();
      const language = m[1] ? m[1] : null;
      const codeLines: string[] = [];
      li += 1;
      while (li < lines.length) {
        const raw = lines[li]!;
        offset += raw.length + (li < lines.length - 1 ? 1 : 0);
        if (/^```\s*$/.test(raw.trimEnd()) || raw.trim() === '```') break;
        codeLines.push(raw);
        li += 1;
      }
      blocks.push({ type: 'code', language, text: codeLines.join('\n') });
      continue;
    }

    if ((m = rest.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      flush();
      const content = m[2]!;
      const contentStart = lineStart + line.length - content.length;
      blocks.push({
        type: 'todo',
        checked: m[1]!.toLowerCase() === 'x',
        indent,
        runs: runsFromRange(model, contentStart, lineStart + line.length),
      });
      continue;
    }

    if ((m = rest.match(/^[-*]\s+(.*)$/))) {
      if (orderedBuf.length) flush();
      const content = m[1]!;
      const contentStart = lineStart + line.length - content.length;
      bulletBuf.push({
        indent,
        runs: runsFromRange(model, contentStart, lineStart + line.length),
      });
      continue;
    }

    if ((m = rest.match(/^\d+[.)]\s+(.*)$/))) {
      if (bulletBuf.length) flush();
      const content = m[1]!;
      const contentStart = lineStart + line.length - content.length;
      orderedBuf.push({
        indent,
        runs: runsFromRange(model, contentStart, lineStart + line.length),
      });
      continue;
    }

    flush();
    const contentStart = lineStart + (line.length - rest.length);
    blocks.push({
      type: 'paragraph',
      runs: runsFromRange(model, contentStart, lineStart + line.length),
    });
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

/** 编辑模型 → 存库 body 字符串（校验字节/形态，禁止静默截断） */
export function serializeEditModelToBody(model: BridgeEditModel): string {
  const body = serializeRichDoc(editModelToRichDoc(model));
  assertMemoBodyOrThrow(body);
  return body;
}
