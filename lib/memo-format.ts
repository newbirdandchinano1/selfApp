import type { MarkupProfile, MarkupTagMatch, RichCharStyle, RichTextModel, TextSelection } from './rich-text/index';
import {
  emptyRichTextModel,
  lineBounds,
  normalizeRichTextModel,
  parseMarkupToModel,
  serializeModelToMarkup,
  toggleStyleOnRange,
  updateRichTextModelPlain,
} from './rich-text/index';

export type { TextSelection };

export type MemoFormatAction =
  | 'bold'
  | 'size-small'
  | 'size-large'
  | 'indent-in'
  | 'indent-out';

export type CharStyle = {
  bold?: boolean;
  size?: 'small' | 'large';
};

export type MemoEditModel = {
  plain: string;
  styles: CharStyle[];
};

const INDENT_STEP = '  ';

function asMemoModel(model: RichTextModel): MemoEditModel {
  return model as MemoEditModel;
}

function asRichModel(model: MemoEditModel): RichTextModel {
  return model as RichTextModel;
}

export const MEMO_MARKUP_PROFILE: MarkupProfile = {
  matchTagAt(body, i, stack): MarkupTagMatch | null {
    if (body.startsWith('[小]', i)) {
      return { kind: 'push', style: { size: 'small' }, length: 3 };
    }
    if (body.startsWith('[/小]', i)) {
      return { kind: 'pop', pred: s => s.size === 'small', length: 4 };
    }
    if (body.startsWith('[大]', i)) {
      return { kind: 'push', style: { size: 'large' }, length: 3 };
    }
    if (body.startsWith('[/大]', i)) {
      return { kind: 'pop', pred: s => s.size === 'large', length: 4 };
    }
    if (body.startsWith('**', i)) {
      const hasBold = stack.some(s => !!s.bold);
      if (hasBold) return { kind: 'pop', pred: s => !!s.bold, length: 2 };
      return { kind: 'push', style: { bold: true }, length: 2 };
    }
    if (body.startsWith('~~', i)) {
      const close = body.indexOf('~~', i + 2);
      if (close !== -1) {
        return {
          kind: 'skipSpan',
          contentStart: i + 2,
          contentEnd: close,
          totalLength: close + 2 - i,
        };
      }
    }
    if (body[i] === '*' && body[i + 1] !== '*') {
      const close = body.indexOf('*', i + 1);
      if (close !== -1) {
        return {
          kind: 'skipSpan',
          contentStart: i + 1,
          contentEnd: close,
          totalLength: close + 1 - i,
        };
      }
    }
    return null;
  },
  wrapRun(text, style) {
    let chunk = text;
    if (style.size === 'small') chunk = `[小]${chunk}[/小]`;
    if (style.size === 'large') chunk = `[大]${chunk}[/大]`;
    if (style.bold) chunk = `**${chunk}**`;
    return chunk;
  },
};

export function emptyMemoEditModel(): MemoEditModel {
  return asMemoModel(emptyRichTextModel());
}

export function normalizeMemoEditModel(model: MemoEditModel): MemoEditModel {
  return asMemoModel(normalizeRichTextModel(asRichModel(model)));
}

/** 将存储的正文（含标记）解析为编辑用纯文本 + 样式 */
export function parseMemoBodyToEditModel(body: string): MemoEditModel {
  return asMemoModel(parseMarkupToModel(body, MEMO_MARKUP_PROFILE));
}

/** 编辑模型序列化回存储格式（兼容查看页解析） */
export function serializeMemoEditModel(model: MemoEditModel): string {
  return serializeModelToMarkup(asRichModel(model), MEMO_MARKUP_PROFILE);
}

export function updateMemoEditModelPlain(model: MemoEditModel, nextPlain: string): MemoEditModel {
  return asMemoModel(updateRichTextModelPlain(asRichModel(model), nextPlain));
}

function lineRangeForSelection(text: string, selection: TextSelection): { start: number; end: number } {
  const a = lineBounds(text, selection.start);
  const b = lineBounds(text, Math.max(selection.start, selection.end - 1));
  return { start: a.start, end: b.end };
}

