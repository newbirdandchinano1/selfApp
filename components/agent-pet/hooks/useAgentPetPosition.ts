/**
 * 桌宠拖动位置 + 左右边缘弹性吸附。
 */
import {
  AGENT_PET_SIZE,
  type AgentPetPosition,
  type AgentPetSide,
} from '@/components/agent-pet/types/agentPet.types';
import {
  loadAgentPetPosition,
  saveAgentPetPosition,
} from '@/lib/assistant/agent-pet-prefs';
import React from 'react';
import { Dimensions, type LayoutRectangle } from 'react-native';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const EDGE_PAD = 10;
const SPRING = { damping: 18, stiffness: 210, mass: 0.85 };

function clamp(n: number, min: number, max: number) {
  'worklet';
  return Math.min(max, Math.max(min, n));
}

export function useAgentPetPosition(opts: {
  enabled: boolean;
  /** 底部避让（Tab 栏等） */
  bottomReserve: number;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = Dimensions.get('window');

  const x = useSharedValue(winW - AGENT_PET_SIZE - EDGE_PAD);
  const y = useSharedValue(Math.max(insets.top + 120, winH * 0.42));
  const dragging = useSharedValue(0);
  const ready = useSharedValue(0);
  const [side, setSide] = React.useState<AgentPetSide>('right');
  const [hydrated, setHydrated] = React.useState(false);

  const minY = insets.top + 56;
  const maxY = winH - opts.bottomReserve - AGENT_PET_SIZE - 8;

  const persist = React.useCallback((pos: AgentPetPosition) => {
    void saveAgentPetPosition(pos);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void loadAgentPetPosition().then(saved => {
      if (cancelled) return;
      if (saved) {
        const nextY = clamp(saved.y, minY, maxY);
        const nextX =
          saved.side === 'left'
            ? EDGE_PAD
            : winW - AGENT_PET_SIZE - EDGE_PAD;
        x.value = nextX;
        y.value = nextY;
        setSide(saved.side);
      } else {
        x.value = winW - AGENT_PET_SIZE - EDGE_PAD;
        y.value = clamp(winH * 0.42, minY, maxY);
      }
      ready.value = 1;
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [maxY, minY, ready, winH, winW, x, y]);

  const snapToEdge = React.useCallback(
    (absX: number, absY: number) => {
      const mid = winW / 2;
      const nextSide: AgentPetSide = absX + AGENT_PET_SIZE / 2 < mid ? 'left' : 'right';
      const nextX =
        nextSide === 'left' ? EDGE_PAD : winW - AGENT_PET_SIZE - EDGE_PAD;
      const nextY = clamp(absY, minY, maxY);
      x.value = withSpring(nextX, SPRING);
      y.value = withSpring(nextY, SPRING);
      setSide(nextSide);
      persist({ side: nextSide, y: nextY });
    },
    [maxY, minY, persist, winW, x, y],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: ready.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
    ],
  }));

  const getLayout = React.useCallback((): LayoutRectangle => {
    return {
      x: x.value,
      y: y.value,
      width: AGENT_PET_SIZE,
      height: AGENT_PET_SIZE,
    };
  }, [x, y]);

  const onDragStart = React.useCallback(() => {
    'worklet';
    dragging.value = 1;
  }, [dragging]);

  const onDragUpdate = React.useCallback(
    (tx: number, ty: number, startX: number, startY: number) => {
      'worklet';
      x.value = startX + tx;
      y.value = clamp(startY + ty, minY - 20, maxY + 20);
    },
    [maxY, minY, x, y],
  );

  const onDragEnd = React.useCallback(
    (tx: number, ty: number, startX: number, startY: number) => {
      'worklet';
      dragging.value = 0;
      const absX = startX + tx;
      const absY = clamp(startY + ty, minY, maxY);
      runOnJS(snapToEdge)(absX, absY);
    },
    [dragging, maxY, minY, snapToEdge],
  );

  return {
    x,
    y,
    side,
    hydrated,
    dragging,
    enabled: opts.enabled,
    animatedStyle,
    getLayout,
    onDragStart,
    onDragUpdate,
    onDragEnd,
    edgePad: EDGE_PAD,
    winW,
    winH,
    minY,
    maxY,
  };
}

export type AgentPetPositionApi = ReturnType<typeof useAgentPetPosition>;
