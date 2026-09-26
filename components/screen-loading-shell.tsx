import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export type ScreenLoadingShellProps = {
  loading: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 加载中的提示文案（spinner 模式） */
  hint?: string;
  /**
   * 自定义骨架；传入后加载中展示骨架而非居中 spinner。
   * 首页 Tab 请优先用 HomeSkeletonShell + useHomeSkeletonReveal。
   */
  skeleton?: React.ReactNode;
};

/**
 * 统一页面级加载壳：
 * - 默认 spinner + 文案
 * - 可配置 skeleton 占位
 * - 数据就绪后淡入内容
 */
export function ScreenLoadingShell({
  loading,
  children,
  style,
  hint = '加载中…',
  skeleton,
}: ScreenLoadingShellProps) {
  const { colors } = useAppTheme();
  const opacity = useRef(new Animated.Value(loading ? 0 : 1)).current;

  useEffect(() => {
    if (loading) {
      opacity.setValue(0);
      return;
    }
    Animated.timing(opacity, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [loading, opacity]);

  if (loading) {
    if (skeleton) {
      return <View style={[styles.content, { backgroundColor: colors.background }, style]}>{skeleton}</View>;
    }
    return (
      <View style={[styles.placeholder, { backgroundColor: colors.background }, style]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.hint, { color: colors.text }]}>{hint}</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.content, style, { opacity }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 56,
  },
  hint: {
    fontSize: 15,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
});
