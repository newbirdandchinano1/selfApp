import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Layout, Radius } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

export type AppIconButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  icon: keyof typeof MaterialIcons.glyphMap;
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

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
      {...pressableProps}>
      <MaterialIcons name={icon} size={size} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
    borderRadius: Radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
