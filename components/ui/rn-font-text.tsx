/**
 * 全局 Text / TextInput：自动套用衣橱同款 Noto / Roboto Mono 字体包。
 * 由 babel-plugin-rn-app-fonts 替换 `react-native` 的同名导出。
 */
import React from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { resolveAppFontStyle } from '@/lib/resolve-app-font-style';

type TextRef = React.ElementRef<typeof RNText>;
type TextInputRef = React.ElementRef<typeof RNTextInput>;

export const Text = React.forwardRef<TextRef, TextProps>(function AppFontText(
  { style, ...rest },
  ref,
) {
  return <RNText ref={ref} {...rest} style={resolveAppFontStyle(style)} />;
});
Text.displayName = 'Text';

export const TextInput = React.forwardRef<TextInputRef, TextInputProps>(
  function AppFontTextInput({ style, ...rest }, ref) {
    return <RNTextInput ref={ref} {...rest} style={resolveAppFontStyle(style)} />;
  },
);
TextInput.displayName = 'TextInput';
