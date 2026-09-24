import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { getMinTouchTarget, Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ReviewJournalMeta } from '@/lib/repositories/insights/review-journal-body';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

function weatherLabel(id: string | undefined) {
  return DAILY_REVIEW_WEATHER_OPTIONS.find(w => w.id === id)?.label ?? '未设置';
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
  const touchMin = useMemo(() => getMinTouchTarget(Platform.OS), []);

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
            accessibilityRole="button"
            accessibilityState={{ disabled: !canEdit, expanded: picker === 'weather' }}
            accessibilityLabel={`天气：${weatherLabel(meta.weather)}`}
            accessibilityHint={canEdit ? '点按选择天气' : undefined}
            style={({ pressed }) => [styles.iconBtn, { opacity: !canEdit ? 0.45 : pressed ? 0.7 : 1 }]}>
            <MaterialIcons name={weatherIcon(meta.weather)} size={24} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => togglePicker('mood')}
            disabled={!canEdit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canEdit, expanded: picker === 'mood' }}
            accessibilityLabel={`心情：${meta.mood || '未设置'}`}
            accessibilityHint={canEdit ? '点按选择心情' : undefined}
            style={({ pressed }) => [styles.moodBtn, { opacity: !canEdit ? 0.45 : pressed ? 0.7 : 1 }]}>
            <Text style={styles.moodEmoji} maxFontSizeMultiplier={1.35}>
              {meta.mood || '🙂'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.toolbarRight}>
          <Pressable
            onPress={onPrevDay}
            hitSlop={Layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="上一天"
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="chevron-left" size={28} color={colors.textMuted} />
          </Pressable>
          <Text
            style={[Typography.caption, { color: colors.textMuted, maxWidth: 100, textAlign: 'center' }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.35}>
            {dateLabel}
          </Text>
          <Pressable
            onPress={onNextDay}
            disabled={!canGoNext}
            hitSlop={Layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="下一天"
            accessibilityState={{ disabled: !canGoNext }}
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
              minHeight: touchMin,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={reminderEnabled ? '每日复盘提醒设置' : '设置每日复盘提醒'}>
          <MaterialIcons
            name={reminderEnabled ? 'notifications-active' : 'notifications-none'}
            size={18}
            color={colors.primary}
          />
          <Text style={[Typography.caption, { color: colors.primary }]} numberOfLines={1} maxFontSizeMultiplier={1.35}>
            {reminderEnabled && reminderTimeLabel ? `每日 ${reminderTimeLabel} 提醒` : '设置每日提醒'}
          </Text>
        </Pressable>
      ) : null}

      {picker === 'weather' && canEdit ? (
        <View style={styles.pickerRow} accessibilityRole="radiogroup" accessibilityLabel="选择天气">
          {DAILY_REVIEW_WEATHER_OPTIONS.map(opt => {
            const active = meta.weather === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => {
                  onMetaChange({ weather: opt.id });
                  setPicker(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
                style={({ pressed }) => [
                  styles.pickerChip,
                  {
                    width: touchMin,
                    height: touchMin,
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
        <View style={styles.pickerRow} accessibilityRole="radiogroup" accessibilityLabel="选择心情">
          {DAILY_REVIEW_MOOD_OPTIONS.map(emoji => {
            const active = meta.mood === emoji;
            return (
              <Pressable
                key={emoji}
                onPress={() => {
                  onMetaChange({ mood: emoji });
                  setPicker(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`心情 ${emoji}`}
                style={({ pressed }) => [
                  styles.pickerChip,
                  {
                    width: touchMin,
                    height: touchMin,
                    borderColor: active ? colors.primary : colors.outline,
                    backgroundColor: active ? colors.primaryMuted : colors.surfaceSubtle,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <Text style={styles.pickerEmoji} maxFontSizeMultiplier={1.35}>
                  {emoji}
                </Text>
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
              minHeight: getMinTouchTarget(Platform.OS),
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="设置周复盘日">
          <MaterialIcons name="event" size={18} color={colors.primary} />
          <Text style={[Typography.caption, { color: colors.primary }]} numberOfLines={1} maxFontSizeMultiplier={1.35}>
            {configuredDowLabel ? `每周${configuredDowLabel}` : '设置周复盘日'}
          </Text>
        </Pressable>

        <View style={styles.toolbarRight}>
          <Text
            style={[Typography.caption, { color: colors.textMuted, textAlign: 'right', flexShrink: 1 }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.35}>
            {weekRangeLabel || '本周期'}
          </Text>
        </View>
      </View>
    </ReviewSectionCard>
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
  const message = saving ? '保存中…' : '已自动保存';
  return (
    <Text
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
      style={[Typography.caption, { color: saving ? colors.textMuted : colors.primary, textAlign: 'center' }]}
      maxFontSizeMultiplier={1.35}>
      {message}
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
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmoji: { fontSize: 20 },
});
