export type TextSelection = { start: number; end: number };

/** size 为不透明 token，由 Markup Profile 解释（如 'small' | 'large' | 15 | 17 …） */
export type RichCharStyle = {
  bold?: boolean;
  size?: string | number;
};

export type RichTextModel = {
  plain: string;
  styles: RichCharStyle[];
};

export type RichBlock =
  | { kind: 'text'; model: RichTextModel }
  | { kind: 'image'; uri: string };

export type RichFieldModel = {
  blocks: RichBlock[];
};
