import { useMemo } from 'react';

import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getWishBoxGradients,
  getWishBoxPalette,
  getWishBoxShadows,
  type WishBoxGradientSet,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';

export type WishBoxTheme = {
  isDark: boolean;
  c: WishBoxPalette;
  gradients: WishBoxGradientSet;
  shadows: WishBoxShadowSet;
};

/**
 * 心愿匣主题：首页、详情、管理、足迹、表单与弹层共用同一套暖棕语义色。
 * 深色模式跟随系统，与 `useAppTheme` 同源。
 */
export function useWishBoxTheme(): WishBoxTheme {
  const { isDark } = useAppTheme();
  return useMemo(() => {
    const c = getWishBoxPalette(isDark);
    return {
      isDark,
      c,
      gradients: getWishBoxGradients(isDark),
      shadows: getWishBoxShadows(isDark),
    };
  }, [isDark]);
}

type StylesFactory<T> = (c: WishBoxPalette, shadows: WishBoxShadowSet, gradients: WishBoxGradientSet) => T;

const styleCache = new WeakMap<WishBoxPalette, Map<unknown, unknown>>();

/** 按色板缓存 StyleSheet，避免每行重新创建样式对象 */
export function useWishStyles<T>(factory: StylesFactory<T>): T {
  const { c, shadows, gradients } = useWishBoxTheme();
  return useMemo(() => {
    let byFactory = styleCache.get(c);
    if (!byFactory) {
      byFactory = new Map<unknown, unknown>();
      styleCache.set(c, byFactory);
    }
    const cached = byFactory.get(factory) as T | undefined;
    if (cached) return cached;
    const created = factory(c, shadows, gradients);
    byFactory.set(factory, created);
    return created;
  }, [c, shadows, gradients, factory]);
}
