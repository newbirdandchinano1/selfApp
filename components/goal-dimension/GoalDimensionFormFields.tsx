import {
  DEFAULT_DIMENSION_PRIORITY,
  DIMENSION_NOTE_MAX,
  DIMENSION_PRIORITY_OPTIONS,
  DIMENSION_TITLE_MAX,
  type DimensionPriorityValue,
} from '@/lib/repositories/goal-dimensions/goal-dimension-extra';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

export type GoalDimensionFormFieldsProps = {
  title: string;
  onTitleChange: (value: string) => void;
  priority: DimensionPriorityValue;
  onPriorityChange: (value: DimensionPriorityValue) => void;
  note: string;
  onNoteChange: (value: string) => void;
  disabled?: boolean;
  textColor: string;
  outlineColor: string;
  primaryColor: string;
  borderSoft: string;
  inputBg: string;
  isDark: boolean;
  compact?: boolean;
};

export function GoalDimensionFormFields({
  title,
  onTitleChange,
  priority,
  onPriorityChange,
  note,
  onNoteChange,
  disabled = false,
  textColor,
  outlineColor,
  primaryColor,
  borderSoft,
  inputBg,
  isDark,
  compact = false,
}: GoalDimensionFormFieldsProps) {
  return (
    <View style={compact ? styles.compactRoot : styles.root}>
      <Text style={[styles.label, { color: outlineColor }]}>维度名称（最多 {DIMENSION_TITLE_MAX} 字）</Text>
      <TextInput
        value={title}
        onChangeText={x => onTitleChange(x.length > DIMENSION_TITLE_MAX ? x.slice(0, DIMENSION_TITLE_MAX) : x)}
        placeholder="例如：财富"
        placeholderTextColor={isDark ? 'rgba(148,163,184,0.45)' : 'rgba(114,119,133,0.45)'}
        editable={!disabled}
        style={[styles.inputTitle, { color: textColor, borderColor: borderSoft, backgroundColor: inputBg }]}
      />

      <Text style={[styles.label, styles.labelSpaced, { color: outlineColor }]}>优先级</Text>
      <Text style={[styles.hint, { color: outlineColor }]}>数值越高排序越靠前，在总目标墙中优先展示</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.priorityRow}
        keyboardShouldPersistTaps="handled"
      >
        {DIMENSION_PRIORITY_OPTIONS.map(opt => {
          const selected = priority === opt.value;
          return (
            <Pressable
              key={opt.value}
              disabled={disabled}
              onPress={() => onPriorityChange(opt.value)}
              style={({ pressed }) => [
                styles.priorityChip,
                {
                  borderColor: selected ? primaryColor : borderSoft,
                  backgroundColor: selected
                    ? isDark
                      ? 'rgba(96,165,250,0.18)'
                      : 'rgba(0,88,190,0.1)'
                    : inputBg,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.priorityChipText,
                  { color: selected ? primaryColor : textColor },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={[styles.label, styles.labelSpaced, { color: outlineColor }]}>
        备注（可选，最多 {DIMENSION_NOTE_MAX} 字）
      </Text>
      <TextInput
        value={note}
        onChangeText={x => onNoteChange(x.length > DIMENSION_NOTE_MAX ? x.slice(0, DIMENSION_NOTE_MAX) : x)}
        placeholder="记录该维度的说明、侧重点等…"
        placeholderTextColor={isDark ? 'rgba(148,163,184,0.45)' : 'rgba(114,119,133,0.45)'}
        multiline
        textAlignVertical="top"
        editable={!disabled}
        style={[styles.inputNote, { color: textColor, borderColor: borderSoft, backgroundColor: inputBg }]}
      />
    </View>
  );
}

export { DEFAULT_DIMENSION_PRIORITY, DIMENSION_TITLE_MAX };

const styles = StyleSheet.create({
  root: { gap: 0 },
  compactRoot: { gap: 0 },
  label: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  labelSpaced: {
    marginTop: 16,
  },
  hint: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: -4,
    marginBottom: 10,
    lineHeight: 16,
  },
  inputTitle: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 2,
  },
  priorityChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  priorityChipText: {
    fontSize: 13,
    fontWeight: '800',
  },
  inputNote: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    minHeight: 96,
  },
});
