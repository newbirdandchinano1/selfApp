import { DailyReviewGridView } from '@/components/review/daily-review-grid-view';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { reviewContentMaxWidth } from '@/lib/review-layout';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'daily-review-edit';

export function DailyReviewEditScreen() {
  const router = useRouter();
  const { palette } = useFoldTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ ymd?: string | string[] }>();
  const ymd = (Array.isArray(params.ymd) ? params.ymd[0] : params.ymd)?.trim() ?? '';
  const contentMaxWidth = useMemo(() => reviewContentMaxWidth(width), [width]);

  if (!ymd) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.paper }]}>
        <View style={styles.centered}>
          <Text
            onPress={() => router.back()}
            accessibilityRole="button"
            style={{ color: palette.muted }}>
            日期无效，点此返回
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: palette.paper }]}
      edges={['left', 'right']}>
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
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
