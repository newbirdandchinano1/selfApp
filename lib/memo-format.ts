export type TextSelection = { start: number; end: number };

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

export function emptyMemoEditModel(): MemoEditModel {
  return { plain: '', styles: [] };
}

function findLastStackIndex(stack: CharStyle[], pred: (s: CharStyle) => boolean): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (pred(stack[i]!)) return i;
  }
  return -1;
}

export function normalizeMemoEditModel(model: MemoEditModel): MemoEditModel {
  const styles = [...model.styles];
  while (styles.length < model.plain.length) styles.push({});
  if (styles.length > model.plain.length) styles.length = model.plain.length;
  return { plain: model.plain, styles };
}

function mergeStyles(stack: CharStyle[]): CharStyle {
  const out: CharStyle = {};
  for (const s of stack) {
    if (s.bold) out.bold = true;
    if (s.size) out.size = s.size;
  }
  return out;
}

/** 将存储的正文（含标记）解析为编辑用纯文本 + 样式 */
export function parseMemoBodyToEditModel(body: string): MemoEditModel {
  const plainChars: string[] = [];
  const styles: CharStyle[] = [];
  const stack: CharStyle[] = [];
  let i = 0;

  while (i < body.length) {
    if (body.startsWith('[小]', i)) {
      stack.push({ size: 'small' });
      i += 3;
      continue;
    }
    if (body.startsWith('[/小]', i)) {
      const idx = findLastStackIndex(stack, s => s.size === 'small');
      if (idx >= 0) stack.splice(idx, 1);
      i += 4;
      continue;
    }
    if (body.startsWith('[大]', i)) {
      stack.push({ size: 'large' });
      i += 3;
      continue;
    }
    if (body.startsWith('[/大]', i)) {
      const idx = findLastStackIndex(stack, s => s.size === 'large');
      if (idx >= 0) stack.splice(idx, 1);
      i += 4;
      continue;
    }
    if (body.startsWith('**', i)) {
      const idx = findLastStackIndex(stack, s => s.bold);
      if (idx >= 0) stack.splice(idx, 1);
      else stack.push({ bold: true });
      i += 2;
      continue;
    }
    if (body.startsWith('~~', i)) {
      const close = body.indexOf('~~', i + 2);
      if (close !== -1) {
        for (let j = i + 2; j < close; j++) {
          plainChars.push(body[j]!);
          styles.push(mergeStyles(stack));
        }
        i = close + 2;
        continue;
      }
    }
    if (body[i] === '*' && body[i + 1] !== '*') {
      const close = body.indexOf('*', i + 1);
      if (close !== -1) {
        for (let j = i + 1; j < close; j++) {
          plainChars.push(body[j]!);
          styles.push(mergeStyles(stack));
        }
        i = close + 1;
        continue;
      }
    }

    plainChars.push(body[i]!);
    styles.push(mergeStyles(stack));
    i += 1;
  }

  return normalizeMemoEditModel({ plain: plainChars.join(''), styles });
}

function styleSignature(style: CharStyle): string {
  return `${style.bold ? 'b' : ''}|${style.size ?? ''}`;
}

/** 编辑模型序列化回存储格式（兼容查看页解析） */
export function serializeMemoEditModel(model: MemoEditModel): string {
  const { plain, styles } = model;
  if (!plain) return '';

  type Run = { text: string; style: CharStyle };
  const runs: Run[] = [];
  let runStart = 0;

  const pushRun = (end: number) => {
    if (end <= runStart) return;
    runs.push({
      text: plain.slice(runStart, end),
      style: styles[runStart] ?? {},
    });
    runStart = end;
  };

  for (let i = 1; i <= plain.length; i++) {
    const prev = styles[i - 1] ?? {};
    const cur = styles[i] ?? {};
    if (i === plain.length || styleSignature(prev) !== styleSignature(cur)) {
      pushRun(i);
    }
  }

  return runs
    .map(run => {
      let chunk = run.text;
      if (run.style.size === 'small') chunk = `[小]${chunk}[/小]`;
      if (run.style.size === 'large') chunk = `[大]${chunk}[/大]`;
      if (run.style.bold) chunk = `**${chunk}**`;
      return chunk;
    })
    .join('');
}

function textDiff(oldText: string, newText: string): { start: number; removed: number; added: number } {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
    start += 1;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return { start, removed: oldEnd - start, added: newEnd - start };
}

export function updateMemoEditModelPlain(
  model: MemoEditModel,
  nextPlain: string,
): MemoEditModel {
  if (nextPlain === model.plain) return model;
  const { start, removed, added } = textDiff(model.plain, nextPlain);
  const inherit: CharStyle =
    start > 0 ? { ...(model.styles[start - 1] ?? {}) } : added > 0 && start < model.styles.length
      ? { ...(model.styles[start] ?? {}) }
      : {};
  const nextStyles = [...model.styles];
  const inserts = Array.from({ length: added }, () => ({ ...inherit }));
  nextStyles.splice(start, removed, ...inserts);
  return normalizeMemoEditModel({ plain: nextPlain, styles: nextStyles });
}

function lineBounds(text: string, index: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const nextNl = text.indexOf('\n', index);
  const end = nextNl === -1 ? text.length : nextNl;
  return { start, end };
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

function toggleStyleOnRange(
  styles: CharStyle[],
  start: number,
  end: number,
  patch: Partial<CharStyle>,
  isActive: (style: CharStyle) => boolean,
): CharStyle[] {
  if (start >= end) return styles;
  const next = [...styles];
  const active = next.slice(start, end).every(isActive);
  for (let i = start; i < end; i++) {
    const cur = { ...(next[i] ?? {}) };
    if (active) {
      if (patch.bold) delete cur.bold;
      if (patch.size === 'small' || patch.size === 'large') delete cur.size;
    } else {
      if (patch.bold) cur.bold = true;
      if (patch.size) {
        cur.size = patch.size;
      }
    }
    next[i] = cur;
  }
  return next;
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

  let nextStyles = model.styles;
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

  return { model: { plain: model.plain, styles: nextStyles }, selection };
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
