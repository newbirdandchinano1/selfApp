import React from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Motion, Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

import { MotionPressable } from './motion-pressable';

export type AppCardVariant = 'default' | 'muted' | 'accent';

export type AppCardProps = {
  children: React.ReactNode;
  variant?: AppCardVariant;
  onPress?: PressableProps['onPress'];
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
};

export function AppCard({
  children,
  variant = 'default',
  onPress,
  style,
  padded = true,
}: AppCardProps) {
  const { colors } = useAppTheme();

  const backgroundColor =
    variant === 'accent'
      ? colors.accentCard
      : variant === 'muted'
        ? colors.surfaceSubtle
        : colors.surface;

  const content = (
    <View
      style={[
        styles.card,
        padded && styles.padded,
        {
          backgroundColor,
          borderColor: variant === 'accent' ? 'transparent' : colors.outline,
        },
        style,
      ]}>
      {children}
    </View>
  );

  if (onPress) {
    return (
      <MotionPressable
        onPress={onPress}
        pressScale={Motion.pressScaleCard}
        pressOpacity={1}
        accessibilityRole="button">
        {content}
      </MotionPressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  padded: {
    padding: Spacing['4xl'],
  },
});
