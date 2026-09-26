import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

export type ScreenMissingStateProps = {
  message?: string;
  style?: StyleProp<ViewStyle>;
};

/** 详情/编辑找不到资源时的占位 */
export function ScreenMissingState({
  message = '未找到该内容',
  style,
}: ScreenMissingStateProps) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.wrap, style]}>
      <Text style={[styles.text, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.35}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['6xl'],
  },
  text: {
    ...Typography.body,
    fontWeight: '600',
    textAlign: 'center',
  },
});
