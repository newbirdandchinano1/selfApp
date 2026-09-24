import { DailyReviewGridView } from '@/components/review/daily-review-grid-view';
import { MonthlyReviewGridView } from '@/components/review/monthly-review-grid-view';
import { WeeklyReviewGridView } from '@/components/review/weekly-review-grid-view';
import { formatReviewHeaderDate, loadReviewPeriodSnapshot } from '@/components/review/review-utils';
import { ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { getMinTouchTarget, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { REVIEW_PAGE_PADDING_X, reviewContentMaxWidth } from '@/lib/review-layout';
import { isTodayConfiguredWeeklyReviewDay } from '@/lib/weekly-review-settings';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'tabs/review';

/** 主切换仅日/周；月复盘从「更多」进入 */
type ReviewScope = 'daily' | 'weekly' | 'monthly';

const SCOPE_TOGGLE_ORDER: Array<'daily' | 'weekly'> = ['daily', 'weekly'];

const SCOPE_LABEL: Record<ReviewScope, string> = {
  daily: '日复盘',
  weekly: '周复盘',
  monthly: '月复盘',
};

function ReviewScopeToggle({
  value,
  onChange,
}: {
  value: 'daily' | 'weekly';
  onChange: (next: 'daily' | 'weekly') => void;
}) {
  const { colors } = useAppTheme();
  const touchMin = getMinTouchTarget(Platform.OS);

  return (
    <View style={styles.scopeWrap}>
      <View
        style={[styles.scopeTrack, { backgroundColor: colors.capsule }]}
        accessibilityRole="tablist"
        accessibilityLabel="复盘范围">
        {SCOPE_TOGGLE_ORDER.map((scope, index) => {
          const active = value === scope;
          return (
            <Pressable
              key={scope}
              onPress={() => onChange(scope)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${SCOPE_LABEL[scope]}，${index + 1}/${SCOPE_TOGGLE_ORDER.length}`}
              style={({ pressed }) => [
                styles.scopeItem,
                { minHeight: touchMin },
                active && [
                  styles.scopeItemActive,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.outline,
                  },
                ],
                pressed && { opacity: 0.88 },
              ]}>
              <Text
                style={[
                  Typography.bodyStrong,
                  {
                    color: active ? colors.primary : colors.textMuted,
                    fontWeight: active ? '800' : '600',
                  },
                ]}
                maxFontSizeMultiplier={1.35}>
                {SCOPE_LABEL[scope]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ReviewHubScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const [selectedYmd, setSelectedYmd] = useState(todayYmd);
  const [scope, setScope] = useState<ReviewScope>('daily');
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const [monthLabel, setMonthLabel] = useState('');
  const [autoSwitchedWeekly, setAutoSwitchedWeekly] = useState(false);
  const scopeRef = useRef(scope);
  const weeklyReloadRef = useRef<(() => Promise<void>) | null>(null);
  const monthlyReloadRef = useRef<(() => Promise<void>) | null>(null);

  scopeRef.current = scope;

  const contentMaxWidth = useMemo(() => reviewContentMaxWidth(width), [width]);

  useEffect(() => {
    setSelectedYmd(todayYmd);
  }, [todayYmd]);

  const reloadSnapshot = useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        const snapshot = await loadReviewPeriodSnapshot(todayYmd);
        setWeekRangeLabel(snapshot.weekRangeLabel);

        // 周复盘日：首次进入默认切到周视图
        if (
          !autoSwitchedWeekly &&
          snapshot.configuredDow !== null &&
          isTodayConfiguredWeeklyReviewDay(snapshot.configuredDow, new Date())
        ) {
          setScope('weekly');
          setAutoSwitchedWeekly(true);
        }
      }, forceApi);
    },
    [autoSwitchedWeekly, todayYmd, wrapLoad],
  );

  const reload = useCallback(
    async (forceApi = false) => {
      await reloadSnapshot(forceApi);
      if (scopeRef.current === 'weekly') {
        await weeklyReloadRef.current?.();
      } else if (scopeRef.current === 'monthly') {
        await monthlyReloadRef.current?.();
      }
    },
    [reloadSnapshot],
  );

  const registerWeeklyReload = useCallback((fn: () => Promise<void>) => {
    weeklyReloadRef.current = fn;
  }, []);

  const registerMonthlyReload = useCallback((fn: () => Promise<void>) => {
    monthlyReloadRef.current = fn;
  }, []);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);
  usePageFocusReload(PAGE_API_KEY, reload);

  const openHeaderMore = useCallback(() => {
    Alert.alert('更多', undefined, [
      {
        text: '月复盘',
        onPress: () => setScope('monthly'),
      },
      {
        text: '复盘日历',
        onPress: () => router.push('/review-calendar'),
      },
      {
        text: '复盘设置',
        onPress: () => router.push('/review-settings'),
      },
      { text: '取消', style: 'cancel' },
    ]);
  }, [router]);

  const headerSubtitle =
    scope === 'daily'
      ? formatReviewHeaderDate(selectedYmd)
      : scope === 'weekly'
        ? weekRangeLabel || formatReviewHeaderDate(todayYmd)
        : monthLabel || formatReviewHeaderDate(todayYmd);

  const toggleValue: 'daily' | 'weekly' = scope === 'weekly' ? 'weekly' : 'daily';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="复盘"
        subtitle={headerSubtitle}
        right={
          <View style={styles.headerActions}>
            <ScreenHeaderIconAction
              icon="tune"
              onPress={() => router.push(`/review-template-settings?scope=${scope === 'monthly' ? 'monthly' : scope}`)}
              accessibilityLabel="编辑复盘标题与栏目"
            />
            <ScreenHeaderIconAction
              icon="more-horiz"
              onPress={openHeaderMore}
              accessibilityLabel="更多：月复盘、日历与设置"
            />
          </View>
        }
      />

      <View style={[styles.body, contentMaxWidth != null ? { maxWidth: contentMaxWidth } : null]}>
        {scope === 'monthly' ? (
          <View style={styles.monthBar}>
            <Pressable
              onPress={() => setScope('daily')}
              accessibilityRole="button"
              accessibilityLabel="返回日复盘"
              style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}>
              <Text style={[Typography.bodyStrong, { color: colors.primary }]} maxFontSizeMultiplier={1.35}>
                ← 返回日/周
              </Text>
            </Pressable>
            <Text style={[Typography.bodyStrong, { color: colors.text }]} maxFontSizeMultiplier={1.35}>
              月复盘
            </Text>
          </View>
        ) : (
          <ReviewScopeToggle
            value={toggleValue}
            onChange={next => {
              setScope(next);
              if (next === 'weekly') setAutoSwitchedWeekly(true);
            }}
          />
        )}

        <View style={styles.content}>
          {scope === 'daily' ? (
            <DailyReviewGridView
              ymd={selectedYmd}
              onYmdChange={setSelectedYmd}
              pageApiKey={PAGE_API_KEY}
              refreshControl={refreshControl}
              onSwitchToWeekly={() => {
                setScope('weekly');
                setAutoSwitchedWeekly(true);
              }}
            />
          ) : scope === 'weekly' ? (
            <WeeklyReviewGridView
              pageApiKey={PAGE_API_KEY}
              refreshControl={refreshControl}
              onRegisterReload={registerWeeklyReload}
            />
          ) : (
            <MonthlyReviewGridView
              pageApiKey={PAGE_API_KEY}
              refreshControl={refreshControl}
              onRegisterReload={registerMonthlyReload}
              onMonthLabelChange={setMonthLabel}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  body: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
  },
  scopeWrap: {
    paddingHorizontal: REVIEW_PAGE_PADDING_X,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    width: '100%',
  },
  scopeTrack: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    padding: Spacing.xs,
    gap: Spacing.xs,
  },
  scopeItem: {
    flex: 1,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.sm,
  },
  scopeItemActive: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  monthBar: {
    paddingHorizontal: REVIEW_PAGE_PADDING_X,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
  },
});
