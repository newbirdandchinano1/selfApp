import { CheckRow } from '@/components/review/review-ui-parts';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import type { ReviewJournalMeta } from '@/lib/repositories/insights/review-journal-body';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const MIN_GRID_CELL_WIDTH = 150;
const MAX_GRID_COLUMNS = 3;

function getAdaptiveGridColumns(gridWidth: number) {
  if (gridWidth <= 0) return 1;
  return Math.max(1, Math.min(MAX_GRID_COLUMNS, Math.floor(gridWidth / MIN_GRID_CELL_WIDTH)));
}

export const DAILY_REVIEW_WEATHER_OPTIONS = [
  { id: 'sunny', icon: 'wb-sunny' as const, label: '晴' },
  { id: 'partly-cloudy', icon: 'wb-cloudy' as const, label: '多云' },
  { id: 'cloudy', icon: 'cloud' as const, label: '阴' },
  { id: 'rainy', icon: 'grain' as const, label: '雨' },
  { id: 'stormy', icon: 'thunderstorm' as const, label: '雷雨' },
  { id: 'snowy', icon: 'ac-unit' as const, label: '雪' },
] as const;

export const DAILY_REVIEW_MOOD_OPTIONS = ['😀', '🙂', '😎', '😐', '😔', '😤', '🥳', '😴'] as const;

function weatherIcon(id: string | undefined) {
  return DAILY_REVIEW_WEATHER_OPTIONS.find(w => w.id === id)?.icon ?? 'wb-sunny';
}

function isChecklistDimension(dim: ReviewDimensionTemplate): boolean {
  if (dim.columns.length < 2) return false;
  const title = dim.title.trim();
  return title.includes('习惯') || title.includes('打卡');
}

type PickerKind = 'weather' | 'mood' | null;

