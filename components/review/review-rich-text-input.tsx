import { buildStyledRunNodes } from '@/components/rich-text/build-styled-runs';
import type { ReviewCharStyle, ReviewFontSize, ReviewTextModel, TextSelection } from '@/lib/review-journal-format';
import { REVIEW_FONT_SIZES } from '@/lib/review-journal-format';
import type { RichCharStyle } from '@/lib/rich-text/index';
import { splitPlainIntoLines, TODO_CHECKED, TODO_UNCHECKED } from '@/lib/rich-text/index';
import React, { useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

type Props = {
  model: ReviewTextModel;
  onChangePlain: (plain: string) => void;
  onSelectionChange: (selection: TextSelection) => void;
  onToggleTodoLine: (lineStart: number) => void;
  onFocus?: () => void;
  controlledSelection?: TextSelection;
  placeholder?: string;
  editable?: boolean;
  textColor: string;
  placeholderColor: string;
  caretColor: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

const BASE_SIZE: ReviewFontSize = REVIEW_FONT_SIZES[0]!;
const BASE_LINE = BASE_SIZE * 1.55;

function resolveReviewFontSize(style: RichCharStyle): number {
  return (style.size as ReviewCharStyle['size'] | undefined) ?? BASE_SIZE;
}

type LinePart =
  | {
      kind: 'todo';
      checked: boolean;
      text: string;
      plainStart: number;
      todoMarkerStart: number;
      /** 原文是否为「☐ 」/「☑ 」（含空格），须与 TextInput 逐字对齐 */
      markerWithSpace: boolean;
      leading: string;
    }
  | { kind: 'text'; text: string; plainStart: number };

function parseLineParts(line: string, lineStart: number): LinePart[] {
  const leading = line.match(/^\s*/)?.[0] ?? '';
  const trimmed = line.slice(leading.length);

  if (trimmed.startsWith(`${TODO_UNCHECKED} `)) {
    return [{
      kind: 'todo',
      checked: false,
      text: trimmed.slice(2),
      plainStart: lineStart + leading.length + 2,
      todoMarkerStart: lineStart + leading.length,
      markerWithSpace: true,
      leading,
    }];
  }
  if (trimmed.startsWith(`${TODO_CHECKED} `)) {
    return [{
      kind: 'todo',
      checked: true,
      text: trimmed.slice(2),
      plainStart: lineStart + leading.length + 2,
      todoMarkerStart: lineStart + leading.length,
      markerWithSpace: true,
      leading,
    }];
  }
  if (trimmed.startsWith(TODO_UNCHECKED)) {
    return [{
      kind: 'todo',
      checked: false,
      text: trimmed.slice(1),
      plainStart: lineStart + leading.length + 1,
      todoMarkerStart: lineStart + leading.length,
      markerWithSpace: false,
      leading,
    }];
  }
  if (trimmed.startsWith(TODO_CHECKED)) {
    return [{
      kind: 'todo',
      checked: true,
      text: trimmed.slice(1),
      plainStart: lineStart + leading.length + 1,
      todoMarkerStart: lineStart + leading.length,
      markerWithSpace: false,
      leading,
    }];
  }

  return [{ kind: 'text', text: line, plainStart: lineStart }];
}

function ReviewEditOverlay({
  model,
  textColor,
  placeholderColor,
  placeholder,
  caretColor,
}: {
  model: ReviewTextModel;
  textColor: string;
  placeholderColor: string;
  placeholder?: string;
  caretColor: string;
}) {
  const lines = useMemo(() => splitPlainIntoLines(model.plain), [model.plain]);
  const runTheme = useMemo(
    () => ({
      textColor,
      resolveFontSize: resolveReviewFontSize,
      resolveLineHeight: (size: number) => size * 1.55,
      resolveFontWeight: () => '500' as const,
    }),
    [textColor],
  );

  if (!model.plain) {
    return (
      <Text style={[overlayStyles.base, { lineHeight: BASE_LINE }]}>
        <Text style={{ color: placeholderColor, fontWeight: '500' }}>{placeholder}</Text>
      </Text>
    );
  }

  return (
    <View style={overlayStyles.root}>
      {lines.map(({ line, start }, lineIndex) => {
        const parts = parseLineParts(line, start);
        return (
          <View key={`line-${lineIndex}-${start}`} style={overlayStyles.lineRow}>
            {parts.map((part, partIndex) => {
              if (part.kind === 'todo') {
                const markerChar = part.checked ? TODO_CHECKED : TODO_UNCHECKED;
                const marker = `${markerChar}${part.markerWithSpace ? ' ' : ''}`;
                return (
                  <Text
                    key={`todo-${partIndex}`}
                    style={[
                      overlayStyles.base,
                      {
                        lineHeight: BASE_LINE,
                        color: textColor,
                        textDecorationLine: part.checked ? 'line-through' : 'none',
                        opacity: part.checked ? 0.65 : 1,
                      },
                    ]}
                  >
                    {part.leading
                      ? buildStyledRunNodes(model, part.leading, start, runTheme)
                      : null}
                    <Text
                      style={{
                        fontSize: BASE_SIZE,
                        lineHeight: BASE_LINE,
                        fontWeight: '500',
                        color: part.checked ? caretColor : textColor,
                        textDecorationLine: 'none',
                        opacity: 1,
                      }}
                    >
                      {marker}
                    </Text>
                    {buildStyledRunNodes(model, part.text, part.plainStart, runTheme)}
                  </Text>
                );
              }

              return (
                <Text
                  key={`text-${partIndex}`}
                  style={[overlayStyles.base, { lineHeight: BASE_LINE, color: textColor }]}
                >
                  {buildStyledRunNodes(model, part.text, part.plainStart, runTheme)}
                </Text>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

type TodoHitTarget = {
  lineStart: number;
  markerStart: number;
  lineIndex: number;
};

function collectTodoHitTargets(plain: string): TodoHitTarget[] {
  const lines = splitPlainIntoLines(plain);
  const targets: TodoHitTarget[] = [];
  lines.forEach(({ line, start }, lineIndex) => {
    const leading = line.match(/^\s*/)?.[0] ?? '';
    const trimmed = line.slice(leading.length);
    const isTodo =
      trimmed.startsWith(`${TODO_UNCHECKED} `) ||
      trimmed.startsWith(`${TODO_CHECKED} `) ||
      trimmed.startsWith(TODO_UNCHECKED) ||
      trimmed.startsWith(TODO_CHECKED);
    if (isTodo) {
      targets.push({ lineStart: start, markerStart: start + leading.length, lineIndex });
    }
  });
  return targets;
}

export function ReviewRichTextInput({
  model,
  onChangePlain,
  onSelectionChange,
  onToggleTodoLine,
  onFocus,
  controlledSelection,
  placeholder,
  editable = true,
  textColor,
  placeholderColor,
  caretColor,
  containerStyle,
  inputStyle,
}: Props) {
  const todoTargets = useMemo(() => collectTodoHitTargets(model.plain), [model.plain]);

  return (
    <View style={[styles.wrap, containerStyle]}>
      <View style={[styles.overlay, inputStyle as StyleProp<ViewStyle>]} pointerEvents="none">
        <ReviewEditOverlay
          model={model}
          textColor={textColor}
          placeholderColor={placeholderColor}
          placeholder={placeholder}
          caretColor={caretColor}
        />
      </View>
      <TextInput
        value={model.plain}
        onChangeText={onChangePlain}
        onSelectionChange={e => onSelectionChange(e.nativeEvent.selection)}
        onFocus={onFocus}
        selection={controlledSelection}
        placeholder=""
        editable={editable}
        multiline
        textAlignVertical="top"
        cursorColor={caretColor}
        selectionColor={caretColor}
        style={[
          styles.input,
          inputStyle,
          {
            color: Platform.OS === 'ios' ? 'transparent' : 'rgba(0,0,0,0.01)',
            // @ts-expect-error RN web caretColor
            caretColor,
          },
        ]}
      />
      {editable ? (
        <View style={[styles.todoHitLayer, inputStyle as StyleProp<ViewStyle>]} pointerEvents="box-none">
          {todoTargets.map(target => (
            <Pressable
              key={`todo-hit-${target.markerStart}`}
              hitSlop={6}
              onPress={() => onToggleTodoLine(target.markerStart)}
              style={[
                styles.todoHitBtn,
                { top: target.lineIndex * BASE_LINE },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  root: { gap: 0 },
  lineRow: {
    minHeight: BASE_LINE,
    justifyContent: 'center',
  },
  base: {
    fontSize: BASE_SIZE,
    fontWeight: '500',
  },
});

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  input: {
    fontSize: BASE_SIZE,
    lineHeight: BASE_LINE,
    fontWeight: '500',
    margin: 0,
    textAlignVertical: 'top',
  },
  todoHitLayer: {
    ...StyleSheet.absoluteFill,
  },
  todoHitBtn: {
    position: 'absolute',
    left: 0,
    width: 28,
    height: BASE_LINE,
  },
});
