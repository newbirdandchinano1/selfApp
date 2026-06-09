import {
  DailyReviewContentCard,
  ReviewHistoryFoldBar,
  ReviewQuickActions,
  ReviewWeekStrip,
} from '@/components/review/review-ui-parts';
import {
  countEditableDailyEntries,
  countFilledDailyEntries,
  dailyEntryHasContent,
  formatReviewHeaderDate,
  getYesterdayYmd,
  isDailySkipped,
  loadReviewPeriodSnapshot,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
  type DailyEntry,
} from '@/components/review/review-utils';
import { ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ReviewPeriodSnapshot } from './review-utils';

const PAGE_API_KEY = 'tabs/review';

function splitDailyEntries(
  entries: DailyEntry[],
  todayYmd: string,
  yesterdayYmd: string,
  isSkipped: (ymd: string) => boolean,
): { historyEntries: DailyEntry[]; historyFilledCount: number } {
  const historyEntries = entries.filter(e => {
    if (e.ymd >= yesterdayYmd) return false;
    if (isSkipped(e.ymd)) return false;
    return true;
  });
  const historyFilledCount = historyEntries.filter(e => dailyEntryHasContent(e.fields)).length;
  return { historyEntries, historyFilledCount };
}

export function ReviewHubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<ReviewPeriodSnapshot | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const reload = useCallback(
    async (forceApi = false) => {
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const data = await loadReviewPeriodSnapshot(todayYmd);
          setSnapshot(data);
        }, forceApi);
      } catch {
        setSnapshot(null);
      } finally {
        setLoading(false);
      }
    },
    [todayYmd, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      if (shouldSkipPageFocusApiRefresh(PAGE_API_KEY)) return;
      void reload();
    }, [reload]),
  );

  const yesterdayYmd = getYesterdayYmd(todayYmd);
  const todayEntry = snapshot?.dailyEntries.find(e => e.ymd === todayYmd) ?? null;
  const yesterdayEntry = snapshot?.dailyEntries.find(e => e.ymd === yesterdayYmd) ?? null;

  const filledCount = snapshot
    ? countFilledDailyEntries(snapshot.dailyEntries, snapshot.reviewCycleEndYmd, snapshot.configuredDow)
    : 0;
  const editableCount = snapshot
    ? countEditableDailyEntries(snapshot.dailyEntries, snapshot.reviewCycleEndYmd, snapshot.configuredDow, todayYmd)
    : 0;

  const todaySkipped = snapshot
    ? isDailySkipped(todayYmd, snapshot.reviewCycleEndYmd, snapshot.configuredDow)
    : false;
  const yesterdaySkipped = snapshot
    ? isDailySkipped(yesterdayYmd, snapshot.reviewCycleEndYmd, snapshot.configuredDow)
    : false;

  const dailyTemplate = snapshot?.dailyTemplate ?? [];
  const todayHasContent = todayEntry ? dailyEntryHasContent(todayEntry.fields) : false;
  const yesterdayHasContent = yesterdayEntry ? dailyEntryHasContent(yesterdayEntry.fields) : false;

  const isSkipped = useCallback(
    (ymd: string) =>
      snapshot ? isDailySkipped(ymd, snapshot.reviewCycleEndYmd, snapshot.configuredDow) : false,
    [snapshot],
  );

  const { historyEntries, historyFilledCount } = useMemo(
    () =>
      snapshot
        ? splitDailyEntries(snapshot.dailyEntries, todayYmd, yesterdayYmd, isSkipped)
        : { historyEntries: [], historyFilledCount: 0 },
    [snapshot, todayYmd, yesterdayYmd, isSkipped],
  );

  const hasHistory = historyEntries.length > 0;

  const goDaily = useCallback(
    (ymd: string) => router.push({ pathname: '/daily-review/[ymd]', params: { ymd } }),
    [router],
  );

  const toggleHistory = useCallback(() => setHistoryExpanded(v => !v), []);

  const weeklyQuickLabel = useMemo(() => {
    if (!snapshot) return '每周复盘';
    if (snapshot.canEditWeekly) return '今日写周复盘';
    if (snapshot.configuredDow === null) return '每周复盘';
    return `周${WEEKLY_REVIEW_WEEKDAY_LABELS[snapshot.configuredDow]}`;
  }, [snapshot]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="复盘"
        subtitle={formatReviewHeaderDate(todayYmd)}
        right={
          <View style={styles.headerActions}>
            {hasHistory ? (
              <ScreenHeaderIconAction
                icon={historyExpanded ? 'unfold-less' : 'unfold-more'}
                onPress={toggleHistory}
                accessibilityLabel={historyExpanded ? '收起历史复盘' : '展开历史复盘'}
              />
            ) : null}
            <ScreenHeaderIconAction
              icon="calendar-today"
              onPress={() => router.push('/review-calendar')}
              accessibilityLabel="复盘日历"
            />
          </View>
        }
      />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.xl) },
          ]}>
          {snapshot ? (
            <ReviewWeekStrip
              entries={snapshot.dailyEntries}
              todayYmd={todayYmd}
              yesterdayYmd={yesterdayYmd}
              filledCount={filledCount}
              editableCount={editableCount}
              isDark={isDark}
              isSkipped={isSkipped}
              colors={{
                primary: colors.primary,
                success: colors.success,
                text: colors.text,
                textMuted: colors.textMuted,
                outline: colors.outline,
                surface: colors.surface,
              }}
              onDayPress={goDaily}
              onListPress={() => router.push('/daily-review')}
            />
          ) : null}

          {!yesterdaySkipped && yesterdayEntry ? (
            <View style={styles.section}>
              <DailyReviewContentCard
                dateLabel={yesterdayEntry.label}
                tagLabel="昨天"
                fields={yesterdayEntry.fields}
                template={dailyTemplate}
                hasContent={yesterdayHasContent}
                emptyHint="昨天还没有写下复盘，点这里补记"
                accentColor={colors.primary}
                isDark={isDark}
                surface={colors.surface}
                textColor={colors.text}
                mutedColor={colors.textMuted}
                borderColor={colors.outline}
                onPress={() => goDaily(yesterdayYmd)}
              />
            </View>
          ) : null}

          {!todaySkipped && todayEntry ? (
            <View style={styles.section}>
              <DailyReviewContentCard
                dateLabel={todayEntry.label}
                tagLabel="今天"
                fields={todayEntry.fields}
                template={dailyTemplate}
                hasContent={todayHasContent}
                emptyHint="今天还没有写下复盘，点这里开始记录"
                accentColor={colors.success}
                isDark={isDark}
                surface={colors.surface}
                textColor={colors.text}
                mutedColor={colors.textMuted}
                borderColor={isDark ? 'rgba(52,211,153,0.35)' : 'rgba(0,108,73,0.22)'}
                onPress={() => goDaily(todayYmd)}
              />
            </View>
          ) : snapshot?.canEditWeekly ? (
            <View style={[styles.weeklyBanner, { backgroundColor: isDark ? `${colors.primary}22` : `${colors.primary}10`, borderColor: colors.outline }]}>
              <Text style={[Typography.title, { color: colors.text }]}>今天是复盘日</Text>
              <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 21 }]}>
                {snapshot.weekRangeLabel} · 请填写每周复盘，无需单独做日复盘
              </Text>
            </View>
          ) : null}

          {hasHistory ? (
            <View style={styles.section}>
              <ReviewHistoryFoldBar
                dayCount={historyEntries.length}
                filledCount={historyFilledCount}
                expanded={historyExpanded}
                mutedColor={colors.textMuted}
                textColor={colors.text}
                primaryColor={colors.primary}
                borderColor={colors.outline}
                surface={colors.surface}
                onPress={toggleHistory}
              />
              {historyExpanded
                ? historyEntries.map(entry => (
                    <DailyReviewContentCard
                      key={entry.ymd}
                      dateLabel={entry.label}
                      fields={entry.fields}
                      template={dailyTemplate}
                      hasContent={dailyEntryHasContent(entry.fields)}
                      emptyHint="这一天还没有写下复盘，点这里补记"
                      accentColor={colors.textMuted}
                      isDark={isDark}
                      surface={colors.surface}
                      textColor={colors.text}
                      mutedColor={colors.textMuted}
                      borderColor={colors.outline}
                      onPress={() => goDaily(entry.ymd)}
                    />
                  ))
                : null}
            </View>
          ) : null}

          <ReviewQuickActions
            isDark={isDark}
            surface={colors.surface}
            borderColor={colors.outline}
            items={[
              {
                icon: 'auto-stories',
                label: weeklyQuickLabel,
                color: colors.primary,
                onPress: () => router.push('/weekly-review-form'),
              },
              {
                icon: 'calendar-month',
                label: '复盘日历',
                color: colors.primary,
                onPress: () => router.push('/review-calendar'),
              },
              {
                icon: 'settings',
                label: '设置',
                color: colors.tertiary,
                onPress: () => router.push('/review-settings'),
              },
            ]}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.xl,
    gap: Spacing['3xl'],
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  section: { gap: Spacing.lg },
  weeklyBanner: {
    borderRadius: 18,
    borderWidth: 1,
    padding: Spacing['3xl'],
    gap: Spacing.sm,
  },
});
