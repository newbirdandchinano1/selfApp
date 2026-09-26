import { emptyRichTextModel, normalizeRichTextModel } from './model';
import type { MarkupProfile } from './markup';
import { parseMarkupToModel, serializeModelToMarkup } from './markup';
import type { RichBlock, RichFieldModel, RichTextModel, TextSelection } from './types';

const IMAGE_MARKER_RE = /\n\[\[img:([^\]]+)\]\]\n/g;
const LEGACY_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

export function emptyRichFieldModel(): RichFieldModel {
  return { blocks: [{ kind: 'text', model: emptyRichTextModel() }] };
}

function migrateLegacyImages(raw: string): string {
  return raw.replace(LEGACY_IMAGE_RE, (_match, uri: string) => `\n[[img:${uri}]]\n`);
}

export function parseFieldContent(raw: string, textProfile: MarkupProfile): RichFieldModel {
  const normalized = migrateLegacyImages(raw ?? '');
  if (!normalized.trim()) return emptyRichFieldModel();

  const blocks: RichBlock[] = [];
  let lastIndex = 0;
  const re = new RegExp(IMAGE_MARKER_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(normalized)) != null) {
    const textPart = normalized.slice(lastIndex, match.index);
    if (textPart.length > 0) {
      blocks.push({ kind: 'text', model: parseMarkupToModel(textPart, textProfile) });
    }
    blocks.push({ kind: 'image', uri: match[1]! });
    lastIndex = match.index + match[0].length;
  }

  const tail = normalized.slice(lastIndex);
  if (tail.length > 0) {
    blocks.push({ kind: 'text', model: parseMarkupToModel(tail, textProfile) });
  }

  if (blocks.length === 0) {
    return emptyRichFieldModel();
  }
  return { blocks };
}

export function serializeFieldContent(model: RichFieldModel, textProfile: MarkupProfile): string {
  if (model.blocks.length === 0) return '';

  return model.blocks
    .map(block => {
      if (block.kind === 'image') return `\n[[img:${block.uri}]]\n`;
      return serializeModelToMarkup(block.model, textProfile);
    })
    .join('');
}

export function mergeAdjacentTextBlocks(blocks: RichBlock[]): RichBlock[] {
  const result: RichBlock[] = [];
  for (const block of blocks) {
    if (block.kind === 'image') {
      result.push(block);
      continue;
    }
    const last = result[result.length - 1];
    if (last?.kind === 'text') {
      result[result.length - 1] = {
        kind: 'text',
        model: normalizeRichTextModel({
          plain: last.model.plain + block.model.plain,
          styles: [...last.model.styles, ...block.model.styles],
        }),
      };
    } else {
      result.push(block);
    }
  }
  return result.length > 0 ? result : emptyRichFieldModel().blocks;
}

export function insertImageBlock(
  fieldModel: RichFieldModel,
  blockIndex: number,
  selection: TextSelection,
  uri: string,
): { model: RichFieldModel; focusBlockIndex: number; selection: TextSelection } {
  const block = fieldModel.blocks[blockIndex];
  if (!block || block.kind !== 'text') {
    const nextBlocks = [
      ...fieldModel.blocks,
      { kind: 'image' as const, uri },
      { kind: 'text' as const, model: emptyRichTextModel() },
    ];
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
  const replacement: RichBlock[] = [
    { kind: 'text', model: normalizeRichTextModel({ plain: beforePlain, styles: beforeStyles }) },
    { kind: 'image', uri },
    { kind: 'text', model: normalizeRichTextModel({ plain: afterPlain, styles: afterStyles }) },
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
      : [{ kind: 'text' as const, model: emptyRichTextModel() }];

  const focusBlockIndex = Math.min(insertAt + merged.length - 1, cleaned.length - 1);
  return {
    model: { blocks: cleaned },
    focusBlockIndex,
    selection: { start: 0, end: 0 },
  };
}

export function removeImageBlock(
  fieldModel: RichFieldModel,
  blockIndex: number,
): { model: RichFieldModel; focusBlockIndex: number; selection: TextSelection } {
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
  const caret = focusBlock?.kind === 'text' ? focusBlock.model.plain.length : 0;

  return {
    model: { blocks: cleaned },
    focusBlockIndex,
    selection: { start: caret, end: caret },
  };
}

export function fieldContentToPlainPreview(raw: string, textProfile: MarkupProfile): string {
  return parseFieldContent(raw, textProfile)
    .blocks.map(block => {
      if (block.kind === 'image') return '[图片]';
      return block.model.plain.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean)
    .join(' ');
}

/** 格子只读展示：保留用户换行，文本块之间用换行分隔 */
export function fieldContentToPlainDisplay(raw: string, textProfile: MarkupProfile): string {
  return parseFieldContent(raw, textProfile)
    .blocks.map(block => {
      if (block.kind === 'image') return '[图片]';
      return block.model.plain.replace(/\r\n/g, '\n');
    })
    .filter(Boolean)
    .join('\n')
    .trimEnd();
}

export type { RichTextModel };
