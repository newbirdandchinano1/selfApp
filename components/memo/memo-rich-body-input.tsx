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

function MemoEditOverlay({
  model,
  textColor,
  placeholderColor,
  placeholder,
}: {
  model: MemoEditModel;
  textColor: string;
  placeholderColor: string;
  placeholder?: string;
}) {
  const nodes = useMemo(() => {
    const { plain, styles } = model;
    if (!plain) return null;

    const out: React.ReactNode[] = [];
    let runStart = 0;
    const sigAt = (i: number) => {
      const s = styles[i] ?? {};
      return `${s.bold ? 'b' : ''}|${s.size ?? ''}`;
    };

    const flush = (end: number) => {
      if (end <= runStart) return;
      const style = styles[runStart] ?? {};
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
    return out;
  }, [model, textColor]);

  if (!model.plain) {
    return (
      <Text style={overlayStyles.base}>
        <Text style={{ color: placeholderColor, fontWeight: '600' }}>{placeholder}</Text>
      </Text>
    );
  }

  return <Text style={overlayStyles.base}>{nodes}</Text>;
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
  return (
    <View style={[styles.wrap, containerStyle]}>
      <View style={styles.overlay} pointerEvents="none">
        <MemoEditOverlay
          model={model}
          textColor={textColor}
          placeholderColor={placeholderColor}
          placeholder={placeholder}
        />
      </View>
      <TextInput
        value={model.plain}
        onChangeText={onChangePlain}
        onSelectionChange={e => onSelectionChange(e.nativeEvent.selection)}
        selection={controlledSelection}
        placeholder=""
        multiline
        textAlignVertical="top"
        cursorColor={caretColor}
        selectionColor={caretColor}
        style={[
          styles.input,
          inputStyle,
          {
            color: Platform.OS === 'ios' ? 'transparent' : 'rgba(0,0,0,0.01)',
            caretColor,
          },
        ]}
      />
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  base: {
    fontSize: BASE_SIZE,
    lineHeight: BASE_LINE,
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  input: {
    fontSize: BASE_SIZE,
    lineHeight: BASE_LINE,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingVertical: 14,
    margin: 0,
    textAlignVertical: 'top',
  },
});
