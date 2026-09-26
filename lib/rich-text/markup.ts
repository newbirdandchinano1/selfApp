import { collectStyleRuns, normalizeRichTextModel } from './model';
import type { RichCharStyle, RichTextModel } from './types';

export type MarkupTagMatch =
  | { kind: 'push'; style: RichCharStyle; length: number }
  | { kind: 'pop'; pred: (s: RichCharStyle) => boolean; length: number }
  | {
      kind: 'skipSpan';
      /** 跳过标记，把中间字符按当前 stack 样式写入 plain（不应用 span 自身样式） */
      contentStart: number;
      contentEnd: number;
      totalLength: number;
    };

export type MarkupProfile = {
  /** 在 body[i] 处匹配标签；可看当前 stack（如 ** toggle）；未匹配返回 null */
  matchTagAt: (body: string, i: number, stack: RichCharStyle[]) => MarkupTagMatch | null;
  /** 将一段同样式 run 包成存盘标记 */
  wrapRun: (text: string, style: RichCharStyle) => string;
  /** 合并 stack 上的样式（默认合并 bold + size） */
  mergeStyles?: (stack: RichCharStyle[]) => RichCharStyle;
};

function findLastStackIndex(stack: RichCharStyle[], pred: (s: RichCharStyle) => boolean): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (pred(stack[i]!)) return i;
  }
  return -1;
}

function defaultMergeStyles(stack: RichCharStyle[]): RichCharStyle {
  const out: RichCharStyle = {};
  for (const s of stack) {
    if (s.bold) out.bold = true;
    if (s.size !== undefined) out.size = s.size;
  }
  return out;
}

export function parseMarkupToModel(body: string, profile: MarkupProfile): RichTextModel {
  const plainChars: string[] = [];
  const styles: RichCharStyle[] = [];
  const stack: RichCharStyle[] = [];
  const merge = profile.mergeStyles ?? defaultMergeStyles;
  let i = 0;

  while (i < body.length) {
    const match = profile.matchTagAt(body, i, stack);
    if (match) {
      if (match.kind === 'push') {
        stack.push(match.style);
        i += match.length;
        continue;
      }
      if (match.kind === 'pop') {
        const idx = findLastStackIndex(stack, match.pred);
        if (idx >= 0) stack.splice(idx, 1);
        i += match.length;
        continue;
      }
      const current = merge(stack);
      for (let j = match.contentStart; j < match.contentEnd; j++) {
        plainChars.push(body[j]!);
        styles.push({ ...current });
      }
      i += match.totalLength;
      continue;
    }

    plainChars.push(body[i]!);
    styles.push(merge(stack));
    i += 1;
  }

  return normalizeRichTextModel({ plain: plainChars.join(''), styles });
}

export function serializeModelToMarkup(model: RichTextModel, profile: MarkupProfile): string {
  if (!model.plain) return '';
  return collectStyleRuns(model)
    .map(run => profile.wrapRun(run.text, run.style))
    .join('');
}
