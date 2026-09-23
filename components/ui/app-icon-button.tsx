import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { getMinTouchTarget, Radius } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

import { AppIcon, type AppIconName } from './app-icon';

export type AppIconButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  icon: AppIconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
};

export function AppIconButton({
  icon,
  size = 22,
  color,
  style,
  disabled,
  ...pressableProps
}: AppIconButtonProps) {
  const { colors } = useAppTheme();
  const tint = color ?? colors.text;
  const touchTarget = getMinTouchTarget(Platform.OS);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        {
          width: touchTarget,
          height: touchTarget,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
      {...pressableProps}>
      <AppIcon name={icon} size={size} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: Radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
