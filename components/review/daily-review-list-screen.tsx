import {
  dailyEntryHasContent,
  getYesterdayYmd,
  isDailyReviewEditableYmd,
  isDailySkipped,
  loadReviewPeriodSnapshot,
  type DailyEntry,
} from '@/components/review/review-utils';
import { ReviewListSkeleton } from '@/components/review/review-home-skeletons';
import { ScreenHeader } from '@/components/ui';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { previewTextFromFields } from '@/lib/repositories/insights/review-journal-body';
import { resetPageApiSession, shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from "expo-router/react-navigation";
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'daily-review';

export function DailyReviewListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const params = useLocalSearchParams<{ focusYmd?: string | string[] }>();
  const focusYmdParam = Array.isArray(params.focusYmd) ? params.focusYmd[0] : params.focusYmd;
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [loading, setLoading] = useState(true);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [dailyTemplate, setDailyTemplate] = useState<Awaited<ReturnType<typeof loadReviewPeriodSnapshot>>['dailyTemplate']>([]);
  const [dailyPeriodLabel, setDailyPeriodLabel] = useState('');
  const [reviewCycleEndYmd, setReviewCycleEndYmd] = useState('');
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);

  const yesterdayYmd = getYesterdayYmd(todayYmd);
  const allDailyCols = useMemo(() => dailyTemplate.flatMap(d => d.columns), [dailyTemplate]);

  const reload = useCallback(
    async (forceApi = false) => {
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const snapshot = await loadReviewPeriodSnapshot(todayYmd);
          setDailyEntries(snapshot.dailyEntries);
          setDailyTemplate(snapshot.dailyTemplate);
          setDailyPeriodLabel(snapshot.dailyPeriodLabel);
          setReviewCycleEndYmd(snapshot.reviewCycleEndYmd);
          setConfiguredDow(snapshot.configuredDow);
        }, forceApi);
      } catch {
        setDailyEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [todayYmd, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      if (shouldSkipPageFocusApiRefresh(PAGE_API_KEY)) {
        setLoading(false);
        return;
      }
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    return () => resetPageApiSession(PAGE_API_KEY);
  }, []);

  useEffect(() => {
    if (loading || !focusYmdParam?.trim()) return;
    const ymd = focusYmdParam.trim();
    if (!dailyEntries.some(e => e.ymd === ymd)) return;
    router.push({ pathname: '/daily-review/[ymd]', params: { ymd } });
  }, [loading, focusYmdParam, dailyEntries, router]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader title="每日复盘" subtitle={dailyPeriodLabel || undefined} onBack={() => router.back()} />

      {loading ? (
        <ReviewListSkeleton />
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.xl) },
          ]}>
          <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 21 }]}>
            本周期 7 天列表。点某一天进入独立编辑页；周复盘日无需日复盘。
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayStrip}
            style={styles.dayStripScroll}>
            {dailyEntries.map(entry => {
              const skipped = isDailySkipped(entry.ymd, reviewCycleEndYmd, configuredDow);
              const filled = !skipped && dailyEntryHasContent(entry.fields);
              const isToday = entry.ymd === todayYmd;
              const isYesterday = entry.ymd === yesterdayYmd;
              const shortDow = (entry.label.split(' ')[1] ?? '').replace('星期', '周');
              const dayNum = String(Number(entry.ymd.slice(8, 10)));
              return (
                <Pressable
                  key={`chip-${entry.ymd}`}
                  onPress={() => router.push({ pathname: '/daily-review/[ymd]', params: { ymd: entry.ymd } })}
                  style={({ pressed }) => [
                    styles.dayChip,
                    {
                      borderColor: isToday ? colors.success : colors.outline,
                      backgroundColor: isToday ? colors.primaryMuted : colors.surface,
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}>
                  <Text style={[styles.dayChipDow, { color: colors.textMuted }]}>{shortDow}</Text>
                  <Text style={[styles.dayChipNum, { color: colors.text }]}>{dayNum}</Text>
                  {skipped ? (
                    <MaterialIcons name="event-available" size={14} color={colors.primary} />
                  ) : (
                    <View
                      style={[
                        styles.dayChipDot,
                        {
                          backgroundColor: filled ? colors.success : colors.outlineStrong,
                        },
                      ]}
                    />
                  )}
                  {isToday ? (
                    <Text style={[styles.dayChipTag, { color: colors.success }]}>今</Text>
                  ) : isYesterday ? (
                    <Text style={[styles.dayChipTag, { color: colors.primary }]}>昨</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.list}>
            {dailyEntries.map(entry => {
              const skipped = isDailySkipped(entry.ymd, reviewCycleEndYmd, configuredDow);
              const canEdit = !skipped && isDailyReviewEditableYmd(entry.ymd, todayYmd);
              const filled = !skipped && dailyEntryHasContent(entry.fields);
              const previewRaw = previewTextFromFields(entry.fields, allDailyCols);
              const previewShort = previewRaw.length > 56 ? `${previewRaw.slice(0, 56)}…` : previewRaw || '（未填写）';

              return (
                <Pressable
                  key={entry.ymd}
                  onPress={() => router.push({ pathname: '/daily-review/[ymd]', params: { ymd: entry.ymd } })}
                  style={({ pressed }) => [
                    styles.row,
                    Shadows.card,
                    {
                      backgroundColor: colors.surface,
                      borderColor: entry.ymd === todayYmd ? colors.success : colors.outline,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                    <View style={styles.rowHead}>
                      <Text style={[Typography.title, { color: colors.text }]}>{entry.label}</Text>
                      {entry.ymd === todayYmd ? (
                        <View style={[styles.tag, { backgroundColor: colors.primaryMuted }]}>
                          <Text style={{ fontSize: 10, fontWeight: '900', color: colors.success }}>今天</Text>
                        </View>
                      ) : entry.ymd === yesterdayYmd ? (
                        <View style={[styles.tag, { backgroundColor: colors.primaryMuted }]}>
                          <Text style={{ fontSize: 10, fontWeight: '900', color: colors.primary }}>昨天</Text>
                        </View>
                      ) : null}
                      {skipped ? (
                        <Text style={[Typography.caption, { color: colors.primary }]}>周复盘日</Text>
                      ) : !canEdit ? (
                        <Text style={[Typography.caption, { color: colors.textMuted }]}>未来</Text>
                      ) : filled ? (
                        <Text style={[Typography.caption, { color: colors.success }]}>已填</Text>
                      ) : (
                        <Text style={[Typography.caption, { color: colors.textMuted }]}>待填</Text>
                      )}
                    </View>
                    <Text style={[Typography.body, { color: colors.textMuted }]} numberOfLines={2}>
                      {skipped ? '请填写每周复盘' : previewShort}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.xl,
    gap: Spacing['3xl'],
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  dayStripScroll: { marginHorizontal: -Spacing.xs },
  dayStrip: { gap: Spacing.md, paddingHorizontal: Spacing.xs, paddingVertical: Spacing.xs },
  dayChip: {
    width: 56,
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  dayChipDow: { fontSize: 10, fontWeight: '800' },
  dayChipNum: { fontSize: 18, fontWeight: '900' },
  dayChipDot: { width: 8, height: 8, borderRadius: 4 },
  dayChipTag: { fontSize: 9, fontWeight: '900', marginTop: -2 },
  list: { gap: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing['3xl'],
    paddingHorizontal: Spacing['3xl'],
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  tag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
});
