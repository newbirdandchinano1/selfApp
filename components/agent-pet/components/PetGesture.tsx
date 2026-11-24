/**
 * 桌宠手势：拖动 / 点击 / 长按；面板打开时禁用拖动。
 */
import {
  AGENT_PET_HIT_SLOP,
  AGENT_PET_SIZE,
} from '@/components/agent-pet/types/agentPet.types';
import type { AgentPetPositionApi } from '@/components/agent-pet/hooks/useAgentPetPosition';
import React from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

type Props = {
  position: AgentPetPositionApi;
  dragEnabled: boolean;
  onPress: () => void;
  onLongPress: () => void;
  children: React.ReactNode;
};

export function PetGesture({
  position,
  dragEnabled,
  onPress,
  onLongPress,
  children,
}: Props) {
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const moved = useSharedValue(0);

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(dragEnabled)
        .minDistance(6)
        .onBegin(() => {
          startX.value = position.x.value;
          startY.value = position.y.value;
          moved.value = 0;
          position.onDragStart();
        })
        .onUpdate(e => {
          if (Math.abs(e.translationX) > 4 || Math.abs(e.translationY) > 4) {
            moved.value = 1;
          }
          position.onDragUpdate(e.translationX, e.translationY, startX.value, startY.value);
        })
        .onEnd(e => {
          position.onDragEnd(e.translationX, e.translationY, startX.value, startY.value);
        }),
    [dragEnabled, moved, position, startX, startY],
  );

  const tap = React.useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .onEnd((_e, success) => {
          if (!success || moved.value) return;
          scheduleOnRN(onPress);
        }),
    [moved, onPress],
  );

  const longPress = React.useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(420)
        .onStart(() => {
          scheduleOnRN(onLongPress);
        }),
    [onLongPress],
  );

  const composed = React.useMemo(
    () => Gesture.Simultaneous(pan, Gesture.Exclusive(longPress, tap)),
    [longPress, pan, tap],
  );

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        collapsable={false}
        style={[
          styles.hit,
          {
            width: AGENT_PET_SIZE + AGENT_PET_HIT_SLOP * 2,
            height: AGENT_PET_SIZE + AGENT_PET_HIT_SLOP * 2,
            marginLeft: -AGENT_PET_HIT_SLOP,
            marginTop: -AGENT_PET_HIT_SLOP,
          },
          position.animatedStyle,
        ]}>
        <Animated.View style={styles.inner}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: AGENT_PET_SIZE,
    height: AGENT_PET_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
