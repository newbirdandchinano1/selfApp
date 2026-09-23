import { HealthIntakeTrendSection } from '@/components/health/health-intake-trend-section';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Layout, Spacing } from '@/constants/design-tokens';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** 健康摄入趋势二级页（首页仅保留每周趋势，分析入口跳转至此） */
export default function HealthAnalysisScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { logicalTodayDate } = usePageDayBoundary('health');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader title="健康分析" subtitle="摄入趋势" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <HealthIntakeTrendSection logicalToday={logicalTodayDate} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing['3xl'],
    paddingBottom: Spacing['6xl'],
  },
});
