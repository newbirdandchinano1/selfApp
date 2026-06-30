export type TextSelection = { start: number; end: number };

export type ReviewFontSize = 15 | 17 | 19 | 22;

export const REVIEW_FONT_SIZES: ReviewFontSize[] = [15, 17, 19, 22];

export type ReviewCharStyle = {
  size?: ReviewFontSize;
};

export type ReviewTextModel = {
  plain: string;
  styles: ReviewCharStyle[];
};

export type ReviewBlock =
  | { kind: 'text'; model: ReviewTextModel }
  | { kind: 'image'; uri: string };

export type ReviewFieldModel = {
  blocks: ReviewBlock[];
};

const IMAGE_MARKER_RE = /\n\[\[img:([^\]]+)\]\]\n/g;
const LEGACY_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

export function emptyReviewTextModel(): ReviewTextModel {
  return { plain: '', styles: [] };
}

export function emptyReviewFieldModel(): ReviewFieldModel {
  return { blocks: [{ kind: 'text', model: emptyReviewTextModel() }] };
}

function findLastStackIndex(stack: ReviewCharStyle[], pred: (s: ReviewCharStyle) => boolean): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (pred(stack[i]!)) return i;
  }
  return -1;
}

export function normalizeReviewTextModel(model: ReviewTextModel): ReviewTextModel {
  const styles = [...model.styles];
  while (styles.length < model.plain.length) styles.push({});
  if (styles.length > model.plain.length) styles.length = model.plain.length;
  return { plain: model.plain, styles };
}

function mergeStyles(stack: ReviewCharStyle[]): ReviewCharStyle {
  const out: ReviewCharStyle = {};
  for (const s of stack) {
    if (s.size) out.size = s.size;
  }
  return out;
}

function sizeOpenTag(size: ReviewFontSize): string {
  return `[${size}]`;
}

function sizeCloseTag(size: ReviewFontSize): string {
  return `[/${size}]`;
}

function parseReviewTextBody(body: string): ReviewTextModel {
  const plainChars: string[] = [];
  const styles: ReviewCharStyle[] = [];
  const stack: ReviewCharStyle[] = [];
  let i = 0;

  while (i < body.length) {
    let matchedSize = false;
    for (const size of REVIEW_FONT_SIZES) {
      const open = sizeOpenTag(size);
      const close = sizeCloseTag(size);
      if (body.startsWith(open, i)) {
        stack.push({ size });
        i += open.length;
        matchedSize = true;
        break;
      }
      if (body.startsWith(close, i)) {
        const idx = findLastStackIndex(stack, s => s.size === size);
        if (idx >= 0) stack.splice(idx, 1);
        i += close.length;
        matchedSize = true;
        break;
      }
    }
    if (matchedSize) continue;

    plainChars.push(body[i]!);
    styles.push(mergeStyles(stack));
    i += 1;
  }

  return normalizeReviewTextModel({ plain: plainChars.join(''), styles });
}

function styleSignature(style: ReviewCharStyle): string {
  return `${style.size ?? ''}`;
}

export function serializeReviewTextModel(model: ReviewTextModel): string {
  const { plain, styles } = model;
  if (!plain) return '';

  type Run = { text: string; style: ReviewCharStyle };
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
      if (run.style.size) {
        chunk = `${sizeOpenTag(run.style.size)}${chunk}${sizeCloseTag(run.style.size)}`;
      }
      return chunk;
    })
    .join('');
}

function migrateLegacyImages(raw: string): string {
  return raw.replace(LEGACY_IMAGE_RE, (_match, uri: string) => `\n[[img:${uri}]]\n`);
}

export function parseReviewFieldContent(raw: string): ReviewFieldModel {
  const normalized = migrateLegacyImages(raw ?? '');
  if (!normalized.trim()) return emptyReviewFieldModel();

  const blocks: ReviewBlock[] = [];
  let lastIndex = 0;
  const re = new RegExp(IMAGE_MARKER_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(normalized)) != null) {
    const textPart = normalized.slice(lastIndex, match.index);
    if (textPart.length > 0) {
      blocks.push({ kind: 'text', model: parseReviewTextBody(textPart) });
    }
    blocks.push({ kind: 'image', uri: match[1]! });
    lastIndex = match.index + match[0].length;
  }

  const tail = normalized.slice(lastIndex);
  if (tail.length > 0) {
    blocks.push({ kind: 'text', model: parseReviewTextBody(tail) });
  }

  if (blocks.length === 0) {
    return emptyReviewFieldModel();
  }
  return { blocks };
}

