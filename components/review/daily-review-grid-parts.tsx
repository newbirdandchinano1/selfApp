import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
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

type PickerKind = 'weather' | 'mood' | null;

export function DailyReviewMetaBar({
  meta,
  dateLabel,
  canEdit,
  canGoNext,
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
  onMetaChange: (patch: Partial<ReviewJournalMeta>) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  reminderEnabled?: boolean;
  reminderTimeLabel?: string | null;
  onOpenReminderSettings?: () => void;
}) {
  const { colors } = useAppTheme();
  const [picker, setPicker] = useState<PickerKind>(null);

  const togglePicker = (kind: PickerKind) => {
    if (!canEdit) return;
    setPicker(prev => (prev === kind ? null : kind));
  };

  return (
    <ReviewSectionCard style={styles.metaCard}>
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
          <Text style={[Typography.caption, { color: colors.textMuted, maxWidth: 88, textAlign: 'center' }]} numberOfLines={1}>
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
            {
              borderColor: colors.outline,
              backgroundColor: colors.primaryMuted,
              opacity: pressed ? 0.82 : 1,
              alignSelf: 'flex-start',
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={reminderEnabled ? '每日复盘提醒设置' : '设置每日复盘提醒'}>
          <MaterialIcons
            name={reminderEnabled ? 'notifications-active' : 'notifications-none'}
            size={18}
            color={colors.primary}
          />
          <Text style={[Typography.caption, { color: colors.primary }]} numberOfLines={1}>
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
                    backgroundColor: active ? colors.primaryMuted : colors.surfaceSubtle,
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
                    backgroundColor: active ? colors.primaryMuted : colors.surfaceSubtle,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <Text style={styles.pickerEmoji}>{emoji}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </ReviewSectionCard>
  );
}

export function WeeklyReviewMetaBar({
  weekRangeLabel,
  configuredDowLabel,
  onOpenReviewDaySettings,
}: {
  weekRangeLabel: string;
  configuredDowLabel?: string;
  onOpenReviewDaySettings: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <ReviewSectionCard style={styles.metaCard}>
      <View style={styles.toolbarRow}>
        <Pressable
          onPress={onOpenReviewDaySettings}
          hitSlop={Layout.hitSlop}
          style={({ pressed }) => [
            styles.reviewDayBtn,
            {
              borderColor: colors.outline,
              backgroundColor: colors.primaryMuted,
              opacity: pressed ? 0.82 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="设置周复盘日">
          <MaterialIcons name="event" size={18} color={colors.primary} />
          <Text style={[Typography.caption, { color: colors.primary }]} numberOfLines={1}>
            {configuredDowLabel ? `每周${configuredDowLabel}` : '设置周复盘日'}
          </Text>
        </Pressable>

        <View style={styles.toolbarRight}>
          <Text style={[Typography.caption, { color: colors.textMuted, textAlign: 'right', flexShrink: 1 }]} numberOfLines={1}>
            {weekRangeLabel || '本周期'}
          </Text>
        </View>
      </View>
    </ReviewSectionCard>
  );
}

function DailyReviewGridCell({
  dim,
  fields,
}: {
  dim: ReviewDimensionTemplate;
  fields: Record<string, string>;
}) {
  const { colors } = useAppTheme();
  const multiField = dim.columns.length > 1;
  const singleField = dim.columns.length === 1;
  const cellMinHeight = Math.max(120, dim.columns.length * 44 + 56);

  const columnPreview = (colId: string, placeholder?: string) => {
    const preview = reviewContentToPlainDisplay(fields[colId] ?? '');
    return preview || placeholder || '点击填写…';
  };

  const hasContent = dim.columns.some(col => reviewContentToPlainDisplay(fields[col.id] ?? '').length > 0);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.cell,
        {
          minHeight: cellMinHeight,
          backgroundColor: colors.surface,
          borderColor: colors.outline,
        },
      ]}>
      <View style={[styles.cellTitleWrap, { backgroundColor: colors.primaryMuted }]}>
        <Text style={[Typography.bodyStrong, { color: colors.text, textAlign: 'center' }]} numberOfLines={2}>
          {dim.title}
        </Text>
      </View>

      <View style={styles.cellBody}>
        {multiField
          ? dim.columns.map(col => {
              const preview = reviewContentToPlainDisplay(fields[col.id] ?? '');
              const empty = !preview;
              return (
                <View key={col.id} style={[styles.stackedField, { borderLeftColor: colors.primary }]}>
                  <Text style={[Typography.caption, { color: colors.primary }]}>{col.title}</Text>
                  <Text
                    style={[
                      Typography.body,
                      { color: empty ? colors.textMuted : colors.text, lineHeight: 21 },
                      empty && styles.emptyPreview,
                    ]}>
                    {columnPreview(col.id, col.placeholder)}
                  </Text>
                </View>
              );
            })
          : null}

        {singleField ? (
          <View style={[styles.stackedField, { borderLeftColor: colors.primary }]}>
            <Text style={[Typography.caption, { color: colors.primary }]}>{dim.columns[0].title}</Text>
            <Text
              style={[
                Typography.body,
                { color: hasContent ? colors.text : colors.textMuted, lineHeight: 21 },
                !hasContent && styles.emptyPreview,
              ]}>
              {columnPreview(dim.columns[0].id, dim.columns[0].placeholder)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function DailyReviewGrid({
  dimensions,
  fields,
  onPressDimension,
}: {
  dimensions: ReviewDimensionTemplate[];
  fields: Record<string, string>;
  onPressDimension: (dimensionId: string) => void;
}) {
  const { width } = useWindowDimensions();
  const gridWidth = Math.max(0, width - Layout.pagePaddingX * 2);
  const columns = getAdaptiveGridColumns(gridWidth);
  const gap = Spacing.md;
  const cellWidth = columns <= 1 ? gridWidth : (gridWidth - gap * (columns - 1)) / columns;

  return (
    <View style={[styles.grid, { width: gridWidth, alignSelf: 'center' }]}>
      {dimensions.map(dim => (
        <Pressable
          key={dim.id}
          onPress={() => onPressDimension(dim.id)}
          accessibilityRole="button"
          accessibilityLabel={`${dim.title}，点击查看或编辑`}
          style={({ pressed }) => [
            styles.gridCellSlot,
            {
              width: cellWidth,
              opacity: pressed ? 0.92 : 1,
            },
          ]}>
          <DailyReviewGridCell dim={dim} fields={fields} />
        </Pressable>
      ))}
    </View>
  );
}

export function DailyReviewSaveStatus({
  saving,
  saved,
}: {
  saving: boolean;
  saved: boolean;
}) {
  const { colors } = useAppTheme();
  if (!saving && !saved) return null;
  return (
    <Text style={[Typography.caption, { color: saving ? colors.textMuted : colors.primary, textAlign: 'center' }]}>
      {saving ? '保存中…' : '已自动保存'}
    </Text>
  );
}

const styles = StyleSheet.create({
  metaCard: {
    gap: Spacing.md,
    paddingVertical: Spacing['3xl'],
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
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodBtn: {
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodEmoji: { fontSize: 22 },
  reviewDayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxWidth: '70%',
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
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmoji: { fontSize: 20 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  gridCellSlot: {
    minWidth: 0,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cellTitleWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  cellBody: {
    flex: 1,
    gap: Spacing.md,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  stackedField: {
    gap: Spacing.sm,
    alignSelf: 'stretch',
    paddingLeft: Spacing.md,
    borderLeftWidth: 2,
  },
  emptyPreview: {
    fontWeight: '500',
  },
});
