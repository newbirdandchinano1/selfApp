import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function DailyReviewProgressBar({
  weekLabel,
  streak,
  todayDone,
}: {
  weekLabel: string;
  streak: number;
  todayDone: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.chip,
          {
            backgroundColor: todayDone ? colors.primaryMuted : colors.capsule,
            borderColor: todayDone ? colors.success : colors.outline,
          },
        ]}>
        <MaterialIcons
          name={todayDone ? 'check-circle' : 'radio-button-unchecked'}
          size={16}
          color={todayDone ? colors.success : colors.textMuted}
        />
        <Text
          style={[Typography.caption, { color: todayDone ? colors.success : colors.textMuted, fontWeight: '700' }]}
          maxFontSizeMultiplier={1.35}>
          {todayDone ? '今日已写' : '今日未写'}
        </Text>
      </View>

      <View style={[styles.chip, { backgroundColor: colors.capsule, borderColor: colors.outline }]}>
        <MaterialIcons name="date-range" size={16} color={colors.primary} />
        <Text style={[Typography.caption, { color: colors.text, fontWeight: '600' }]} maxFontSizeMultiplier={1.35}>
          {weekLabel}
        </Text>
      </View>

      {streak > 0 ? (
        <View style={[styles.chip, { backgroundColor: colors.primaryMuted, borderColor: colors.outline }]}>
          <MaterialIcons name="local-fire-department" size={16} color={colors.primary} />
          <Text style={[Typography.caption, { color: colors.primary, fontWeight: '700' }]} maxFontSizeMultiplier={1.35}>
            连续 {streak} 天
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function DailyReviewProgressHintCard({
  weekLabel,
  streak,
  todayDone,
}: {
  weekLabel: string;
  streak: number;
  todayDone: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <ReviewSectionCard variant="muted" style={styles.hintCard}>
      <DailyReviewProgressBar weekLabel={weekLabel} streak={streak} todayDone={todayDone} />
      <Text style={[Typography.caption, { color: colors.textMuted, lineHeight: 18 }]} maxFontSizeMultiplier={1.35}>
        写满任意一栏即算今日完成
      </Text>
    </ReviewSectionCard>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  hintCard: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
});
