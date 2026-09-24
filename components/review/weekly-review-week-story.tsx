import {
  dailyEntryHasContent,
  formatMetricInt,
  type DailyEntry,
} from '@/components/review/review-utils';
import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { previewTextFromFields } from '@/lib/repositories/insights/review-journal-body';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** 周视图上半：这周做了什么（日刊时间线 + 指标摘要） */
export function WeeklyReviewWeekStory({
  dailyEntries,
  dailyTemplate,
  metrics,
  skippedYmds,
}: {
  dailyEntries: DailyEntry[];
  dailyTemplate: ReviewDimensionTemplate[];
  metrics: WeeklyReviewMetrics | null;
  skippedYmds: Set<string>;
}) {
  const { colors } = useAppTheme();
  const allCols = useMemo(() => dailyTemplate.flatMap(d => d.columns), [dailyTemplate]);

  const metricsLine = useMemo(() => {
    if (!metrics) return null;
    const bits: string[] = [];
    if (metrics.tasksCompleted > 0) bits.push(`完成 ${formatMetricInt(metrics.tasksCompleted)} 项任务`);
    if (metrics.habitCheckInTotal > 0) bits.push(`打卡 ${formatMetricInt(metrics.habitCheckInTotal)} 次`);
    if (metrics.savingsWeekTotal > 0) bits.push(`存钱 ¥${formatMetricInt(metrics.savingsWeekTotal)}`);
    return bits.length ? bits.join(' · ') : '本周应用内数据较少';
  }, [metrics]);

  return (
    <View style={styles.stack}>
      <ReviewSectionCard style={styles.card}>
        <View style={styles.head}>
          <MaterialIcons name="timeline" size={20} color={colors.primary} />
          <Text style={[Typography.bodyStrong, { color: colors.text }]} maxFontSizeMultiplier={1.35}>
            这周做了什么
          </Text>
        </View>
        {metricsLine ? (
          <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 20 }]} maxFontSizeMultiplier={1.35}>
            {metricsLine}
          </Text>
        ) : null}

        <View style={styles.timeline}>
          {dailyEntries.map(entry => {
            const skipped = skippedYmds.has(entry.ymd);
            const filled = !skipped && dailyEntryHasContent(entry.fields);
            const preview = filled ? previewTextFromFields(entry.fields, allCols) : '';
            const short = preview.length > 72 ? `${preview.slice(0, 72)}…` : preview;

            return (
              <View key={entry.ymd} style={[styles.dayRow, { borderLeftColor: filled ? colors.success : colors.outline }]}>
                <Text style={[Typography.caption, { color: colors.textMuted }]} maxFontSizeMultiplier={1.35}>
                  {entry.label}
                </Text>
                <Text
                  style={[
                    Typography.body,
                    {
                      color: skipped ? colors.primary : filled ? colors.text : colors.textMuted,
                      lineHeight: 20,
                    },
                  ]}
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.35}>
                  {skipped ? '周复盘日' : filled ? short || '（已填写）' : '未填写'}
                </Text>
              </View>
            );
          })}
        </View>
      </ReviewSectionCard>

      <Text style={[Typography.caption, { color: colors.textMuted, paddingHorizontal: Spacing.xs }]} maxFontSizeMultiplier={1.35}>
        下方撰写本周总复盘
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.md,
  },
  card: {
    gap: Spacing.md,
    paddingVertical: Spacing['3xl'],
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  timeline: {
    gap: Spacing.md,
  },
  dayRow: {
    gap: Spacing.xs,
    paddingLeft: Spacing.lg,
    borderLeftWidth: 3,
    borderRadius: Radius.xs,
  },
});
