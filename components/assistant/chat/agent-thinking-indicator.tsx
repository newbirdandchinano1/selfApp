/**
 * Agent 等待态：三点呼吸 + 真实阶段文案（思考 / 工具 / 整理）。
 * 首 token 到达后由气泡切到流式正文。
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { TypingDots } from '@/components/assistant/chat/typing-dots';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import type { AgentThinkingState } from '@/lib/assistant/agent-thinking-status';

type Props = {
  state: AgentThinkingState;
  visible?: boolean;
};

export function AgentThinkingIndicator({ state, visible = true }: Props) {
  const { colors } = useAppTheme();
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const rootOpacity = useSharedValue(visible ? 1 : 0);
  const motionOff = !motionReady || reduceMotion;

  React.useEffect(() => {
    if (motionOff) {
      rootOpacity.value = visible ? 1 : 0;
      return;
    }
    rootOpacity.value = withTiming(visible ? 1 : 0, {
      duration: visible ? 180 : 260,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });
  }, [motionOff, rootOpacity, visible]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));

  const labelOpacity = useSharedValue(1);
  React.useEffect(() => {
    if (motionOff) {
      labelOpacity.value = 1;
      return;
    }
    labelOpacity.value = 0.4;
    labelOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(labelOpacity);
  }, [labelOpacity, motionOff, state.label]);

  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));

  return (
    <Animated.View
      style={[styles.row, rootStyle]}
      accessibilityRole="text"
      accessibilityLabel={state.label}
      accessibilityLiveRegion="polite">
      <TypingDots color={colors.primarySoft} />
      <Animated.Text
        style={[styles.label, { color: colors.textMuted }, labelStyle]}
        numberOfLines={2}>
        {state.label}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 22,
    paddingVertical: 2,
  },
  label: {
    ...Typography.label,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    flexShrink: 1,
  },
});