function adjustLineIndent(line: string, delta: 1 | -1): string {
  if (delta === 1) return `${INDENT_STEP}${line}`;
  if (line.startsWith(INDENT_STEP)) return line.slice(INDENT_STEP.length);
  if (line.startsWith('\t')) return line.slice(1);
  return line;
}

function lineStartInBlock(lines: string[], lineIndex: number): number {
  let idx = 0;
  for (let i = 0; i < lineIndex; i++) {
    idx += lines[i]!.length + 1;
  }
  return idx;
}

function adjustModelIndent(
  model: MemoEditModel,
  selection: TextSelection,
  delta: 1 | -1,
): { model: MemoEditModel; selection: TextSelection } {
  const { start, end } = lineRangeForSelection(model.plain, selection);
  const prefixStyles = model.styles.slice(0, start);
  const suffixStyles = model.styles.slice(end);
  const block = model.plain.slice(start, end);
  const blockStyles = model.styles.slice(start, end);
  const lines = block.split('\n');

  const lineStyleGroups: CharStyle[][] = [];
  let pos = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    lineStyleGroups.push(blockStyles.slice(pos, pos + line.length));
    pos += line.length;
    if (li < lines.length - 1) pos += 1;
  }

  const nextLines = lines.map(line => adjustLineIndent(line, delta));
  const nextLineStyleGroups = lines.map((line, i) => {
    const lineStyles = [...(lineStyleGroups[i] ?? [])];
    if (delta === 1) return [{}, ...lineStyles];
    if (line.startsWith(INDENT_STEP) && lineStyles.length > 0) return lineStyles.slice(1);
    if (line.startsWith('\t') && lineStyles.length > 0) return lineStyles.slice(1);
    return lineStyles;
  });

  let midPlain = '';
  const midStyles: CharStyle[] = [];
  for (let i = 0; i < nextLines.length; i++) {
    const line = nextLines[i]!;
    let lineStyles = nextLineStyleGroups[i] ?? [];
    while (lineStyles.length < line.length) lineStyles.push({});
    if (lineStyles.length > line.length) lineStyles = lineStyles.slice(0, line.length);
    midPlain += line;
    midStyles.push(...lineStyles);
    if (i < nextLines.length - 1) {
      midPlain += '\n';
      const nlIdx = lineStartInBlock(lines, i) + lines[i]!.length;
      midStyles.push(blockStyles[nlIdx] ?? {});
    }
  }

  return {
    model: normalizeMemoEditModel({
      plain: `${model.plain.slice(0, start)}${midPlain}${model.plain.slice(end)}`,
      styles: [...prefixStyles, ...midStyles, ...suffixStyles],
    }),
    selection: { start, end: start + midPlain.length },
  };
}

export function applyMemoFormatToModel(
  model: MemoEditModel,
  selection: TextSelection,
  action: MemoFormatAction,
): { model: MemoEditModel; selection: TextSelection } {
  if (action === 'indent-in' || action === 'indent-out') {
    return adjustModelIndent(model, selection, action === 'indent-in' ? 1 : -1);
  }

  const { start, end } = selection;
  if (start >= end) return { model, selection };

  let nextStyles: RichCharStyle[] = model.styles;
  if (action === 'bold') {
    nextStyles = toggleStyleOnRange(nextStyles, start, end, { bold: true }, s => Boolean(s.bold));
  } else if (action === 'size-small') {
    nextStyles = toggleStyleOnRange(
      nextStyles,
      start,
      end,
      { size: 'small' },
      s => s.size === 'small',
    );
  } else if (action === 'size-large') {
    nextStyles = toggleStyleOnRange(
      nextStyles,
      start,
      end,
      { size: 'large' },
      s => s.size === 'large',
    );
  }

  return { model: { plain: model.plain, styles: nextStyles as CharStyle[] }, selection };
}

export type InlineSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  size?: 'small' | 'large';
};

export type BlockLine =
  | { kind: 'empty' }
  | { kind: 'heading'; level: number; indent: number; segments: InlineSegment[] }
  | { kind: 'bullet'; indent: number; segments: InlineSegment[] }
  | { kind: 'quote'; indent: number; segments: InlineSegment[] }
  | { kind: 'paragraph'; indent: number; segments: InlineSegment[] };

