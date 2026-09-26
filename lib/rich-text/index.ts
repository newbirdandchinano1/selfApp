export type {
  RichBlock,
  RichCharStyle,
  RichFieldModel,
  RichTextModel,
  TextSelection,
} from './types';

export {
  collectStyleRuns,
  emptyRichTextModel,
  forEachStyleRun,
  insertTextIntoTextModel,
  lineBounds,
  normalizeRichTextModel,
  styleSignature,
  textDiff,
  toggleStyleOnRange,
  updateRichTextModelPlain,
  type StyleRun,
  type UpdatePlainOptions,
} from './model';

export {
  parseMarkupToModel,
  serializeModelToMarkup,
  type MarkupProfile,
  type MarkupTagMatch,
} from './markup';

export {
  emptyRichFieldModel,
  fieldContentToPlainDisplay,
  fieldContentToPlainPreview,
  insertImageBlock,
  mergeAdjacentTextBlocks,
  parseFieldContent,
  removeImageBlock,
  serializeFieldContent,
} from './field';

export {
  collapseTodoPrefixOnDelete,
  splitPlainIntoLines,
  stripTodoPrefix,
  TODO_CHECKED,
  TODO_UNCHECKED,
  toggleTodoAtLineStart,
  toggleTodoAtSelection,
  toggleTodoCheckedAtLineStart,
  updateRichTextModelPlainWithTodos,
} from './todo';
