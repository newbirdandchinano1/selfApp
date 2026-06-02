import React from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { PullRefreshScrollView } from '@/components/pull-refresh-scroll-view';
import { ScreenLoadingShell } from '@/components/screen-loading-shell';
import { Layout, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

export type AppScreenProps = {
  children: React.ReactNode;
  header?: React.ReactNode;
  scrollable?: boolean;
  loading?: boolean;
  loadingHint?: string;
  /** 下拉刷新时重新拉取页面数据 */
  onRefreshData?: () => Promise<void>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
  scrollProps?: Omit<ScrollViewProps, 'style' | 'contentContainerStyle' | 'children'>;
};

/** 标准页面容器：背景色 + 最大宽度内容区（财务页 content） */
export function AppScreen({
  children,
  header,
  scrollable = true,
  loading = false,
  loadingHint,
  onRefreshData,
  contentContainerStyle,
  style,
  edges = ['left', 'right'],
  scrollProps,
}: AppScreenProps) {
  const { colors } = useAppTheme();

  const body = (
    <ScreenLoadingShell loading={loading} hint={loadingHint} style={styles.shell}>
      <View style={[styles.content, contentContainerStyle]}>{children}</View>
    </ScreenLoadingShell>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }, style]} edges={edges}>
      {header}
      {scrollable ? (
        onRefreshData ? (
          <PullRefreshScrollView
            onRefreshData={onRefreshData}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            {...scrollProps}>
            {body}
          </PullRefreshScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            {...scrollProps}>
            {body}
          </ScrollView>
        )
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  shell: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    gap: Spacing['4xl'],
  },
});
