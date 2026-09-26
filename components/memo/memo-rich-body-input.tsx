import { buildStyledChildren } from '@/components/rich-text/build-styled-runs';
import type { CharStyle, MemoEditModel } from '@/lib/memo-format';
import type { RichCharStyle } from '@/lib/rich-text/index';
import React, { useMemo } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

type Props = {
  model: MemoEditModel;
  onChangePlain: (plain: string) => void;
  onSelectionChange: (selection: { start: number; end: number }) => void;
  controlledSelection?: { start: number; end: number };
  placeholder?: string;
  textColor: string;
  placeholderColor: string;
  caretColor: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

const BASE_SIZE = 16;
const BASE_LINE = 24;

function resolveMemoFontSize(style: RichCharStyle): number {
  const size = style.size as CharStyle['size'] | undefined;
  if (size === 'small') return Math.max(12, BASE_SIZE - 3);
  if (size === 'large') return BASE_SIZE + 4;
  return BASE_SIZE;
}

export function MemoRichBodyInput({
  model,
  onChangePlain,
  onSelectionChange,
  controlledSelection,
  placeholder,
  textColor,
  placeholderColor,
  caretColor,
  containerStyle,
  inputStyle,
}: Props) {
  const children = useMemo(
    () =>
      buildStyledChildren(
        model,
        {
          textColor,
          resolveFontSize: resolveMemoFontSize,
          resolveLineHeight: () => BASE_LINE,
          resolveFontWeight: style => (style.bold ? '800' : '600'),
        },
        styles.textBase,
      ),
    [model, textColor],
  );

  return (
    <View style={[styles.wrap, containerStyle]}>
      <TextInput
        multiline
        textAlignVertical="top"
        onChangeText={onChangePlain}
        onSelectionChange={e => onSelectionChange(e.nativeEvent.selection)}
        {...(controlledSelection != null ? { selection: controlledSelection } : {})}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        cursorColor={caretColor}
        selectionColor={caretColor}
        underlineColorAndroid="transparent"
        scrollEnabled={false}
        style={[
          styles.input,
          inputStyle,
          {
            color: textColor,
            // @ts-expect-error RN web caretColor
            caretColor,
            ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
          },
        ]}
      >
        {children}
      </TextInput>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  textBase: {
    fontSize: BASE_SIZE,
    lineHeight: BASE_LINE,
    fontWeight: '600',
  },
  input: {
    fontSize: BASE_SIZE,
    lineHeight: BASE_LINE,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    margin: 0,
    textAlignVertical: 'top',
  },
});
