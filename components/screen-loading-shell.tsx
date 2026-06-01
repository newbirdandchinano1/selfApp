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
  /** 加载中的提示文案 */
  hint?: string;
};

/**
 * 页面级加载壳：加载中显示占位，数据就绪后淡入内容（避免 spinner 与列表硬切换）。
 */
export function ScreenLoadingShell({
  loading,
  children,
  style,
  hint = '加载中…',
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
    return (
      <View style={[styles.placeholder, style]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>
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
    gap: 10,
    paddingVertical: 48,
  },
  hint: {
    fontSize: 13,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
});
