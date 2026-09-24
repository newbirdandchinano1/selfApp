import { DailyReviewGridView } from '@/components/review/daily-review-grid-view';
import { formatReviewHeaderDate } from '@/components/review/review-utils';
import { ScreenHeader } from '@/components/ui';
import { Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { reviewContentMaxWidth } from '@/lib/review-layout';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'daily-review-edit';

export function DailyReviewEditScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ ymd?: string | string[] }>();
  const ymd = (Array.isArray(params.ymd) ? params.ymd[0] : params.ymd)?.trim() ?? '';
  const contentMaxWidth = useMemo(() => reviewContentMaxWidth(width), [width]);

  const headerTitle = useMemo(() => (ymd ? formatReviewHeaderDate(ymd) : '每日复盘'), [ymd]);

  if (!ymd) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <ScreenHeader title="每日复盘" onBack={() => router.back()} />
        <View style={styles.centered}>
          <Text style={{ color: colors.textMuted }}>无效日期</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader title={headerTitle} onBack={() => router.back()} />
      <View style={[styles.content, contentMaxWidth != null ? { maxWidth: contentMaxWidth } : null]}>
        <DailyReviewGridView ymd={ymd} pageApiKey={PAGE_API_KEY} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    paddingTop: Spacing.sm,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