export function serializeReviewFieldContent(model: ReviewFieldModel): string {
  if (model.blocks.length === 0) return '';

  return model.blocks
    .map(block => {
      if (block.kind === 'image') return `\n[[img:${block.uri}]]\n`;
      return serializeReviewTextModel(block.model);
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

function splitPlainIntoLines(plain: string): { line: string; start: number }[] {
  if (!plain) return [{ line: '', start: 0 }];
  const lines: { line: string; start: number }[] = [];
  let start = 0;
  for (let i = 0; i <= plain.length; i++) {
    if (i === plain.length || plain[i] === '\n') {
      lines.push({ line: plain.slice(start, i), start });
      start = i + 1;
    }
  }
  return lines;
}

function stripTodoPrefix(text: string): { leading: string; checked: boolean; content: string } | null {
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trimmed = text.slice(leading.length);
  if (trimmed.startsWith('☐ ')) {
    return { leading, checked: false, content: trimmed.slice(2) };
  }
  if (trimmed.startsWith('☑ ')) {
    return { leading, checked: true, content: trimmed.slice(2) };
  }
  if (trimmed.startsWith('☐')) {
    return { leading, checked: false, content: trimmed.slice(1) };
  }
  if (trimmed.startsWith('☑')) {
    return { leading, checked: true, content: trimmed.slice(1) };
  }
  return null;
}

/** 退格删除待办前缀时，一次删掉整个 ☐/☑ 标记 */
function collapseTodoPrefixOnDelete(prevPlain: string, nextPlain: string): string {
  if (nextPlain.length >= prevPlain.length) return nextPlain;

  const prevLines = splitPlainIntoLines(prevPlain);
  const nextLines = splitPlainIntoLines(nextPlain);
  const parts: string[] = [];

  for (let i = 0; i < nextLines.length; i++) {
    const nextEntry = nextLines[i]!;
    const prevEntry = prevLines[i];
    let line = nextEntry.line;

    if (prevEntry && stripTodoPrefix(prevEntry.line) && !stripTodoPrefix(line)) {
      const leading = line.match(/^\s*/)?.[0] ?? '';
      const trimmed = line.slice(leading.length);
      line = leading + trimmed.replace(/^(☐|☑)\s?/, '');
    }

    parts.push(line);
  }

  return parts.join('\n');
}

function mergeAdjacentTextBlocks(blocks: ReviewBlock[]): ReviewBlock[] {
  const result: ReviewBlock[] = [];
  for (const block of blocks) {
    if (block.kind === 'image') {
      result.push(block);
      continue;
    }
    const last = result[result.length - 1];
    if (last?.kind === 'text') {
      result[result.length - 1] = {
        kind: 'text',
        model: normalizeReviewTextModel({
          plain: last.model.plain + block.model.plain,
          styles: [...last.model.styles, ...block.model.styles],
        }),
      };
    } else {
      result.push(block);
    }
  }
  return result.length > 0 ? result : emptyReviewFieldModel().blocks;
}

export function updateReviewTextModelPlain(model: ReviewTextModel, nextPlain: string): ReviewTextModel {
  if (nextPlain === model.plain) return model;
  const normalizedPlain = collapseTodoPrefixOnDelete(model.plain, nextPlain);
  if (normalizedPlain === model.plain) return model;
  const { start, removed, added } = textDiff(model.plain, normalizedPlain);
  const inherit: ReviewCharStyle =
    start > 0
      ? { ...(model.styles[start - 1] ?? {}) }
      : added > 0 && start < model.styles.length
        ? { ...(model.styles[start] ?? {}) }
        : {};
  const nextStyles = [...model.styles];
  const inserts = Array.from({ length: added }, () => ({ ...inherit }));
  nextStyles.splice(start, removed, ...inserts);
  return normalizeReviewTextModel({ plain: normalizedPlain, styles: nextStyles });
}

function lineBounds(text: string, index: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const nextNl = text.indexOf('\n', index);
  const end = nextNl === -1 ? text.length : nextNl;
  return { start, end };
}

function nextFontSize(current?: ReviewFontSize): ReviewFontSize | undefined {
  if (!current) return REVIEW_FONT_SIZES[0];
  const idx = REVIEW_FONT_SIZES.indexOf(current);
  if (idx < 0 || idx >= REVIEW_FONT_SIZES.length - 1) return undefined;
  return REVIEW_FONT_SIZES[idx + 1];
}

export function applyFontSizeToTextModel(
  model: ReviewTextModel,
  selection: TextSelection,
): { model: ReviewTextModel; selection: TextSelection } {
  const { start, end } = selection;
  if (start >= end) return { model, selection };

  const currentSizes = model.styles.slice(start, end).map(s => s.size);
  const allSame = currentSizes.every(s => s === currentSizes[0]);
  const nextSize = allSame ? nextFontSize(currentSizes[0]) : REVIEW_FONT_SIZES[0];

  const nextStyles = [...model.styles];
  for (let i = start; i < end; i++) {
    const cur = { ...(nextStyles[i] ?? {}) };
    if (nextSize) cur.size = nextSize;
    else delete cur.size;
    nextStyles[i] = cur;
  }

  return {
    model: { plain: model.plain, styles: nextStyles },
    selection,
  };
}

export function insertTextIntoTextModel(
  model: ReviewTextModel,
  selection: TextSelection,
  insert: string,
): { model: ReviewTextModel; selection: TextSelection } {
  const start = selection.start;
  const end = selection.end;
  const nextPlain = model.plain.slice(0, start) + insert + model.plain.slice(end);
  const nextModel = updateReviewTextModelPlain(
    {
      plain: model.plain.slice(0, start) + model.plain.slice(end),
      styles: [...model.styles.slice(0, start), ...model.styles.slice(end)],
    },
    nextPlain,
  );
  const pos = start + insert.length;
  return { model: nextModel, selection: { start: pos, end: pos } };
}

export function toggleTodoAtSelection(
  model: ReviewTextModel,
  selection: TextSelection,
): { model: ReviewTextModel; selection: TextSelection } {
  const caret = selection.start;
  const { start: lineStart, end: lineEnd } = lineBounds(model.plain, caret);
  const line = model.plain.slice(lineStart, lineEnd);
  const todo = stripTodoPrefix(line);

  let nextLine: string;
  if (!todo) {
    const leading = line.match(/^\s*/)?.[0] ?? '';
    const trimmed = line.slice(leading.length);
    nextLine = leading + '☐' + trimmed;
  } else if (!todo.checked) {
    nextLine = todo.leading + '☑' + todo.content;
  } else {
    nextLine = todo.leading + todo.content;
  }

  const nextPlain = model.plain.slice(0, lineStart) + nextLine + model.plain.slice(lineEnd);
  const nextModel = updateReviewTextModelPlain(model, nextPlain);
  const delta = nextLine.length - line.length;
  const nextCaret = Math.max(lineStart, Math.min(caret + delta, lineStart + nextLine.length));
  return { model: nextModel, selection: { start: nextCaret, end: nextCaret } };
}

export function toggleTodoCheckedAtLineStart(
  model: ReviewTextModel,
  markerStart: number,
): { model: ReviewTextModel; selection: TextSelection } {
  const { start: lineStart, end: lineEnd } = lineBounds(model.plain, markerStart);
  const line = model.plain.slice(lineStart, lineEnd);
  const todo = stripTodoPrefix(line);
  if (!todo) {
    return { model, selection: { start: markerStart, end: markerStart } };
  }

  const marker = todo.checked ? '☐' : '☑';
  const nextLine = todo.leading + marker + todo.content;
  const nextPlain = model.plain.slice(0, lineStart) + nextLine + model.plain.slice(lineEnd);
  const nextModel = updateReviewTextModelPlain(model, nextPlain);
  const delta = nextLine.length - line.length;
  const nextCaret = Math.max(lineStart, Math.min(markerStart + delta, lineStart + nextLine.length));
  return { model: nextModel, selection: { start: nextCaret, end: nextCaret } };
}

export function toggleTodoAtLineStart(
  model: ReviewTextModel,
  lineStart: number,
): { model: ReviewTextModel; selection: TextSelection } {
  return toggleTodoAtSelection(model, { start: lineStart, end: lineStart });
}

export function getNowTimeText() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

export function currentFontSizeLabel(model: ReviewTextModel, selection: TextSelection): ReviewFontSize {
  if (selection.start < selection.end) {
    const size = model.styles[selection.start]?.size;
    if (size) return size;
  }
  return REVIEW_FONT_SIZES[0]!;
}

export function insertImageBlock(
  fieldModel: ReviewFieldModel,
  blockIndex: number,
  selection: TextSelection,
  uri: string,
): { model: ReviewFieldModel; focusBlockIndex: number; selection: TextSelection } {
  const block = fieldModel.blocks[blockIndex];
  if (!block || block.kind !== 'text') {
    const nextBlocks = [...fieldModel.blocks, { kind: 'image' as const, uri }, { kind: 'text' as const, model: emptyReviewTextModel() }];
    return {
      model: { blocks: nextBlocks },
      focusBlockIndex: nextBlocks.length - 1,
      selection: { start: 0, end: 0 },
    };
  }

  const { start, end } = selection;
  const beforePlain = block.model.plain.slice(0, start);
  const afterPlain = block.model.plain.slice(end);
  const beforeStyles = block.model.styles.slice(0, start);
  const afterStyles = block.model.styles.slice(end);

  const nextBlocks = [...fieldModel.blocks];
  const insertAt = blockIndex;
  const replacement: ReviewBlock[] = [
    { kind: 'text', model: normalizeReviewTextModel({ plain: beforePlain, styles: beforeStyles }) },
    { kind: 'image', uri },
    { kind: 'text', model: normalizeReviewTextModel({ plain: afterPlain, styles: afterStyles }) },
  ];

  const merged = replacement.filter((b, idx, arr) => {
    if (b.kind === 'image') return true;
    if (b.model.plain.length > 0) return true;
    return idx === arr.length - 1;
  });

  nextBlocks.splice(insertAt, 1, ...merged);

  const cleaned =
    nextBlocks.length > 0
      ? nextBlocks
      : [{ kind: 'text' as const, model: emptyReviewTextModel() }];

  const focusBlockIndex = Math.min(insertAt + merged.length - 1, cleaned.length - 1);
  return {
    model: { blocks: cleaned },
    focusBlockIndex,
    selection: { start: 0, end: 0 },
  };
}

export function removeImageBlock(
  fieldModel: ReviewFieldModel,
  blockIndex: number,
): { model: ReviewFieldModel; focusBlockIndex: number; selection: TextSelection } {
  const block = fieldModel.blocks[blockIndex];
  if (!block || block.kind !== 'image') {
    return {
      model: fieldModel,
      focusBlockIndex: blockIndex,
      selection: { start: 0, end: 0 },
    };
  }

  const nextBlocks = fieldModel.blocks.filter((_, idx) => idx !== blockIndex);
  const cleaned = mergeAdjacentTextBlocks(nextBlocks);

  let focusBlockIndex = blockIndex - 1;
  while (focusBlockIndex >= 0 && cleaned[focusBlockIndex]?.kind !== 'text') {
    focusBlockIndex -= 1;
  }
  if (focusBlockIndex < 0) {
    focusBlockIndex = cleaned.findIndex(b => b.kind === 'text');
  }
  if (focusBlockIndex < 0) focusBlockIndex = 0;

  const focusBlock = cleaned[focusBlockIndex];
  const caret =
    focusBlock?.kind === 'text' ? focusBlock.model.plain.length : 0;

  return {
    model: { blocks: cleaned },
    focusBlockIndex,
    selection: { start: caret, end: caret },
  };
}

export function reviewContentToPlainPreview(raw: string): string {
  return parseReviewFieldContent(raw)
    .blocks.map(block => {
      if (block.kind === 'image') return '[图片]';
      return block.model.plain.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean)
    .join(' ');
}
