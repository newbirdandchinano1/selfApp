import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { getMinTouchTarget, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

export type ScreenEmptyStateProps = {
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** 列表 / 详情通用空态：图标 + 标题 + 可选副文案与主操作 */
export function ScreenEmptyState({
  icon = 'inbox',
  title,
  subtitle,
  actionLabel,
  onAction,
  style,
}: ScreenEmptyStateProps) {
  const { colors } = useAppTheme();
  const touchMin = useMemo(() => getMinTouchTarget(Platform.OS), []);

  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryMuted }]}>
        <MaterialIcons name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.35}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.35}>
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: colors.primary,
              minHeight: touchMin,
              opacity: pressed ? 0.88 : 1,
            },
          ]}>
          <Text style={[styles.actionLabel, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.35}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 72,
    paddingHorizontal: Spacing['6xl'],
    gap: Spacing.md,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.body,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },
  action: {
    marginTop: Spacing.md,
    alignSelf: 'stretch',
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['3xl'],
  },
  actionLabel: {
    ...Typography.bodyStrong,
  },
});
