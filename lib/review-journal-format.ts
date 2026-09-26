import type {
  MarkupProfile,
  MarkupTagMatch,
  RichCharStyle,
  RichFieldModel,
  RichTextModel,
  TextSelection,
} from './rich-text/index';
import {
  emptyRichFieldModel,
  emptyRichTextModel,
  fieldContentToPlainDisplay,
  fieldContentToPlainPreview,
  insertImageBlock as insertRichImageBlock,
  normalizeRichTextModel,
  parseFieldContent,
  removeImageBlock as removeRichImageBlock,
  serializeFieldContent,
  serializeModelToMarkup,
  toggleTodoAtLineStart as toggleRichTodoAtLineStart,
  toggleTodoAtSelection as toggleRichTodoAtSelection,
  toggleTodoCheckedAtLineStart as toggleRichTodoCheckedAtLineStart,
  updateRichTextModelPlainWithTodos,
} from './rich-text/index';

export type { TextSelection };

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

function asReviewText(model: RichTextModel): ReviewTextModel {
  return model as ReviewTextModel;
}

function asRichText(model: ReviewTextModel): RichTextModel {
  return model as RichTextModel;
}

function asReviewField(model: RichFieldModel): ReviewFieldModel {
  return model as ReviewFieldModel;
}

function asRichField(model: ReviewFieldModel): RichFieldModel {
  return model as RichFieldModel;
}

function sizeOpenTag(size: ReviewFontSize): string {
  return `[${size}]`;
}

function sizeCloseTag(size: ReviewFontSize): string {
  return `[/${size}]`;
}

export const REVIEW_MARKUP_PROFILE: MarkupProfile = {
  matchTagAt(body, i): MarkupTagMatch | null {
    for (const size of REVIEW_FONT_SIZES) {
      const open = sizeOpenTag(size);
      const close = sizeCloseTag(size);
      if (body.startsWith(open, i)) {
        return { kind: 'push', style: { size }, length: open.length };
      }
      if (body.startsWith(close, i)) {
        return { kind: 'pop', pred: s => s.size === size, length: close.length };
      }
    }
    return null;
  },
  wrapRun(text, style) {
    let chunk = text;
    if (typeof style.size === 'number') {
      const size = style.size as ReviewFontSize;
      chunk = `${sizeOpenTag(size)}${chunk}${sizeCloseTag(size)}`;
    }
    return chunk;
  },
  mergeStyles(stack: RichCharStyle[]): RichCharStyle {
    const out: RichCharStyle = {};
    for (const s of stack) {
      if (s.size !== undefined) out.size = s.size;
    }
    return out;
  },
};

export function emptyReviewTextModel(): ReviewTextModel {
  return asReviewText(emptyRichTextModel());
}

export function emptyReviewFieldModel(): ReviewFieldModel {
  return asReviewField(emptyRichFieldModel());
}

export function normalizeReviewTextModel(model: ReviewTextModel): ReviewTextModel {
  return asReviewText(normalizeRichTextModel(asRichText(model)));
}

export function serializeReviewTextModel(model: ReviewTextModel): string {
  return serializeModelToMarkup(asRichText(model), REVIEW_MARKUP_PROFILE);
}

export function parseReviewFieldContent(raw: string): ReviewFieldModel {
  return asReviewField(parseFieldContent(raw, REVIEW_MARKUP_PROFILE));
}

export function serializeReviewFieldContent(model: ReviewFieldModel): string {
  return serializeFieldContent(asRichField(model), REVIEW_MARKUP_PROFILE);
}

export function updateReviewTextModelPlain(
  model: ReviewTextModel,
  nextPlain: string,
): ReviewTextModel {
  return asReviewText(updateRichTextModelPlainWithTodos(asRichText(model), nextPlain));
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
  const result = toggleRichTodoAtSelection(asRichText(model), selection);
  return { model: asReviewText(result.model), selection: result.selection };
}

export function toggleTodoCheckedAtLineStart(
  model: ReviewTextModel,
  markerStart: number,
): { model: ReviewTextModel; selection: TextSelection } {
  const result = toggleRichTodoCheckedAtLineStart(asRichText(model), markerStart);
  return { model: asReviewText(result.model), selection: result.selection };
}

export function toggleTodoAtLineStart(
  model: ReviewTextModel,
  lineStart: number,
): { model: ReviewTextModel; selection: TextSelection } {
  const result = toggleRichTodoAtLineStart(asRichText(model), lineStart);
  return { model: asReviewText(result.model), selection: result.selection };
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
  const result = insertRichImageBlock(asRichField(fieldModel), blockIndex, selection, uri);
  return {
    model: asReviewField(result.model),
    focusBlockIndex: result.focusBlockIndex,
    selection: result.selection,
  };
}

export function removeImageBlock(
  fieldModel: ReviewFieldModel,
  blockIndex: number,
): { model: ReviewFieldModel; focusBlockIndex: number; selection: TextSelection } {
  const result = removeRichImageBlock(asRichField(fieldModel), blockIndex);
  return {
    model: asReviewField(result.model),
    focusBlockIndex: result.focusBlockIndex,
    selection: result.selection,
  };
}

export function reviewContentToPlainPreview(raw: string): string {
  return fieldContentToPlainPreview(raw, REVIEW_MARKUP_PROFILE);
}

/** 格子只读展示：保留用户换行，文本块之间用换行分隔 */
export function reviewContentToPlainDisplay(raw: string): string {
  return fieldContentToPlainDisplay(raw, REVIEW_MARKUP_PROFILE);
}
