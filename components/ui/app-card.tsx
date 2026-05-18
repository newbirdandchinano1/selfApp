import React from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

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
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  padded: {
    padding: Spacing['4xl'],
  },
});
