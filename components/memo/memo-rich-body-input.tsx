import type { CharStyle, MemoEditModel } from '@/lib/memo-format';
import React, { useMemo } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
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

function segmentFontSize(style: CharStyle, baseSize: number): number {
  if (style.size === 'small') return Math.max(12, baseSize - 3);
  if (style.size === 'large') return baseSize + 4;
  return baseSize;
}

/** 在 TextInput 内嵌套 Text，让光标与可见字形共用同一套原生排版，避免透明层叠方案错位 */
function buildStyledChildren(model: MemoEditModel, textColor: string): React.ReactNode {
  const { plain, styles: charStyles } = model;
  if (!plain) return null;

  const out: React.ReactNode[] = [];
  let runStart = 0;
  const sigAt = (i: number) => {
    const s = charStyles[i] ?? {};
    return `${s.bold ? 'b' : ''}|${s.size ?? ''}`;
  };

  const flush = (end: number) => {
    if (end <= runStart) return;
    const style = charStyles[runStart] ?? {};
    const size = segmentFontSize(style, BASE_SIZE);
    out.push(
      <Text
        key={`${runStart}-${end}`}
        style={{
          fontSize: size,
          lineHeight: BASE_LINE,
          fontWeight: style.bold ? '800' : '600',
          color: textColor,
        }}
      >
        {plain.slice(runStart, end)}
      </Text>,
    );
    runStart = end;
  };

  for (let i = 1; i <= plain.length; i++) {
    if (i === plain.length || sigAt(i - 1) !== sigAt(i)) {
      flush(i);
    }
  }

  return (
    <Text style={[styles.textBase, { color: textColor }]}>
      {out}
    </Text>
  );
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
    () => buildStyledChildren(model, textColor),
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
