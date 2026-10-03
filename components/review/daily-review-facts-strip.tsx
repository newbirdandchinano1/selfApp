import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ReviewDayFacts } from '@/lib/review-day-facts';
import { reviewDayFactsIsEmpty, reviewDayFactsPreviewLines } from '@/lib/review-day-facts';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function DailyReviewFactsStrip({
  facts,
  canEdit,
  onInsert,
}: {
  facts: ReviewDayFacts | null;
  canEdit: boolean;
  onInsert: () => void;
}) {
  const { colors } = useAppTheme();

  const lines = useMemo(() => (facts ? reviewDayFactsPreviewLines(facts) : []), [facts]);

  if (!facts || reviewDayFactsIsEmpty(facts)) {
    return (
      <ReviewSectionCard variant="muted" style={styles.card}>
        <View style={styles.row}>
          <MaterialIcons name="auto-awesome" size={20} color={colors.textMuted} />
          <Text style={[Typography.body, { color: colors.textMuted, flex: 1, lineHeight: 20 }]} maxFontSizeMultiplier={1.35}>
            今天还没有健康、任务或财务数据。写两句今日记录即可。
          </Text>
        </View>
      </ReviewSectionCard>
    );
  }

  return (
    <ReviewSectionCard style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <MaterialIcons name="bolt" size={20} color={colors.primary} />
          <Text style={[Typography.bodyStrong, { color: colors.text }]} maxFontSizeMultiplier={1.35}>
            今日数据
          </Text>
        </View>
        {canEdit ? (
          <Pressable
            onPress={onInsert}
            accessibilityRole="button"
            accessibilityLabel="将今日健康、任务、财务写入复盘"
            style={({ pressed }) => [
              styles.insertBtn,
              { backgroundColor: colors.primaryMuted, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Text style={[Typography.caption, { color: colors.primary, fontWeight: '700' }]} maxFontSizeMultiplier={1.35}>
              一键全部写入
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[Typography.caption, { color: colors.textMuted }]} maxFontSizeMultiplier={1.35}>
        写入健康、任务、财务三个内置栏目（覆盖这三栏，自定义模块不动）
      </Text>
      <View style={styles.list}>
        {lines.map((line, idx) => (
          <Text
            key={`${idx}-${line.slice(0, 12)}`}
            style={[Typography.body, { color: colors.text, lineHeight: 20 }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.35}>
            {line}
          </Text>
        ))}
      </View>
    </ReviewSectionCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.md,
    paddingVertical: Spacing['3xl'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
    minWidth: 0,
  },
  insertBtn: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  list: {
    gap: Spacing.xs,
  },
});
