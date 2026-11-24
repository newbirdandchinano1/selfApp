/**
 * 短暂消息气泡 — 克制出现，不持续打扰。
 */
import type { AgentPetBubble, AgentPetSide } from '@/components/agent-pet/types/agentPet.types';
import { useAppTheme } from '@/hooks/use-app-theme';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

type Props = {
  bubble: AgentPetBubble | null;
  side: AgentPetSide;
  onPress?: () => void;
  onDismiss?: () => void;
};

export function PetBubble({ bubble, side, onPress, onDismiss }: Props) {
  const { colors, isDark, typography } = useAppTheme();

  if (!bubble) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      exiting={FadeOutUp.duration(220)}
      style={[
        styles.wrap,
        side === 'right' ? styles.alignRight : styles.alignLeft,
      ]}>
      <Pressable
        onPress={onPress}
        onLongPress={onDismiss}
        style={[
          styles.bubble,
          {
            backgroundColor: isDark ? 'rgba(27,36,32,0.94)' : 'rgba(255,252,247,0.96)',
            borderColor: isDark ? 'rgba(169,199,185,0.28)' : 'rgba(30,57,50,0.12)',
          },
        ]}>
        <Text
          numberOfLines={2}
          style={[
            typography.caption,
            { color: colors.text, lineHeight: 18 },
          ]}>
          {bubble.text}
        </Text>
        <View
          style={[
            styles.tail,
            side === 'right' ? styles.tailRight : styles.tailLeft,
            {
              borderTopColor: isDark ? 'rgba(27,36,32,0.94)' : 'rgba(255,252,247,0.96)',
            },
          ]}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: 8,
    maxWidth: 168,
    zIndex: 2,
  },
  alignRight: {
    right: 0,
  },
  alignLeft: {
    left: 0,
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tail: {
    position: 'absolute',
    bottom: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  tailRight: {
    right: 18,
  },
  tailLeft: {
    left: 18,
  },
});
