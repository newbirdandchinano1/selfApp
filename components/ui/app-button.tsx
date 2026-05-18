import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

export type AppButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type AppButtonSize = 'sm' | 'md' | 'lg';

export type AppButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

export function AppButton({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  style,
  labelStyle,
  ...pressableProps
}: AppButtonProps) {
  const { colors, isDark } = useAppTheme();

  const palette = React.useMemo(() => {
    switch (variant) {
      case 'primary':
        return {
          bg: colors.primary,
          text: colors.onPrimary,
          border: colors.primary,
        };
      case 'secondary':
        return {
          bg: isDark ? colors.surfaceMuted : colors.capsule,
          text: colors.primary,
          border: colors.outline,
        };
      case 'outline':
        return {
          bg: 'transparent',
          text: colors.text,
          border: colors.outline,
        };
      case 'ghost':
        return {
          bg: 'transparent',
          text: colors.primary,
          border: 'transparent',
        };
      case 'danger':
        return {
          bg: colors.danger,
          text: colors.onPrimary,
          border: colors.danger,
        };
      default:
        return {
          bg: colors.primary,
          text: colors.onPrimary,
          border: colors.primary,
        };
    }
  }, [variant, colors, isDark]);

  const sizeStyle = sizeStyles[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        sizeStyle.container,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.88 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      {...pressableProps}>
      {loading ? (
        <ActivityIndicator color={palette.text} size="small" />
      ) : (
        <Text
          style={[
            styles.label,
            sizeStyle.label,
            { color: palette.text },
            labelStyle,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const sizeStyles = {
  sm: StyleSheet.create({
    container: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.xl,
      borderRadius: Radius.md,
    },
    label: { fontSize: 13, fontWeight: '800' },
  }),
  md: StyleSheet.create({
    container: {
      paddingVertical: Spacing['2xl'],
      paddingHorizontal: Spacing['3xl'],
      borderRadius: Radius.lg,
    },
    label: { fontSize: 15, fontWeight: '800' },
  }),
  lg: StyleSheet.create({
    container: {
      paddingVertical: Spacing['2xl'],
      paddingHorizontal: Spacing['4xl'],
      borderRadius: Radius.lg,
    },
    label: { fontSize: 16, fontWeight: '800' },
  }),
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  label: {
    letterSpacing: -0.2,
  },
});
