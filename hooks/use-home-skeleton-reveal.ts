import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import React from 'react';
import { Animated, Easing } from 'react-native';

const SKELETON_FADE_MS = 280;

export type UseHomeSkeletonRevealOptions = {
  /** 是否同步把内容层设为不透明（任务/财务首页用）；健康页仅淡出骨架 */
  fadeContent?: boolean;
};

export type HomeSkeletonReveal = {
  /** 骨架是否仍挂载（含淡出阶段） */
  skeletonMounted: boolean;
  /** 是否应渲染骨架层（pending 或淡出中） */
  showSkeleton: boolean;
  skeletonOpacity: Animated.Value;
  contentOpacity: Animated.Value;
};

/**
 * 首页首屏骨架淡出：pending → 内容就绪后骨架淡出。
 * 任务 / 健康 / 财务三 Tab 共用。
 *
 * 内容层在就绪时立刻设为不透明，不再从 0 做 native 淡入——
 * 否则动画被 motionReady 抖动 / Strict Mode cleanup 打断时，
 * useNativeDriver 会把整页卡在 opacity 0（表现为「所有组件消失」）。
 */
export function useHomeSkeletonReveal(
  initialLoadPending: boolean,
  options: UseHomeSkeletonRevealOptions = {},
): HomeSkeletonReveal {
  const { fadeContent = true } = options;
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const [skeletonMounted, setSkeletonMounted] = React.useState(true);
  const startedRef = React.useRef(false);
  const skeletonOpacity = React.useRef(new Animated.Value(1)).current;
  const contentOpacity = React.useRef(new Animated.Value(fadeContent ? 0 : 1)).current;

  React.useEffect(() => {
    if (initialLoadPending) {
      startedRef.current = false;
      return;
    }

    // 内容可见性优先：一就绪就写死不透明，绝不在后续重入时打回 0
    if (fadeContent) {
      contentOpacity.stopAnimation();
      contentOpacity.setValue(1);
    }

    const hideSkeletonNow = () => {
      skeletonOpacity.stopAnimation();
      skeletonOpacity.setValue(0);
      setSkeletonMounted(false);
      startedRef.current = true;
    };

    if (!motionReady || reduceMotion) {
      hideSkeletonNow();
      return;
    }

    if (startedRef.current) {
      hideSkeletonNow();
      return;
    }

    startedRef.current = true;
    setSkeletonMounted(true);
    skeletonOpacity.setValue(1);

    const fade = Animated.timing(skeletonOpacity, {
      toValue: 0,
      duration: SKELETON_FADE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    fade.start(({ finished }) => {
      if (finished) setSkeletonMounted(false);
      else hideSkeletonNow();
    });
    return () => {
      fade.stop();
      hideSkeletonNow();
    };
  }, [contentOpacity, fadeContent, initialLoadPending, motionReady, reduceMotion, skeletonOpacity]);

  return {
    skeletonMounted,
    showSkeleton: initialLoadPending || skeletonMounted,
    skeletonOpacity,
    contentOpacity,
  };
}
