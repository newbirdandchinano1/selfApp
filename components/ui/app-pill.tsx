import React from 'react';
import { Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

export type AppPillProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  selected?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  style?: StyleProp<ViewStyle>;
};

/** 胶囊标签 / 筛选芯片（财务页 trendPill、budgetPctCapsule） */
export function AppPill({
  label,
  selected = false,
  tone = 'default',
  style,
  ...pressableProps
}: AppPillProps) {
  const { colors, isDark } = useAppTheme();

  const bg =
    tone === 'primary'
      ? selected
        ? colors.primaryMuted
        : isDark
          ? colors.surfaceMuted
          : colors.capsule
      : tone === 'danger'
        ? isDark
          ? 'rgba(220,38,38,0.2)'
          : 'rgba(220,38,38,0.1)'
        : selected
          ? colors.primaryMuted
          : isDark
            ? colors.surfaceMuted
            : colors.capsule;

  const textColor =
    tone === 'primary' || selected
      ? colors.primary
      : tone === 'danger'
        ? colors.danger
        : colors.textSecondary;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: bg, borderColor: selected ? colors.primary : colors.outline },
        pressed && { opacity: 0.88 },
        style,
      ]}
      {...pressableProps}>
      <Text style={[styles.text, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
});
