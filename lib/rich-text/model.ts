import type { RichCharStyle, RichTextModel, TextSelection } from './types';

export function emptyRichTextModel(): RichTextModel {
  return { plain: '', styles: [] };
}

export function normalizeRichTextModel(model: RichTextModel): RichTextModel {
  const styles = [...model.styles];
  while (styles.length < model.plain.length) styles.push({});
  if (styles.length > model.plain.length) styles.length = model.plain.length;
  return { plain: model.plain, styles };
}

export function styleSignature(style: RichCharStyle): string {
  return `${style.bold ? 'b' : ''}|${style.size ?? ''}`;
}

export function textDiff(
  oldText: string,
  newText: string,
): { start: number; removed: number; added: number } {
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

export type UpdatePlainOptions = {
  /** 写入前对 nextPlain 做规范化（如复盘待办前缀折叠） */
  normalizePlain?: (prevPlain: string, nextPlain: string) => string;
};

export function updateRichTextModelPlain(
  model: RichTextModel,
  nextPlain: string,
  options?: UpdatePlainOptions,
): RichTextModel {
  const normalizedPlain = options?.normalizePlain
    ? options.normalizePlain(model.plain, nextPlain)
    : nextPlain;
  if (normalizedPlain === model.plain) return model;
  const { start, removed, added } = textDiff(model.plain, normalizedPlain);
  const inherit: RichCharStyle =
    start > 0
      ? { ...(model.styles[start - 1] ?? {}) }
      : added > 0 && start < model.styles.length
        ? { ...(model.styles[start] ?? {}) }
        : {};
  const nextStyles = [...model.styles];
  const inserts = Array.from({ length: added }, () => ({ ...inherit }));
  nextStyles.splice(start, removed, ...inserts);
  return normalizeRichTextModel({ plain: normalizedPlain, styles: nextStyles });
}

export function lineBounds(text: string, index: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const nextNl = text.indexOf('\n', index);
  const end = nextNl === -1 ? text.length : nextNl;
  return { start, end };
}

export function toggleStyleOnRange(
  styles: RichCharStyle[],
  start: number,
  end: number,
  patch: Partial<RichCharStyle>,
  isActive: (style: RichCharStyle) => boolean,
): RichCharStyle[] {
  if (start >= end) return styles;
  const next = [...styles];
  const active = next.slice(start, end).every(isActive);
  for (let i = start; i < end; i++) {
    const cur = { ...(next[i] ?? {}) };
    if (active) {
      if (patch.bold) delete cur.bold;
      if (patch.size !== undefined) delete cur.size;
    } else {
      if (patch.bold) cur.bold = true;
      if (patch.size !== undefined) cur.size = patch.size;
    }
    next[i] = cur;
  }
  return next;
}

export type StyleRun = { text: string; style: RichCharStyle; start: number; end: number };

export function forEachStyleRun(
  model: RichTextModel,
  from: number,
  to: number,
  visit: (run: StyleRun) => void,
): void {
  if (from >= to) return;
  let runStart = from;
  for (let i = from + 1; i <= to; i++) {
    const prev = model.styles[i - 1] ?? {};
    const cur = model.styles[i] ?? {};
    if (i === to || styleSignature(prev) !== styleSignature(cur)) {
      visit({
        text: model.plain.slice(runStart, i),
        style: model.styles[runStart] ?? {},
        start: runStart,
        end: i,
      });
      runStart = i;
    }
  }
}

export function collectStyleRuns(model: RichTextModel): StyleRun[] {
  const runs: StyleRun[] = [];
  forEachStyleRun(model, 0, model.plain.length, run => runs.push(run));
  return runs;
}

export function insertTextIntoTextModel(
  model: RichTextModel,
  selection: TextSelection,
  insert: string,
  options?: UpdatePlainOptions,
): { model: RichTextModel; selection: TextSelection } {
  const start = selection.start;
  const end = selection.end;
  const nextPlain = model.plain.slice(0, start) + insert + model.plain.slice(end);
  const nextModel = updateRichTextModelPlain(
    {
      plain: model.plain.slice(0, start) + model.plain.slice(end),
      styles: [...model.styles.slice(0, start), ...model.styles.slice(end)],
    },
    nextPlain,
    options,
  );
  const pos = start + insert.length;
  return { model: nextModel, selection: { start: pos, end: pos } };
}
