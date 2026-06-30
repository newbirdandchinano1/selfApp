import { DailyReviewGridView } from '@/components/review/daily-review-grid-view';
import { formatReviewHeaderDate, loadReviewPeriodSnapshot } from '@/components/review/review-utils';
import { ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Spacing } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'tabs/review';

export function ReviewHubScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const [selectedYmd, setSelectedYmd] = useState(todayYmd);

  useEffect(() => {
    setSelectedYmd(todayYmd);
  }, [todayYmd]);

  const reload = useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        await loadReviewPeriodSnapshot(todayYmd);
      }, forceApi);
    },
    [todayYmd, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);
  usePageFocusReload(PAGE_API_KEY, reload);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="复盘"
        subtitle={formatReviewHeaderDate(todayYmd)}
        right={
          <ScreenHeaderIconAction
            icon="calendar-today"
            onPress={() => router.push('/review-calendar')}
            accessibilityLabel="复盘日历"
          />
        }
      />

      <View style={styles.content}>
        <DailyReviewGridView
          ymd={selectedYmd}
          onYmdChange={setSelectedYmd}
          pageApiKey={PAGE_API_KEY}
          refreshControl={refreshControl}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    paddingTop: Spacing.xl,
  },
});
