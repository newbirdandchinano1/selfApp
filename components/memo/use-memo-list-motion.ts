import { useCallback, useEffect } from 'react';
import { LayoutAnimation } from 'react-native';

import { useReducedMotionState } from '@/hooks/use-reduced-motion';

/**
 * 某一轮展开里已经播过的「token + memo id」。
 * 同一轮里卡片重挂载不再展开；换一轮 token（新标签）才会再播。
 */
const expandedBurstIds = new Set<string>();

function burstKey(token: number, id: string): string {
  return `${token}:${id}`;
}

export function markMemoExpanded(token: number, id: string): void {
  expandedBurstIds.add(burstKey(token, id));
}

export function hasMemoExpanded(token: number, id: string): boolean {
  return expandedBurstIds.has(burstKey(token, id));
}

export function resetMemoEntered(): void {
  expandedBurstIds.clear();
}

/**
 * 列表布局动画：筛选、排序、置顶、删除、转换移除。
 * 搜索输入、下拉刷新、聚焦重载、AI 字段原地更新都不走这里。
 * 减少动态或偏好未就绪时直接换位。Android 不额外打开已废弃的实验开关。
 */
export function useMemoListLayout() {
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();

  const configureNext = useCallback(() => {
    if (reduceMotion || !motionReady) return;
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } catch {
      // 布局动画不可用时直接换位
    }
  }, [motionReady, reduceMotion]);

  /** 在数据变化前调用一次，再 setState */
  const withLayout = useCallback(
    (mutate: () => void) => {
      configureNext();
      mutate();
    },
    [configureNext],
  );

  return { configureNext, withLayout };
}

/** 页面卸载时清理入场记录，避免下次进入时第一屏没有动画 */
export function useResetMemoEnteredOnUnmount(): void {
  useEffect(() => {
    return () => {
      resetMemoEntered();
    };
  }, []);
}
