/**
 * 备忘录编辑模型 + 工具栏动作。
 *
 * 存储权威为 `memo-richdoc`（RichDoc JSON）。本文件仍服务编辑器 plain/styles；
 * 下列 markup 解析/写出为 **legacy-only**，禁止对新保存路径或库内 `body` 直接调用。
 */
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
  | 'italic'
  | 'strike'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bullet'
  | 'ordered'
  | 'todo'
  | 'quote'
  | 'code'
  | 'divider'
  | 'image'
  | 'indent-in'
  | 'indent-out'
  | 'size-small'
  | 'size-large';

export type CharStyle = {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
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

/** @deprecated legacy-only：旧 `**`/`[小]` markup 画像；新读写请用 memo-richdoc */
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
      const hasStrike = stack.some(s => !!s.strike);
      if (hasStrike) return { kind: 'pop', pred: s => !!s.strike, length: 2 };
      return { kind: 'push', style: { strike: true }, length: 2 };
    }
    if (body[i] === '*' && body[i + 1] !== '*') {
      const hasItalic = stack.some(s => !!s.italic);
      if (hasItalic) return { kind: 'pop', pred: s => !!s.italic, length: 1 };
      return { kind: 'push', style: { italic: true }, length: 1 };
    }
    return null;
  },
  wrapRun(text, style) {
    let chunk = text;
    if (style.size === 'small') chunk = `[小]${chunk}[/小]`;
    if (style.size === 'large') chunk = `[大]${chunk}[/大]`;
    if (style.strike) chunk = `~~${chunk}~~`;
    if (style.italic) chunk = `*${chunk}*`;
    if (style.bold) chunk = `**${chunk}**`;
    return chunk;
  },
  mergeStyles(stack) {
    const out: RichCharStyle = {};
    for (const s of stack) {
      if (s.bold) out.bold = true;
      if (s.italic) out.italic = true;
      if (s.strike) out.strike = true;
      if (s.size !== undefined) out.size = s.size;
    }
    return out;
  },
};

export function emptyMemoEditModel(): MemoEditModel {
  return asMemoModel(emptyRichTextModel());
}

export function normalizeMemoEditModel(model: MemoEditModel): MemoEditModel {
  return asMemoModel(normalizeRichTextModel(asRichModel(model)));
}

/**
 * @deprecated legacy-only。禁止对库内 body 调用（RichDoc JSON 会被当 markup 拆烂）。
 * 加载：`parseMemoBody` → `richDocToEditModel`；保存：`serializeEditModelToBody`。
 */
export function parseMemoBodyToEditModel(body: string): MemoEditModel {
  return asMemoModel(parseMarkupToModel(body, MEMO_MARKUP_PROFILE));
}

/**
 * @deprecated legacy-only。写出旧 `**`/`[小]` markup；新保存禁止走此路径。
 */
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

type LinePrefixKind =
  | 'none'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bullet'
  | 'ordered'
  | 'todo'
  | 'quote';

