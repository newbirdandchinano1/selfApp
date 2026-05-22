import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export const RECIPE_LINE_ITEM_MAX = 200;
export const RECIPE_LINE_ITEMS_MAX = 80;

type Props = {
  label: string;
  hint?: string;
  lines: string[];
  onChange: (lines: string[]) => void;
  placeholder: string;
  textColor: string;
  outlineColor: string;
  borderColor: string;
  inputBg: string;
  primary: string;
  stepPrefix?: (index: number) => string;
};

function clampLine(value: string): string {
  return value.length > RECIPE_LINE_ITEM_MAX ? value.slice(0, RECIPE_LINE_ITEM_MAX) : value;
}

export function ensureMinLines(lines: string[]): string[] {
  return lines.length > 0 ? lines : [''];
}

export function trimRecipeLines(lines: string[]): string[] {
  return lines.map(s => s.trim()).filter(Boolean);
}

export function linesFromLegacyText(text: string): string[] {
  const rows = text
    .split(/\n/)
    .map(s => s.trim())
    .filter(Boolean);
  return rows.length > 0 ? rows : [''];
}

export function DynamicLineInputs({
  label,
  hint,
  lines,
  onChange,
  placeholder,
  textColor,
  outlineColor,
  borderColor,
  inputBg,
  primary,
  stepPrefix,
}: Props) {
  const safeLines = ensureMinLines(lines);

  const setLine = useCallback(
    (index: number, value: string) => {
      const next = [...safeLines];
      next[index] = clampLine(value);
      if (index === next.length - 1 && value.trim() && next.length < RECIPE_LINE_ITEMS_MAX) {
        next.push('');
      }
      onChange(next);
    },
    [onChange, safeLines],
  );

  const removeLine = useCallback(
    (index: number) => {
      if (safeLines.length <= 1) {
        onChange(['']);
        return;
      }
      const next = safeLines.filter((_, i) => i !== index);
      onChange(ensureMinLines(next));
    },
    [onChange, safeLines],
  );

  const addLine = useCallback(() => {
    if (safeLines.length >= RECIPE_LINE_ITEMS_MAX) return;
    const last = safeLines[safeLines.length - 1]?.trim() ?? '';
    if (!last) return;
    onChange([...safeLines, '']);
  }, [onChange, safeLines]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: outlineColor }]}>{label}</Text>
      {hint ? <Text style={[styles.hint, { color: outlineColor }]}>{hint}</Text> : null}
      <View style={styles.list}>
        {safeLines.map((line, index) => {
          const prefix = stepPrefix?.(index);
          const canRemove = safeLines.length > 1 || line.trim().length > 0;
          return (
            <View key={`line-${index}`} style={styles.row}>
              {prefix ? (
                <Text style={[styles.prefix, { color: outlineColor }]}>{prefix}</Text>
              ) : null}
              <TextInput
                value={line}
                onChangeText={v => setLine(index, v)}
                placeholder={placeholder}
                placeholderTextColor={outlineColor}
                textAlignVertical="center"
                style={[
                  styles.input,
                  Platform.OS === 'android' && styles.inputAndroid,
                  { color: textColor, borderColor, backgroundColor: inputBg, flex: 1 },
                ]}
              />
              {canRemove ? (
                <Pressable
                  onPress={() => removeLine(index)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.65 : 1 }]}
                  accessibilityLabel="删除此项"
                >
                  <MaterialIcons name="remove-circle-outline" size={22} color={outlineColor} />
                </Pressable>
              ) : (
                <View style={styles.removePlaceholder} />
              )}
            </View>
          );
        })}
      </View>
      {safeLines.length < RECIPE_LINE_ITEMS_MAX ? (
        <Pressable
          onPress={addLine}
          style={({ pressed }) => [
            styles.addBtn,
            { borderColor, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialIcons name="add" size={20} color={primary} />
          <Text style={[styles.addBtnText, { color: primary }]}>添加一项</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700' },
  hint: { fontSize: 11, lineHeight: 16 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefix: { width: 22, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 15,
    lineHeight: 20,
    ...Platform.select({
      ios: { paddingVertical: 11 },
      default: { paddingVertical: 0 },
    }),
  },
  inputAndroid: {
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  removeBtn: { width: 28, alignItems: 'center' },
  removePlaceholder: { width: 28 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addBtnText: { fontSize: 14, fontWeight: '700' },
});
