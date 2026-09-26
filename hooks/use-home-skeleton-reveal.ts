import { useReducedMotion } from '@/hooks/use-reduced-motion';
import React from 'react';
import { Animated, Easing } from 'react-native';

const SKELETON_FADE_MS = 280;
const CONTENT_FADE_MS = 320;

export type UseHomeSkeletonRevealOptions = {
  /** 是否同步淡入内容层（任务/财务首页用）；健康页仅淡出骨架 */
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
 * 首页首屏骨架淡出：pending → 内容就绪后骨架淡出（可选内容淡入）。
 * 任务 / 健康 / 财务三 Tab 共用；入场动画仍由页面自行控制。
 */
export function useHomeSkeletonReveal(
  initialLoadPending: boolean,
  options: UseHomeSkeletonRevealOptions = {},
): HomeSkeletonReveal {
  const { fadeContent = true } = options;
  const reduceMotion = useReducedMotion();
  const [skeletonMounted, setSkeletonMounted] = React.useState(true);
  const startedRef = React.useRef(false);
  const skeletonOpacity = React.useRef(new Animated.Value(1)).current;
  const contentOpacity = React.useRef(new Animated.Value(fadeContent ? 0 : 1)).current;

  React.useEffect(() => {
    if (initialLoadPending) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    setSkeletonMounted(true);
    skeletonOpacity.setValue(1);
    if (fadeContent) contentOpacity.setValue(0);

    if (reduceMotion) {
      skeletonOpacity.setValue(0);
      if (fadeContent) contentOpacity.setValue(1);
      setSkeletonMounted(false);
      return;
    }

    const anims: Animated.CompositeAnimation[] = [
      Animated.timing(skeletonOpacity, {
        toValue: 0,
        duration: SKELETON_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ];
    if (fadeContent) {
      anims.push(
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: CONTENT_FADE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      );
    }

    Animated.parallel(anims).start(({ finished }) => {
      if (finished) setSkeletonMounted(false);
    });
  }, [contentOpacity, fadeContent, initialLoadPending, reduceMotion, skeletonOpacity]);

  return {
    skeletonMounted,
    showSkeleton: initialLoadPending || skeletonMounted,
    skeletonOpacity,
    contentOpacity,
  };
}
