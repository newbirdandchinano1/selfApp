import { lineBounds, updateRichTextModelPlain } from './model';
import type { RichTextModel, TextSelection } from './types';

export const TODO_UNCHECKED = '\u2610'; // ☐
export const TODO_CHECKED = '\u2611'; // ☑

export function splitPlainIntoLines(plain: string): { line: string; start: number }[] {
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

export function stripTodoPrefix(
  text: string,
): { leading: string; checked: boolean; content: string } | null {
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trimmed = text.slice(leading.length);
  if (trimmed.startsWith(`${TODO_UNCHECKED} `)) {
    return { leading, checked: false, content: trimmed.slice(2) };
  }
  if (trimmed.startsWith(`${TODO_CHECKED} `)) {
    return { leading, checked: true, content: trimmed.slice(2) };
  }
  if (trimmed.startsWith(TODO_UNCHECKED)) {
    return { leading, checked: false, content: trimmed.slice(1) };
  }
  if (trimmed.startsWith(TODO_CHECKED)) {
    return { leading, checked: true, content: trimmed.slice(1) };
  }
  return null;
}

/** 退格删除待办前缀时，一次删掉整个 ☐/☑ 标记 */
export function collapseTodoPrefixOnDelete(prevPlain: string, nextPlain: string): string {
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
      line = leading + trimmed.replace(new RegExp(`^(${TODO_UNCHECKED}|${TODO_CHECKED})\\s?`), '');
    }

    parts.push(line);
  }

  return parts.join('\n');
}

export function updateRichTextModelPlainWithTodos(
  model: RichTextModel,
  nextPlain: string,
): RichTextModel {
  return updateRichTextModelPlain(model, nextPlain, {
    normalizePlain: collapseTodoPrefixOnDelete,
  });
}

export function toggleTodoAtSelection(
  model: RichTextModel,
  selection: TextSelection,
): { model: RichTextModel; selection: TextSelection } {
  const caret = selection.start;
  const { start: lineStart, end: lineEnd } = lineBounds(model.plain, caret);
  const line = model.plain.slice(lineStart, lineEnd);
  const todo = stripTodoPrefix(line);

  let nextLine: string;
  if (!todo) {
    const leading = line.match(/^\s*/)?.[0] ?? '';
    const trimmed = line.slice(leading.length);
    nextLine = leading + TODO_UNCHECKED + trimmed;
  } else if (!todo.checked) {
    nextLine = todo.leading + TODO_CHECKED + todo.content;
  } else {
    nextLine = todo.leading + todo.content;
  }

  const nextPlain = model.plain.slice(0, lineStart) + nextLine + model.plain.slice(lineEnd);
  const nextModel = updateRichTextModelPlainWithTodos(model, nextPlain);
  const delta = nextLine.length - line.length;
  const nextCaret = Math.max(lineStart, Math.min(caret + delta, lineStart + nextLine.length));
  return { model: nextModel, selection: { start: nextCaret, end: nextCaret } };
}

export function toggleTodoCheckedAtLineStart(
  model: RichTextModel,
  markerStart: number,
): { model: RichTextModel; selection: TextSelection } {
  const { start: lineStart, end: lineEnd } = lineBounds(model.plain, markerStart);
  const line = model.plain.slice(lineStart, lineEnd);
  const todo = stripTodoPrefix(line);
  if (!todo) {
    return { model, selection: { start: markerStart, end: markerStart } };
  }

  const marker = todo.checked ? TODO_UNCHECKED : TODO_CHECKED;
  const nextLine = todo.leading + marker + todo.content;
  const nextPlain = model.plain.slice(0, lineStart) + nextLine + model.plain.slice(lineEnd);
  const nextModel = updateRichTextModelPlainWithTodos(model, nextPlain);
  const delta = nextLine.length - line.length;
  const nextCaret = Math.max(lineStart, Math.min(markerStart + delta, lineStart + nextLine.length));
  return { model: nextModel, selection: { start: nextCaret, end: nextCaret } };
}

export function toggleTodoAtLineStart(
  model: RichTextModel,
  lineStart: number,
): { model: RichTextModel; selection: TextSelection } {
  return toggleTodoAtSelection(model, { start: lineStart, end: lineStart });
}
