import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import type { ReviewJournalMeta } from '@/lib/repositories/insights/review-journal-body';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
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
  reminderEnabled,
  reminderTimeLabel,
  onOpenReminderSettings,
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
  reminderEnabled?: boolean;
  reminderTimeLabel?: string | null;
  onOpenReminderSettings?: () => void;
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

      {onOpenReminderSettings ? (
        <Pressable
          onPress={onOpenReminderSettings}
          hitSlop={Layout.hitSlop}
          style={({ pressed }) => [
            styles.reviewDayBtn,
            { borderColor: colors.outline, opacity: pressed ? 0.82 : 1, alignSelf: 'flex-start' },
          ]}
          accessibilityRole="button"
          accessibilityLabel={reminderEnabled ? '每日复盘提醒设置' : '设置每日复盘提醒'}>
          <MaterialIcons
            name={reminderEnabled ? 'notifications-active' : 'notifications-none'}
            size={18}
            color={colors.primary}
          />
          <Text style={[styles.reviewDayBtnText, { color: colors.primary }]} numberOfLines={1}>
            {reminderEnabled && reminderTimeLabel ? `每日 ${reminderTimeLabel} 提醒` : '设置每日提醒'}
          </Text>
        </Pressable>
      ) : null}

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

export function WeeklyReviewMetaBar({
  weekRangeLabel,
  configuredDowLabel,
  colors,
  onOpenReviewDaySettings,
}: {
  weekRangeLabel: string;
  configuredDowLabel?: string;
  colors: {
    text: string;
    textMuted: string;
    outline: string;
    primary: string;
  };
  onOpenReviewDaySettings: () => void;
}) {
  return (
    <View style={styles.metaBar}>
      <View style={styles.toolbarRow}>
        <Pressable
          onPress={onOpenReviewDaySettings}
          hitSlop={Layout.hitSlop}
          style={({ pressed }) => [
            styles.reviewDayBtn,
            { borderColor: colors.outline, opacity: pressed ? 0.82 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="设置周复盘日">
          <MaterialIcons name="event" size={18} color={colors.primary} />
          <Text style={[styles.reviewDayBtnText, { color: colors.primary }]} numberOfLines={1}>
            {configuredDowLabel ? `每周${configuredDowLabel}` : '设置周复盘日'}
          </Text>
        </Pressable>

        <View style={styles.toolbarRight}>
          <Text style={[styles.weekRangeLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {weekRangeLabel || '本周期'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function DailyReviewGridCell({
  dim,
  fields,
  colors,
  style,
}: {
  dim: ReviewDimensionTemplate | null;
  fields: Record<string, string>;
  colors: {
    text: string;
    textMuted: string;
    outline: string;
    primary: string;
  };
  style?: StyleProp<ViewStyle>;
}) {
  if (!dim) {
    return null;
  }

  const checklist = isChecklistDimension(dim);
  const multiField = !checklist && dim.columns.length > 1;
  const singleField = dim.columns.length === 1;
  const cellMinHeight = Math.max(120, dim.columns.length * 44 + 56);

  const columnPreview = (colId: string, placeholder?: string) => {
    const preview = reviewContentToPlainDisplay(fields[colId] ?? '');
    return preview || placeholder || '点击填写…';
  };

  const hasContent = dim.columns.some(col => reviewContentToPlainDisplay(fields[col.id] ?? '').length > 0);

  return (
    <View pointerEvents="none" style={[styles.cell, { minHeight: cellMinHeight, borderColor: colors.outline }, style]}>
      <View
        style={[
          styles.cellTitleWrap,
          { borderBottomColor: colors.outline, backgroundColor: `${colors.primary}10` },
        ]}>
        <Text style={[styles.cellTitle, { color: colors.text }]} numberOfLines={2}>
          {dim.title}
        </Text>
      </View>

      <View style={styles.cellBody}>
        {checklist
          ? dim.columns.map(col => {
              const checked = (fields[col.id] ?? '').trim() === '1';
              return (
                <View key={col.id} style={styles.checkReadonly}>
                  <MaterialIcons
                    name={checked ? 'check-box' : 'check-box-outline-blank'}
                    size={22}
                    color={checked ? colors.primary : colors.outline}
                  />
                  <Text style={[styles.checkReadonlyLabel, { color: colors.text }]} numberOfLines={1}>
                    {col.title}
                  </Text>
                </View>
              );
            })
          : null}

        {multiField
          ? dim.columns.map(col => {
              const preview = reviewContentToPlainDisplay(fields[col.id] ?? '');
              const empty = !preview;
              return (
                <View
                  key={col.id}
                  style={[styles.stackedField, { borderLeftColor: colors.primary }]}>
                  <Text style={[styles.inlineLabel, { color: colors.primary }]}>{col.title}</Text>
                  <Text
                    style={[
                      styles.previewText,
                      { color: empty ? colors.textMuted : colors.text },
                    ]}>
                    {columnPreview(col.id, col.placeholder)}
                  </Text>
                </View>
              );
            })
          : null}

        {singleField ? (
          <Text
            style={[
              styles.previewText,
              { color: hasContent ? colors.text : colors.textMuted },
            ]}>
            {columnPreview(dim.columns[0].id, dim.columns[0].placeholder)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function DailyReviewGrid({
  dimensions,
  fields,
  colors,
  onPressDimension,
}: {
  dimensions: ReviewDimensionTemplate[];
  fields: Record<string, string>;
  colors: {
    text: string;
    textMuted: string;
    outline: string;
    primary: string;
    input: string;
    background: string;
  };
  onPressDimension: (dimensionId: string) => void;
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

              return (
                <Pressable
                  key={dim.id}
                  onPress={() => onPressDimension(dim.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${dim.title}，点击查看或编辑`}
                  style={({ pressed }) => [
                    styles.gridCellSlot,
                    {
                      opacity: pressed ? 0.92 : 1,
                      borderRightWidth: !isLastCol ? StyleSheet.hairlineWidth : 0,
                      borderRightColor: colors.outline,
                    },
                  ]}>
                  <DailyReviewGridCell dim={dim} fields={fields} colors={colors} />
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
  reviewDayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxWidth: '58%',
  },
  reviewDayBtnText: {
    fontSize: 12,
    fontWeight: '800',
    flexShrink: 1,
  },
  weekRangeLabel: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
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
    paddingVertical: Spacing.lg,
    gap: Spacing.md,
  },
  cellTitleWrap: {
    alignSelf: 'stretch',
    marginHorizontal: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cellTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    letterSpacing: 0.15,
    textAlign: 'center',
  },
  cellBody: {
    flex: 1,
    gap: Spacing.md,
    alignSelf: 'stretch',
  },
  stackedField: {
    gap: Spacing.sm,
    alignSelf: 'stretch',
    paddingLeft: Spacing.md,
    borderLeftWidth: 2,
  },
  inlineLabel: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
    letterSpacing: 0.25,
  },
  checkReadonly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkReadonlyLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  previewText: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 21,
  },
});