export function DailyReviewMetaBar({
  meta,
  dateLabel,
  canEdit,
  canGoNext,
  colors,
  onMetaChange,
  onPrevDay,
  onNextDay,
}: {
  meta: ReviewJournalMeta;
  dateLabel: string;
  canEdit: boolean;
  canGoNext: boolean;
  colors: {
    text: string;
    textMuted: string;
    outline: string;
    primary: string;
    background: string;
  };
  onMetaChange: (patch: Partial<ReviewJournalMeta>) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
}) {
  const [picker, setPicker] = useState<PickerKind>(null);

  const togglePicker = (kind: PickerKind) => {
    if (!canEdit) return;
    setPicker(prev => (prev === kind ? null : kind));
  };

  return (
    <View style={styles.metaBar}>
      <View style={styles.toolbarRow}>
        <View style={styles.toolbarLeft}>
          <Pressable
            onPress={() => togglePicker('weather')}
            disabled={!canEdit}
            style={({ pressed }) => [styles.iconBtn, { opacity: !canEdit ? 0.45 : pressed ? 0.7 : 1 }]}>
            <MaterialIcons name={weatherIcon(meta.weather)} size={24} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => togglePicker('mood')}
            disabled={!canEdit}
            style={({ pressed }) => [styles.moodBtn, { opacity: !canEdit ? 0.45 : pressed ? 0.7 : 1 }]}>
            <Text style={styles.moodEmoji}>{meta.mood || '🙂'}</Text>
          </Pressable>
        </View>

        <View style={styles.toolbarRight}>
          <Pressable
            onPress={onPrevDay}
            hitSlop={Layout.hitSlop}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="chevron-left" size={28} color={colors.textMuted} />
          </Pressable>
          <Text style={[styles.dateLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {dateLabel}
          </Text>
          <Pressable
            onPress={onNextDay}
            disabled={!canGoNext}
            hitSlop={Layout.hitSlop}
            style={({ pressed }) => [
              styles.iconBtn,
              { opacity: !canGoNext ? 0.3 : pressed ? 0.7 : 1 },
            ]}>
            <MaterialIcons name="chevron-right" size={28} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {picker === 'weather' && canEdit ? (
        <View style={styles.pickerRow}>
          {DAILY_REVIEW_WEATHER_OPTIONS.map(opt => {
            const active = meta.weather === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => {
                  onMetaChange({ weather: opt.id });
                  setPicker(null);
                }}
                style={({ pressed }) => [
                  styles.pickerChip,
                  {
                    borderColor: active ? colors.primary : colors.outline,
                    backgroundColor: active ? `${colors.primary}14` : 'transparent',
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <MaterialIcons name={opt.icon} size={20} color={active ? colors.primary : colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {picker === 'mood' && canEdit ? (
        <View style={styles.pickerRow}>
          {DAILY_REVIEW_MOOD_OPTIONS.map(emoji => {
            const active = meta.mood === emoji;
            return (
              <Pressable
                key={emoji}
                onPress={() => {
                  onMetaChange({ mood: emoji });
                  setPicker(null);
                }}
                style={({ pressed }) => [
                  styles.pickerChip,
                  {
                    borderColor: active ? colors.primary : colors.outline,
                    backgroundColor: active ? `${colors.primary}14` : 'transparent',
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <Text style={styles.pickerEmoji}>{emoji}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function DailyReviewGridCell({
  dim,
  fields,
  canEdit,
  colors,
  onSetField,
  style,
}: {
  dim: ReviewDimensionTemplate | null;
  fields: Record<string, string>;
  canEdit: boolean;
  colors: {
    text: string;
    textMuted: string;
    outline: string;
    primary: string;
    input: string;
  };
  onSetField: (columnId: string, value: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (!dim) {
    return null;
  }

  const checklist = isChecklistDimension(dim);
  const multiField = !checklist && dim.columns.length > 1;
  const singleField = dim.columns.length === 1;
  const cellMinHeight = Math.max(120, dim.columns.length * 44 + 56);

  return (
    <View style={[styles.cell, { minHeight: cellMinHeight, borderColor: colors.outline }, style]}>
      <Text style={[styles.cellTitle, { color: colors.textMuted }]} numberOfLines={2}>
        {dim.title}
      </Text>

      <View style={styles.cellBody}>
        {checklist
          ? dim.columns.map(col => {
              const checked = (fields[col.id] ?? '').trim() === '1';
              return (
                <CheckRow
                  key={col.id}
                  checked={checked}
                  disabled={!canEdit}
                  label={col.title}
                  textColor={colors.text}
                  outline={colors.outline}
                  primary={colors.primary}
                  onToggle={() => onSetField(col.id, checked ? '' : '1')}
                />
              );
            })
          : null}

        {multiField
          ? dim.columns.map(col => (
              <View key={col.id} style={styles.inlineField}>
                <Text style={[styles.inlineLabel, { color: colors.textMuted }]}>{col.title}:</Text>
                <TextInput
                  value={fields[col.id] ?? ''}
                  onChangeText={t => onSetField(col.id, t)}
                  placeholder={col.placeholder || '…'}
                  placeholderTextColor={colors.textMuted}
                  editable={canEdit}
                  style={[styles.inlineInput, { color: colors.text }]}
                />
              </View>
            ))
          : null}

        {singleField ? (
          <TextInput
            value={fields[dim.columns[0].id] ?? ''}
            onChangeText={t => onSetField(dim.columns[0].id, t)}
            placeholder={dim.columns[0].placeholder || '…'}
            placeholderTextColor={colors.textMuted}
            editable={canEdit}
            multiline
            textAlignVertical="top"
            style={[styles.textArea, { color: colors.text }]}
          />
        ) : null}
      </View>
    </View>
  );
}

export function DailyReviewGrid({
  dimensions,
  fields,
  canEdit,
  colors,
  onSetField,
  onPressDimension,
}: {
  dimensions: ReviewDimensionTemplate[];
  fields: Record<string, string>;
  canEdit: boolean;
  colors: {
    text: string;
    textMuted: string;
    outline: string;
    primary: string;
    input: string;
    background: string;
  };
  onSetField: (columnId: string, value: string) => void;
  onPressDimension?: (dimensionId: string) => void;
}) {
  const { width } = useWindowDimensions();
  const gridWidth = Math.max(0, Math.min(width - Layout.pagePaddingX * 2, Layout.contentMaxWidth));
  const columns = getAdaptiveGridColumns(gridWidth);
  const rows = Array.from({ length: Math.ceil(dimensions.length / columns) }, (_, rowIndex) =>
    dimensions.slice(rowIndex * columns, rowIndex * columns + columns),
  );

  return (
    <View style={[styles.grid, { width: gridWidth, borderColor: colors.outline, alignSelf: 'center' }]}>
      {rows.map((row, rowIndex) => {
        const isLastRow = rowIndex === rows.length - 1;

        return (
          <View
            key={`row-${rowIndex}`}
            style={[
              styles.gridRow,
              !isLastRow && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline },
            ]}>
            {row.map((dim, colIndex) => {
              const isLastCol = colIndex === columns - 1 || colIndex === row.length - 1;
              const clickable = Boolean(onPressDimension);

              return (
                <Pressable
                  key={dim.id}
                  onPress={clickable ? () => onPressDimension?.(dim.id) : undefined}
                  disabled={!clickable}
                  style={({ pressed }) => [
                    styles.gridCellSlot,
                    {
                      opacity: clickable ? (pressed ? 0.92 : 1) : 1,
                      borderRightWidth: !isLastCol ? StyleSheet.hairlineWidth : 0,
                      borderRightColor: colors.outline,
                    },
                  ]}>
                  <DailyReviewGridCell
                    dim={dim}
                    fields={fields}
                    canEdit={canEdit}
                    colors={colors}
                    onSetField={onSetField}
                  />
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

export function DailyReviewSaveStatus({
  saving,
  saved,
  colors,
}: {
  saving: boolean;
  saved: boolean;
  colors: { textMuted: string; primary: string };
}) {
  if (!saving && !saved) return null;
  return (
    <Text style={[Typography.caption, { color: saving ? colors.textMuted : colors.primary, textAlign: 'center' }]}>
      {saving ? '保存中…' : '已自动保存'}
    </Text>
  );
}

const styles = StyleSheet.create({
  metaBar: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexShrink: 0,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodEmoji: { fontSize: 22 },
  dateLabel: {
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 88,
    textAlign: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  pickerChip: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmoji: { fontSize: 20 },
  grid: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  gridCellSlot: {
    flex: 1,
    alignSelf: 'stretch',
    minWidth: 0,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    minHeight: 148,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    gap: Spacing.md,
  },
  cellTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  cellBody: {
    flex: 1,
    gap: Spacing.sm,
  },
  inlineField: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  inlineLabel: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 20,
  },
  inlineInput: {
    flex: 1,
    minWidth: 40,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 20,
    padding: 0,
    margin: 0,
  },
  textArea: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
    padding: 0,
    margin: 0,
    minHeight: 72,
  },
});
