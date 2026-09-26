import type { RichCharStyle, RichTextModel } from '@/lib/rich-text/index';
import { styleSignature } from '@/lib/rich-text/index';
import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

export type StyledRunTheme = {
  textColor: string;
  resolveFontSize: (style: RichCharStyle) => number;
  resolveLineHeight?: (fontSize: number, style: RichCharStyle) => number;
  resolveFontWeight?: (style: RichCharStyle) => TextStyle['fontWeight'];
  resolveTextDecorationLine?: (style: RichCharStyle) => TextStyle['textDecorationLine'];
  resolveOpacity?: (style: RichCharStyle) => number;
  extraStyle?: StyleProp<TextStyle>;
};

/**
 * 按字符样式切 run，生成嵌套 Text 节点。
 * plainStart 用于从完整 model.styles 对齐子串（复盘按行切片时）。
 */
export function buildStyledRunNodes(
  model: RichTextModel,
  text: string,
  plainStart: number,
  theme: StyledRunTheme,
): React.ReactNode[] {
  if (!text) return [];

  const nodes: React.ReactNode[] = [];
  let runStart = 0;
  const sigAt = (absIndex: number) => styleSignature(model.styles[absIndex] ?? {});

  const flush = (end: number) => {
    if (end <= runStart) return;
    const absStart = plainStart + runStart;
    const style = model.styles[absStart] ?? {};
    const fontSize = theme.resolveFontSize(style);
    const lineHeight = theme.resolveLineHeight?.(fontSize, style) ?? fontSize * 1.5;
    nodes.push(
      <Text
        key={`${absStart}-${plainStart + end}`}
        style={[
          {
            fontSize,
            lineHeight,
            fontWeight: theme.resolveFontWeight?.(style) ?? '500',
            color: theme.textColor,
            textDecorationLine: theme.resolveTextDecorationLine?.(style),
            opacity: theme.resolveOpacity?.(style),
          },
          theme.extraStyle,
        ]}
      >
        {text.slice(runStart, end)}
      </Text>,
    );
    runStart = end;
  };

  for (let i = 1; i <= text.length; i++) {
    const prevAbs = plainStart + i - 1;
    const abs = plainStart + i;
    if (i === text.length || sigAt(prevAbs) !== sigAt(abs)) {
      flush(i);
    }
  }

  return nodes;
}

/** 整段 model 渲染为单个父 Text 包裹的 run 节点（备忘嵌套 TextInput 用） */
export function buildStyledChildren(
  model: RichTextModel,
  theme: StyledRunTheme,
  wrapperStyle?: StyleProp<TextStyle>,
): React.ReactNode {
  if (!model.plain) return null;
  return (
    <Text style={[{ color: theme.textColor }, wrapperStyle]}>
      {buildStyledRunNodes(model, model.plain, 0, theme)}
    </Text>
  );
}
