/**
 * 各模块 fold / home 色板；开启天气氛围背景时 pageBackground 透明以透出 Skia 层。
 * 健康 / 任务 / 财务 / 复盘 / 我的：
 * - 夜间 + 氛围 → 半透明墨绿玻璃卡
 * - 日间 + 氛围 → 米白实底卡（透出天气层靠页底透明）
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
  lifeRoadFonts,
  useLifeRoadTheme,
  type LifeRoadPalette,
} from '@/constants/life-road-theme';
import {
  taskFoldFonts,
  useTaskFoldTheme,
  type TaskFoldPalette,
} from '@/constants/task-fold-theme';
import { useWeatherAtmosphereWebpBgEnabled } from '@/hooks/use-weather-atmosphere-webp';
import { useMemo } from 'react';

/** 夜间氛围：墨绿玻璃不透明度 60% */
const NIGHT_GLASS_CARD = 'rgba(24, 34, 30, 0.60)';
const NIGHT_GLASS_SOFT = 'rgba(22, 30, 27, 0.60)';
const NIGHT_GLASS_LINE = 'rgba(230, 221, 206, 0.26)';
const NIGHT_GLASS_LINE2 = 'rgba(230, 221, 206, 0.38)';
/** 日间氛围：米白实底，保证天气层上仍有清晰分区 */
const DAY_CREAM_CARD = '#FFFCF5';
const DAY_CREAM_NESTED = '#F7F2E8';

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
    if (!atmosphereActive) return base.fold;
    if (base.isDark) {
      // 夜间 + 氛围：半透明墨绿玻璃（不透明度 60%），对齐健康/任务/财务页
      return {
        ...base.fold,
        card: NIGHT_GLASS_CARD,
        cardSoft: NIGHT_GLASS_SOFT,
        paper2: NIGHT_GLASS_CARD,
        line: NIGHT_GLASS_LINE,
        line2: NIGHT_GLASS_LINE2,
        aiBg: 'rgba(42, 36, 24, 0.60)',
        aiBorder: 'rgba(217, 154, 78, 0.32)',
        sage2: 'rgba(127, 166, 149, 0.22)',
        summaryBg: NIGHT_GLASS_SOFT,
        summaryLine: 'rgba(230, 221, 206, 0.22)',
      };
    }
    // 日间 + 氛围：米白实底卡，嵌套面略深一档
    return {
      ...base.fold,
      card: DAY_CREAM_CARD,
      cardSoft: DAY_CREAM_CARD,
      paper2: DAY_CREAM_NESTED,
      line: 'rgba(216, 205, 187, 0.75)',
      line2: 'rgba(216, 205, 187, 0.9)',
    };
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

/** 我的道路卡：氛围下与我的页同级玻璃 / 米白 */
export function useWeatherAwareLifeRoadTheme(): {
  lr: LifeRoadPalette;
  isDark: boolean;
  fonts: typeof lifeRoadFonts;
  atmosphereActive: boolean;
} {
  const base = useLifeRoadTheme();
  const atmosphereActive = useWeatherAtmosphereWebpBgEnabled();
  const lr = useMemo(() => {
    if (!atmosphereActive) return base.lr;
    if (base.isDark) {
      return {
        ...base.lr,
        card: NIGHT_GLASS_CARD,
        card2: NIGHT_GLASS_CARD,
        paper2: NIGHT_GLASS_CARD,
        line: NIGHT_GLASS_LINE,
        line2: NIGHT_GLASS_LINE2,
        treeCard: NIGHT_GLASS_SOFT,
        softPanel: NIGHT_GLASS_SOFT,
        iconBtn: NIGHT_GLASS_SOFT,
        roadDeep: NIGHT_GLASS_SOFT,
        roadDeepMid: 'rgba(24, 34, 30, 0.72)',
        roadDeepEdge: NIGHT_GLASS_LINE,
      };
    }
    // 日间 + 氛围：含有内容的道路主卡也走米白实底（不再用深绿 hero）
    return {
      ...base.lr,
      card: DAY_CREAM_CARD,
      card2: DAY_CREAM_CARD,
      paper2: DAY_CREAM_NESTED,
      treeCard: DAY_CREAM_CARD,
      softPanel: DAY_CREAM_CARD,
      iconBtn: DAY_CREAM_CARD,
      line: 'rgba(216, 205, 187, 0.75)',
      line2: 'rgba(216, 205, 187, 0.9)',
      roadDeep: DAY_CREAM_CARD,
      roadDeepMid: DAY_CREAM_NESTED,
      roadDeepEdge: 'rgba(216, 205, 187, 0.75)',
      onRoad: base.lr.ink,
      onRoadDir: base.lr.ink,
      onRoadFocus: base.lr.ink2,
      onRoadSoft: 'rgba(30, 57, 50, 0.55)',
      onRoadMute: 'rgba(30, 57, 50, 0.45)',
      openAccent: base.lr.sage,
    };
  }, [atmosphereActive, base.isDark, base.lr]);

  return {
    lr,
    isDark: base.isDark,
    fonts: lifeRoadFonts,
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
    // 夜间 + 氛围：墨绿玻璃不透明度 60%，透出天气层；描边略加强保边缘可读
    return {
      ...base.hh,
      /** 分区大框 */
      paperAlt: 'rgba(22, 30, 27, 0.60)',
      /** 内层小组件卡 */
      card: 'rgba(24, 34, 30, 0.60)',
      /** 次级面（快捷卡底、空态等） */
      cardMuted: 'rgba(28, 38, 34, 0.60)',
      line: 'rgba(230, 221, 206, 0.26)',
      lineStrong: 'rgba(230, 221, 206, 0.38)',
      track: 'rgba(230, 221, 206, 0.14)',
      chartBand: 'rgba(169, 199, 185, 0.10)',
      sageSoft: 'rgba(127, 166, 149, 0.22)',
      aiTagBg: 'rgba(169, 199, 185, 0.18)',
    };
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
    // 夜间 + 氛围：卡片不透明度 60%；侧滑行同透，操作条靠 progress 显隐避免透出
    return {
      ...base.tf,
      /** 分区壳 / 三窗格 */
      cardSoft: 'rgba(22, 30, 27, 0.60)',
      /** 内层卡 / 列表面 / 侧滑行 */
      card: 'rgba(24, 34, 30, 0.60)',
      paper2: 'rgba(24, 34, 30, 0.60)',
      paper3: 'rgba(28, 38, 34, 0.60)',
      cream: 'rgba(22, 30, 27, 0.60)',
      mist: 'rgba(28, 38, 34, 0.60)',
      lily2: 'rgba(169, 199, 185, 0.16)',
      line: 'rgba(230, 221, 206, 0.26)',
      line2: 'rgba(230, 221, 206, 0.38)',
      track: 'rgba(230, 221, 206, 0.14)',
      sage2: 'rgba(127, 166, 149, 0.22)',
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
    // 夜间 + 氛围：半透明墨绿玻璃（不透明度 60%），对齐健康/任务页
    return {
      ...base.ff,
      card: 'rgba(24, 34, 30, 0.60)',
      cardSoft: 'rgba(22, 30, 27, 0.60)',
      paper2: 'rgba(24, 34, 30, 0.60)',
      line: 'rgba(230, 221, 206, 0.26)',
      line2: 'rgba(230, 221, 206, 0.38)',
      budgetFrom: 'rgba(22, 30, 27, 0.60)',
      budgetBorder: 'rgba(230, 221, 206, 0.26)',
      sage2: 'rgba(134, 167, 149, 0.22)',
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