function parseLinePrefix(line: string): {
  indent: string;
  kind: LinePrefixKind;
  prefix: string;
  content: string;
} {
  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? '';
  const rest = line.slice(indent.length);
  let m: RegExpMatchArray | null;
  if ((m = rest.match(/^(#{1,3})\s+/))) {
    const level = m[1]!.length;
    const kind = (level === 1 ? 'heading-1' : level === 2 ? 'heading-2' : 'heading-3') as LinePrefixKind;
    return { indent, kind, prefix: m[0]!, content: rest.slice(m[0]!.length) };
  }
  if ((m = rest.match(/^[-*]\s+\[[ xX]\]\s+/))) {
    return { indent, kind: 'todo', prefix: m[0]!, content: rest.slice(m[0]!.length) };
  }
  if ((m = rest.match(/^[-*]\s+/))) {
    return { indent, kind: 'bullet', prefix: m[0]!, content: rest.slice(m[0]!.length) };
  }
  if ((m = rest.match(/^\d+[.)]\s+/))) {
    return { indent, kind: 'ordered', prefix: m[0]!, content: rest.slice(m[0]!.length) };
  }
  if ((m = rest.match(/^>\s?/))) {
    return { indent, kind: 'quote', prefix: m[0]!, content: rest.slice(m[0]!.length) };
  }
  return { indent, kind: 'none', prefix: '', content: rest };
}

function prefixForKind(kind: LinePrefixKind): string {
  switch (kind) {
    case 'heading-1':
      return '# ';
    case 'heading-2':
      return '## ';
    case 'heading-3':
      return '### ';
    case 'bullet':
      return '- ';
    case 'ordered':
      return '1. ';
    case 'todo':
      return '- [ ] ';
    case 'quote':
      return '> ';
    default:
      return '';
  }
}

function replaceLineRange(
  model: MemoEditModel,
  lineStart: number,
  lineEnd: number,
  nextLine: string,
): MemoEditModel {
  const prefixStyles = model.styles.slice(0, lineStart);
  const suffixStyles = model.styles.slice(lineEnd);
  const midStyles: CharStyle[] = Array.from({ length: nextLine.length }, (_, i) => {
    const oldIdx = lineStart + Math.min(i, Math.max(0, lineEnd - lineStart - 1));
    return { ...(model.styles[oldIdx] ?? {}) };
  });
  return normalizeMemoEditModel({
    plain: `${model.plain.slice(0, lineStart)}${nextLine}${model.plain.slice(lineEnd)}`,
    styles: [...prefixStyles, ...midStyles, ...suffixStyles],
  });
}

function applyBlockPrefixToSelection(
  model: MemoEditModel,
  selection: TextSelection,
  kind: LinePrefixKind,
): { model: MemoEditModel; selection: TextSelection } {
  const { start, end } = lineRangeForSelection(model.plain, selection);
  const block = model.plain.slice(start, end);
  const lines = block.split('\n');
  let cursor = start;
  let nextPlain = model.plain.slice(0, start);
  const nextStyles: CharStyle[] = model.styles.slice(0, start);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const parsed = parseLinePrefix(line);
    const toggledOff = parsed.kind === kind;
    const newPrefix = toggledOff ? '' : prefixForKind(kind);
    const nextLine = `${parsed.indent}${newPrefix}${parsed.content}`;
    for (let c = 0; c < nextLine.length; c++) {
      const src = cursor + Math.min(c, Math.max(0, line.length - 1));
      nextStyles.push({ ...(model.styles[src] ?? {}) });
    }
    nextPlain += nextLine;
    cursor += line.length;
    if (i < lines.length - 1) {
      nextPlain += '\n';
      nextStyles.push({ ...(model.styles[cursor] ?? {}) });
      cursor += 1;
    }
  }

  nextPlain += model.plain.slice(end);
  nextStyles.push(...model.styles.slice(end));
  const normalized = normalizeMemoEditModel({ plain: nextPlain, styles: nextStyles });
  return {
    model: normalized,
    selection: { start, end: start + (normalized.plain.length - (model.plain.length - (end - start))) },
  };
}

function insertAtSelection(
  model: MemoEditModel,
  selection: TextSelection,
  text: string,
): { model: MemoEditModel; selection: TextSelection } {
  const a = Math.min(selection.start, selection.end);
  const b = Math.max(selection.start, selection.end);
  const insertStyles: CharStyle[] = Array.from({ length: text.length }, () => ({}));
  const next = normalizeMemoEditModel({
    plain: `${model.plain.slice(0, a)}${text}${model.plain.slice(b)}`,
    styles: [...model.styles.slice(0, a), ...insertStyles, ...model.styles.slice(b)],
  });
  const pos = a + text.length;
  return { model: next, selection: { start: pos, end: pos } };
}

function wrapCodeFence(
  model: MemoEditModel,
  selection: TextSelection,
): { model: MemoEditModel; selection: TextSelection } {
  const { start, end } = lineRangeForSelection(model.plain, selection);
  const block = model.plain.slice(start, end);
  if (block.startsWith('```') && block.endsWith('```')) {
    const inner = block.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
    return {
      model: replaceLineRange(model, start, end, inner),
      selection: { start, end: start + inner.length },
    };
  }
  const wrapped = `\`\`\`\n${block}\n\`\`\``;
  return {
    model: replaceLineRange(model, start, end, wrapped),
    selection: { start, end: start + wrapped.length },
  };
}

export function applyMemoFormatToModel(
  model: MemoEditModel,
  selection: TextSelection,
  action: MemoFormatAction,
  extras?: { imageUri?: string },
): { model: MemoEditModel; selection: TextSelection } {
  if (action === 'indent-in' || action === 'indent-out') {
    return adjustModelIndent(model, selection, action === 'indent-in' ? 1 : -1);
  }

  if (
    action === 'heading-1' ||
    action === 'heading-2' ||
    action === 'heading-3' ||
    action === 'bullet' ||
    action === 'ordered' ||
    action === 'todo' ||
    action === 'quote'
  ) {
    return applyBlockPrefixToSelection(model, selection, action);
  }

  if (action === 'code') {
    return wrapCodeFence(model, selection);
  }

  if (action === 'divider') {
    const at = Math.max(selection.start, selection.end);
    const needsNlBefore = at > 0 && model.plain[at - 1] !== '\n';
    const needsNlAfter = at < model.plain.length && model.plain[at] !== '\n';
    const text = `${needsNlBefore ? '\n' : ''}---${needsNlAfter ? '\n' : ''}`;
    return insertAtSelection(model, { start: at, end: at }, text);
  }

  if (action === 'image') {
    const uri = (extras?.imageUri ?? '').trim();
    if (!uri || /^data:/i.test(uri)) return { model, selection };
    const at = Math.max(selection.start, selection.end);
    const needsNlBefore = at > 0 && model.plain[at - 1] !== '\n';
    const needsNlAfter = at < model.plain.length && model.plain[at] !== '\n';
    const text = `${needsNlBefore ? '\n' : ''}![img](${uri})${needsNlAfter ? '\n' : ''}`;
    return insertAtSelection(model, { start: at, end: at }, text);
  }

  const { start, end } = selection;
  if (start >= end) return { model, selection };

  let nextStyles: RichCharStyle[] = model.styles;
  if (action === 'bold') {
    nextStyles = toggleStyleOnRange(nextStyles, start, end, { bold: true }, s => Boolean(s.bold));
  } else if (action === 'italic') {
    nextStyles = toggleStyleOnRange(nextStyles, start, end, { italic: true }, s => Boolean(s.italic));
  } else if (action === 'strike') {
    nextStyles = toggleStyleOnRange(nextStyles, start, end, { strike: true }, s => Boolean(s.strike));
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

/**
 * @deprecated legacy-only。旧查看侧 markdown regex；已被 MemoFormattedBody + memo-richdoc/legacy 取代。
 */
export function parseMemoBodyBlocks(body: string): BlockLine[] {
  return body.split('\n').map(parseBlockLine);
}

/** @deprecated legacy-only。别名 serializeMemoEditModel；勿用于落库。 */
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
