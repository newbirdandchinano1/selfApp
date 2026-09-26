import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

export type ScreenErrorBannerProps = {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** 页面内联错误条：文案 + 可选点击重试 */
export function ScreenErrorBanner({
  message,
  onRetry,
  retryLabel = '点击重试',
  style,
}: ScreenErrorBannerProps) {
  const { colors, isDark } = useAppTheme();
  const border = isDark ? 'rgba(148,163,184,0.22)' : colors.outlineStrong;

  return (
    <Pressable
      onPress={onRetry}
      disabled={!onRetry}
      accessibilityRole={onRetry ? 'button' : undefined}
      accessibilityLabel={onRetry ? `${message}，${retryLabel}` : message}
      style={[styles.banner, { borderColor: border, backgroundColor: colors.surface }, style]}>
      <Text style={[styles.message, { color: colors.text }]} maxFontSizeMultiplier={1.35}>
        {message}
      </Text>
      {onRetry ? (
        <Text style={[styles.retry, { color: colors.primary }]} maxFontSizeMultiplier={1.35}>
          {retryLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: Spacing['5xl'],
    marginTop: Spacing.md,
    padding: Spacing['3xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    gap: 4,
  },
  message: {
    ...Typography.body,
  },
  retry: {
    ...Typography.caption,
    fontWeight: '700',
  },
});
