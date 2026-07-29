import { Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { composerStyles as s } from './composer-styles';

export type TaskPriorityKey =
  | 'urgent-important'
  | 'urgent-not-important'
  | 'not-urgent-important'
  | 'not-urgent-not-important';

type MatrixCell = {
  key: TaskPriorityKey;
  label: string;
  hint: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  row: 'urgent' | 'later';
  col: 'important' | 'casual';
};

const PRIORITY_MATRIX: MatrixCell[] = [
  { key: 'urgent-important', label: '紧急重要', hint: '立即做', icon: 'whatshot', row: 'urgent', col: 'important' },
  { key: 'urgent-not-important', label: '紧急不重要', hint: '快速处理', icon: 'bolt', row: 'urgent', col: 'casual' },
  { key: 'not-urgent-important', label: '不紧急重要', hint: '计划安排', icon: 'auto-graph', row: 'later', col: 'important' },
  { key: 'not-urgent-not-important', label: '不紧急不重要', hint: '有空再做', icon: 'inbox', row: 'later', col: 'casual' },
];

export function ComposerPriorityMatrix({
  value,
  onChange,
}: {
  value: TaskPriorityKey;
  onChange: (key: TaskPriorityKey) => void;
}) {
  const { colors, isDark, shadows } = useAppTheme();

  const colorByKey = React.useMemo(
    () =>
      ({
        'urgent-important': isDark ? colors.dangerSoft : colors.danger,
        'urgent-not-important': colors.tertiary,
        'not-urgent-important': colors.primary,
        'not-urgent-not-important': colors.textSecondary,
      }) satisfies Record<TaskPriorityKey, string>,
    [colors.danger, colors.dangerSoft, colors.primary, colors.tertiary, colors.textSecondary, isDark],
  );

  const accentColor = colorByKey[value];

  const renderCell = (row: MatrixCell['row'], col: MatrixCell['col']) => {
    const cell = PRIORITY_MATRIX.find((item) => item.row === row && item.col === col);
    if (!cell) return null;
    const active = value === cell.key;
    const tint = colorByKey[cell.key];
    return (
      <Pressable
        key={cell.key}
        onPress={() => onChange(cell.key)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          s.matrixCell,
          {
            backgroundColor: active ? tint : colors.surface,
            borderColor: active ? tint : colors.outline,
            borderWidth: active ? 2 : StyleSheet.hairlineWidth,
          },
          shadows.card,
          pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
        ]}>
        <MaterialIcons name={cell.icon} size={20} color={active ? colors.onPrimary : tint} />
        <Text
          style={[Typography.bodyStrong, s.matrixCellLabel, { color: active ? colors.onPrimary : colors.text }]}
          numberOfLines={2}>
          {cell.label}
        </Text>
        <Text
          style={[
            Typography.caption,
            s.matrixCellHint,
            { color: active ? colors.onPrimary : colors.textSecondary },
          ]}>
          {cell.hint}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <View style={[s.sectionAccent, { backgroundColor: accentColor }]} />
        <View style={{ flex: 1 }}>
          <Text style={[Typography.title, { color: colors.text }]}>艾森豪威尔矩阵</Text>
          <Text style={[Typography.caption, s.sectionDesc, { color: colors.textSecondary }]}>
            按紧急程度 × 重要程度选择优先级
          </Text>
        </View>
      </View>
      <View style={[s.matrixBoard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline }]}>
        <View style={s.matrixHeaderRow}>
          <View style={s.matrixRowLabelSlot} />
          <Text style={[Typography.caption, s.matrixAxis, { color: colors.textSecondary }]}>重要</Text>
          <Text style={[Typography.caption, s.matrixAxis, { color: colors.textSecondary }]}>不重要</Text>
        </View>
        <View style={s.matrixGridRow}>
          <Text style={[Typography.caption, s.matrixRowLabel, { color: colors.textSecondary }]}>紧急</Text>
          {renderCell('urgent', 'important')}
          {renderCell('urgent', 'casual')}
        </View>
        <View style={s.matrixGridRow}>
          <Text style={[Typography.caption, s.matrixRowLabel, { color: colors.textSecondary }]}>不紧急</Text>
          {renderCell('later', 'important')}
          {renderCell('later', 'casual')}
        </View>
      </View>
    </View>
  );
}

export function taskPriorityLabel(key: TaskPriorityKey): string {
  return PRIORITY_MATRIX.find((p) => p.key === key)?.label ?? '不紧急不重要';
}

/** 数值优先级 → 矩阵 key（0/未知视为「不紧急不重要」） */
export function taskPriorityToKey(priority: number): TaskPriorityKey {
  if (priority >= 4) return 'urgent-important';
  if (priority === 3) return 'urgent-not-important';
  if (priority === 2) return 'not-urgent-important';
  return 'not-urgent-not-important';
}

/** 矩阵 key → 数值优先级（1–4） */
export function taskPriorityKeyToNumber(key: TaskPriorityKey): 1 | 2 | 3 | 4 {
  switch (key) {
    case 'urgent-important':
      return 4;
    case 'urgent-not-important':
      return 3;
    case 'not-urgent-important':
      return 2;
    case 'not-urgent-not-important':
    default:
      return 1;
  }
}
