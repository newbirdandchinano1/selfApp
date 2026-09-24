import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ReviewDayFacts } from '@/lib/review-day-facts';
import { reviewDayFactsIsEmpty } from '@/lib/review-day-facts';
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

  const lines = useMemo(() => {
    if (!facts) return [];
    const out: string[] = [];
    for (const t of facts.tasks.slice(0, 4)) out.push(`任务 · ${t.title}`);
    for (const h of facts.habits.slice(0, 4)) out.push(`习惯 · ${h.title}`);
    return out;
  }, [facts]);

  if (!facts || reviewDayFactsIsEmpty(facts)) {
    return (
      <ReviewSectionCard variant="muted" style={styles.card}>
        <View style={styles.row}>
          <MaterialIcons name="auto-awesome" size={20} color={colors.textMuted} />
          <Text style={[Typography.body, { color: colors.textMuted, flex: 1, lineHeight: 20 }]} maxFontSizeMultiplier={1.35}>
            今天还没有任务完成或习惯打卡。写两句今日记录即可。
          </Text>
        </View>
      </ReviewSectionCard>
    );
  }

  const moreCount =
    Math.max(0, facts.tasks.length - 4) + Math.max(0, facts.habits.length - 4);

  return (
    <ReviewSectionCard style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <MaterialIcons name="bolt" size={20} color={colors.primary} />
          <Text style={[Typography.bodyStrong, { color: colors.text }]} maxFontSizeMultiplier={1.35}>
            今日事实
          </Text>
        </View>
        {canEdit ? (
          <Pressable
            onPress={onInsert}
            accessibilityRole="button"
            accessibilityLabel="将今日事实写入复盘"
            style={({ pressed }) => [
              styles.insertBtn,
              { backgroundColor: colors.primaryMuted, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Text style={[Typography.caption, { color: colors.primary, fontWeight: '700' }]} maxFontSizeMultiplier={1.35}>
              一键写入
            </Text>
          </Pressable>
        ) : null}
      </View>
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
        {moreCount > 0 ? (
          <Text style={[Typography.caption, { color: colors.textMuted }]} maxFontSizeMultiplier={1.35}>
            另有 {moreCount} 条未展示
          </Text>
        ) : null}
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
