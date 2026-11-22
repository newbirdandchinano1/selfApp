/**
 * 各模块 fold / home 色板；开启天气氛围背景时 pageBackground 透明以透出 Skia 层。
 * 夜间半透明卡片会透出雨丝，氛围开启时实化卡片底色，让动画留在背景。
 */
import {
  adaptFoldPalette,
  foldFonts,
  useFoldTheme,
  type FoldPalette,
  type FoldSemanticPalette,
} from '@/constants/review-fold-theme';
import {
  financeFoldFonts,
  useFinanceFoldTheme,
  type FinanceFoldPalette,
} from '@/constants/finance-fold-theme';
import {
  healthHomeFonts,
  HealthHomeNutrientAccents,
  useHealthHomeTheme,
  type HealthHomePalette,
} from '@/constants/health-home-theme';
import {
  taskFoldFonts,
  useTaskFoldTheme,
  type TaskFoldPalette,
} from '@/constants/task-fold-theme';
import { useWeatherAtmosphereWebpBgEnabled } from '@/hooks/use-weather-atmosphere-webp';
import { useMemo } from 'react';

/** 把低透明度 rgba 提到接近不透明，避免氛围粒子透出卡片 */
function solidifyRgba(color: string, minAlpha = 0.92): string {
  const m = color.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (!m) return color;
  const a = m[4] != null ? Number(m[4]) : 1;
  if (!Number.isFinite(a) || a >= minAlpha) return color;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${minAlpha})`;
}

function solidifyDarkCards<T extends Record<string, string>>(
  palette: T,
  keys: readonly (keyof T)[],
): T {
  const next = { ...palette };
  for (const key of keys) {
    const value = next[key];
    if (typeof value === 'string') {
      next[key] = solidifyRgba(value) as T[keyof T];
    }
  }
  return next;
}

export function useWeatherPageBackground(fallback: string): string {
  const enabled = useWeatherAtmosphereWebpBgEnabled();
  return enabled ? 'transparent' : fallback;
}

export function useWeatherAwareFoldTheme(): {
  fold: FoldPalette;
  palette: FoldSemanticPalette;
  isDark: boolean;
  fonts: typeof foldFonts;
  pageBackground: string;
  atmosphereActive: boolean;
} {
  const base = useFoldTheme();
  const atmosphereActive = useWeatherAtmosphereWebpBgEnabled();
  const fold = useMemo(() => {
    if (!atmosphereActive || !base.isDark) return base.fold;
    return solidifyDarkCards(base.fold, ['card', 'cardSoft', 'paper2'] as const);
  }, [atmosphereActive, base.fold, base.isDark]);

  return {
    fold,
    palette: adaptFoldPalette(fold, base.isDark),
    isDark: base.isDark,
    fonts: foldFonts,
    pageBackground: atmosphereActive ? 'transparent' : base.fold.paper,
    atmosphereActive,
  };
}

export function useWeatherAwareHealthHomeTheme(): {
  hh: HealthHomePalette;
  isDark: boolean;
  fonts: typeof healthHomeFonts;
  nutrients: typeof HealthHomeNutrientAccents;
  pageBackground: string;
  atmosphereActive: boolean;
} {
  const base = useHealthHomeTheme();
  const atmosphereActive = useWeatherAtmosphereWebpBgEnabled();
  const hh = useMemo(() => {
    if (!atmosphereActive || !base.isDark) return base.hh;
    return solidifyDarkCards(base.hh, ['card', 'cardMuted', 'paperAlt'] as const);
  }, [atmosphereActive, base.hh, base.isDark]);

  return {
    hh,
    isDark: base.isDark,
    fonts: healthHomeFonts,
    nutrients: HealthHomeNutrientAccents,
    pageBackground: atmosphereActive ? 'transparent' : base.hh.paper,
    atmosphereActive,
  };
}

export function useWeatherAwareTaskFoldTheme(): {
  tf: TaskFoldPalette;
  isDark: boolean;
  fonts: typeof taskFoldFonts;
  pageBackground: string;
  atmosphereActive: boolean;
} {
  const base = useTaskFoldTheme();
  const atmosphereActive = useWeatherAtmosphereWebpBgEnabled();
  const tf = useMemo(() => {
    if (!atmosphereActive || !base.isDark) return base.tf;
    return {
      ...solidifyDarkCards(base.tf, ['card', 'cardSoft', 'mist', 'lily2', 'paper2', 'paper3'] as const),
      // 任务夜间卡片原本几乎全透明，氛围开启时改用实色底
      card: 'rgba(27, 36, 32, 0.94)',
      cardSoft: 'rgba(30, 40, 35, 0.9)',
    };
  }, [atmosphereActive, base.tf, base.isDark]);

  return {
    tf,
    isDark: base.isDark,
    fonts: taskFoldFonts,
    pageBackground: atmosphereActive ? 'transparent' : base.tf.paper,
    atmosphereActive,
  };
}

export function useWeatherAwareFinanceFoldTheme(): {
  ff: FinanceFoldPalette;
  isDark: boolean;
  fonts: typeof financeFoldFonts;
  pageBackground: string;
  atmosphereActive: boolean;
} {
  const base = useFinanceFoldTheme();
  const atmosphereActive = useWeatherAtmosphereWebpBgEnabled();
  const ff = useMemo(() => {
    if (!atmosphereActive || !base.isDark) return base.ff;
    return {
      ...solidifyDarkCards(base.ff, ['card', 'cardSoft', 'paper2'] as const),
      card: 'rgba(26, 40, 34, 0.94)',
      cardSoft: 'rgba(30, 44, 38, 0.9)',
    };
  }, [atmosphereActive, base.ff, base.isDark]);

  return {
    ff,
    isDark: base.isDark,
    fonts: financeFoldFonts,
    pageBackground: atmosphereActive ? 'transparent' : base.ff.paper,
    atmosphereActive,
  };
}
