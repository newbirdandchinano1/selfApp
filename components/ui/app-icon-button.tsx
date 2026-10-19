import React from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { getMinTouchTarget, Motion, Radius } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

import { AppIcon, type AppIconName } from './app-icon';
import { MotionPressable } from './motion-pressable';

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
    <MotionPressable
      accessibilityRole="button"
      disabled={disabled}
      pressScale={Motion.pressScaleButton}
      pressOpacity={Motion.pressOpacityButton}
      style={[
        styles.btn,
        {
          width: touchTarget,
          height: touchTarget,
        },
        style,
      ]}
      {...pressableProps}>
      <View style={disabled ? styles.disabledContent : undefined}>
        <AppIcon name={icon} size={size} color={tint} />
      </View>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: Radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledContent: {
    opacity: 0.4,
  },
});