function countLeadingIndent(line: string): { indent: number; rest: string } {
  let indent = 0;
  let rest = line;
  while (rest.startsWith(INDENT_STEP)) {
    indent += 1;
    rest = rest.slice(INDENT_STEP.length);
  }
  if (rest.startsWith('\t')) {
    indent += 1;
    rest = rest.slice(1);
  }
  return { indent, rest };
}

function parseInline(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let i = 0;
  const push = (text: string, style: Partial<InlineSegment>) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (
      last &&
      last.bold === style.bold &&
      last.italic === style.italic &&
      last.strike === style.strike &&
      last.size === style.size
    ) {
      last.text += text;
      return;
    }
    segments.push({ text, ...style });
  };

  while (i < line.length) {
    if (line.startsWith('[小]', i)) {
      const close = line.indexOf('[/小]', i + 3);
      if (close !== -1) {
        push(line.slice(i + 3, close), { size: 'small' });
        i = close + 4;
        continue;
      }
    }
    if (line.startsWith('[大]', i)) {
      const close = line.indexOf('[/大]', i + 3);
      if (close !== -1) {
        push(line.slice(i + 3, close), { size: 'large' });
        i = close + 4;
        continue;
      }
    }
    if (line.startsWith('**', i)) {
      const close = line.indexOf('**', i + 2);
      if (close !== -1) {
        push(line.slice(i + 2, close), { bold: true });
        i = close + 2;
        continue;
      }
    }
    if (line.startsWith('~~', i)) {
      const close = line.indexOf('~~', i + 2);
      if (close !== -1) {
        push(line.slice(i + 2, close), { strike: true });
        i = close + 2;
        continue;
      }
    }
    if (line[i] === '*' && line[i + 1] !== '*') {
      const close = line.indexOf('*', i + 1);
      if (close !== -1) {
        push(line.slice(i + 1, close), { italic: true });
        i = close + 1;
        continue;
      }
    }
    const nextSpecial = (() => {
      const candidates = [
        line.indexOf('[小]', i),
        line.indexOf('[大]', i),
        line.indexOf('**', i),
        line.indexOf('~~', i),
        line.indexOf('*', i),
      ].filter(x => x !== -1);
      return candidates.length ? Math.min(...candidates) : -1;
    })();
    const end = nextSpecial === -1 ? line.length : nextSpecial;
    push(line.slice(i, end), {});
    i = end === i ? i + 1 : end;
  }

  return segments.length ? segments : [{ text: line }];
}

function parseBlockLine(raw: string): BlockLine {
  const line = raw.replace(/\r$/, '');
  if (!line.trim() && !line.length) return { kind: 'empty' };

  const { indent, rest } = countLeadingIndent(line);
  if (!rest.trim()) return { kind: 'empty' };

  const heading = rest.match(/^(#{1,3})\s+(.*)$/);
  if (heading) {
    return {
      kind: 'heading',
      level: heading[1]!.length,
      indent,
      segments: parseInline(heading[2]!),
    };
  }
  const bullet = rest.match(/^[-*]\s+(.*)$/);
  if (bullet) return { kind: 'bullet', indent, segments: parseInline(bullet[1]!) };
  const quote = rest.match(/^>\s+(.*)$/);
  if (quote) return { kind: 'quote', indent, segments: parseInline(quote[1]!) };

  return { kind: 'paragraph', indent, segments: parseInline(rest) };
}

export function parseMemoBodyBlocks(body: string): BlockLine[] {
  return body.split('\n').map(parseBlockLine);
}

/** 由编辑模型生成查看/存储用正文 */
export function memoBodyFromEditModel(model: MemoEditModel): string {
  return serializeMemoEditModel(model);
}

export function memoHasAiReview(row: {
  ai_evaluation?: string;
  ai_suggestions?: string;
  ai_review_at?: string;
}): boolean {
  return Boolean(row.ai_evaluation?.trim() || row.ai_suggestions?.trim() || row.ai_review_at);
}
