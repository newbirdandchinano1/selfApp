import { DailyReviewGridView } from '@/components/review/daily-review-grid-view';
import { WeeklyReviewGridView } from '@/components/review/weekly-review-grid-view';
import { formatReviewHeaderDate, loadReviewPeriodSnapshot } from '@/components/review/review-utils';
import { ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'tabs/review';

type ReviewScope = 'daily' | 'weekly';

function ReviewScopeToggle({
  value,
  onChange,
}: {
  value: ReviewScope;
  onChange: (next: ReviewScope) => void;
}) {
  const { colors, isDark } = useAppTheme();

  return (
    <View style={styles.scopeWrap}>
      <View style={[styles.scopeTrack, { backgroundColor: isDark ? 'rgba(30,41,59,0.65)' : colors.capsule }]}>
        {(['daily', 'weekly'] as const).map(scope => {
          const active = value === scope;
          return (
            <Pressable
              key={scope}
              onPress={() => onChange(scope)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={scope === 'daily' ? '日复盘' : '周复盘'}
              style={({ pressed }) => [
                styles.scopeItem,
                active && [
                  styles.scopeItemActive,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isDark ? 'rgba(148,163,184,0.25)' : colors.outline,
                  },
                ],
                pressed && { opacity: 0.88 },
              ]}>
              <Text
                style={[
                  styles.scopeText,
                  { color: active ? colors.primary : colors.textMuted, fontWeight: active ? '800' : '600' },
                ]}>
                {scope === 'daily' ? '日复盘' : '周复盘'}
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
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const [selectedYmd, setSelectedYmd] = useState(todayYmd);
  const [scope, setScope] = useState<ReviewScope>('daily');
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const scopeRef = useRef(scope);
  const weeklyReloadRef = useRef<(() => Promise<void>) | null>(null);

  scopeRef.current = scope;

  useEffect(() => {
    setSelectedYmd(todayYmd);
  }, [todayYmd]);

  const reloadSnapshot = useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        const snapshot = await loadReviewPeriodSnapshot(todayYmd);
        setWeekRangeLabel(snapshot.weekRangeLabel);
      }, forceApi);
    },
    [todayYmd, wrapLoad],
  );

  const reload = useCallback(
    async (forceApi = false) => {
      await reloadSnapshot(forceApi);
      if (scopeRef.current === 'weekly') {
        await weeklyReloadRef.current?.();
      }
    },
    [reloadSnapshot],
  );

  const registerWeeklyReload = useCallback((fn: () => Promise<void>) => {
    weeklyReloadRef.current = fn;
  }, []);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);
  usePageFocusReload(PAGE_API_KEY, reload);

  const headerSubtitle =
    scope === 'daily'
      ? formatReviewHeaderDate(selectedYmd)
      : weekRangeLabel || formatReviewHeaderDate(todayYmd);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="复盘"
        subtitle={headerSubtitle}
        right={
          <View style={styles.headerActions}>
            <ScreenHeaderIconAction
              icon="tune"
              onPress={() => router.push(`/review-template-settings?scope=${scope}`)}
              accessibilityLabel="编辑复盘标题与栏目"
            />
            <ScreenHeaderIconAction
              icon="calendar-today"
              onPress={() => router.push('/review-calendar')}
              accessibilityLabel="复盘日历"
            />
            <ScreenHeaderIconAction
              icon="settings"
              onPress={() => router.push('/review-settings')}
              accessibilityLabel="复盘设置"
            />
          </View>
        }
      />

      <ReviewScopeToggle value={scope} onChange={setScope} />

      <View style={[styles.content, scope === 'daily' && styles.contentDaily]}>
        {scope === 'daily' ? (
          <DailyReviewGridView
            ymd={selectedYmd}
            onYmdChange={setSelectedYmd}
            pageApiKey={PAGE_API_KEY}
            refreshControl={refreshControl}
            onSwitchToWeekly={() => setScope('weekly')}
          />
        ) : (
          <WeeklyReviewGridView
            pageApiKey={PAGE_API_KEY}
            refreshControl={refreshControl}
            onRegisterReload={registerWeeklyReload}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  scopeWrap: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  scopeTrack: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    padding: 4,
    gap: 4,
  },
  scopeItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  scopeItemActive: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  scopeText: {
    fontSize: 14,
    letterSpacing: 0.1,
  },
  content: {
    flex: 1,
  },
  contentDaily: {
    paddingTop: Spacing.sm,
  },
});






