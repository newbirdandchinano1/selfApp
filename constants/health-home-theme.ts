/**
 * 健康首页视觉令牌 — 对齐 `health-screens` 设计稿：奶油纸底、松墨绿、营养素分色。
 * 仅健康 Tab 消费，不影响全局财务蓝主题。
 */
import { Platform } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export const HEALTH_HOME_LIGHT = {
  paper: '#F5F3E8',
  paperAlt: '#EDEBD8',
  card: '#FFFEF8',
  cardMuted: '#F3F1E6',
  ink: '#1E2A24',
  inkSoft: '#4E5A54',
  muted: '#7E877F',
  faint: '#A3AAA4',
  pine: '#1E3932',
  pineSoft: '#2D463F',
  onPine: '#F7F5EC',
  sage: '#7FA695',
  sageSoft: '#DDE6DF',
  amber: '#E0B35A',
  line: 'rgba(30, 57, 50, 0.09)',
  lineStrong: 'rgba(30, 57, 50, 0.14)',
  track: 'rgba(30, 57, 50, 0.08)',
  chartBand: 'rgba(30, 57, 50, 0.05)',
  shadow: '#2A322C',
  aiTagBg: 'rgba(30, 57, 50, 0.08)',
  aiTagText: '#3D524A',
} as const;

export type HealthHomePalette = { readonly [K in keyof typeof HEALTH_HOME_LIGHT]: string };

export const HEALTH_HOME_DARK: HealthHomePalette = {
  paper: '#121A16',
  paperAlt: '#1A2320',
  card: '#1B2420',
  cardMuted: 'rgba(148, 163, 152, 0.1)',
  ink: '#F2EEE4',
  inkSoft: '#C6D0C9',
  muted: '#8A968F',
  faint: '#6F7A73',
  pine: '#A9C7B9',
  pineSoft: '#2F5A4C',
  onPine: '#F7F2E7',
  sage: '#7FA695',
  sageSoft: 'rgba(127, 166, 149, 0.22)',
  amber: '#E0B072',
  line: 'rgba(230, 221, 206, 0.12)',
  lineStrong: 'rgba(230, 221, 206, 0.22)',
  track: 'rgba(230, 221, 206, 0.14)',
  chartBand: 'rgba(230, 221, 206, 0.08)',
  shadow: '#000000',
  aiTagBg: 'rgba(169, 199, 185, 0.16)',
  aiTagText: '#C6D8CE',
};

/** 与设计稿一致的营养素色（功能语义，非全局主色） */
export const HealthHomeNutrientAccents = {
  hydration: '#4F8FA8',
  protein: '#C47852',
  carbohydrate: '#C4A04A',
  calories: '#5F8A6E',
} as const;

export const healthHomeFonts = {
  serif: Platform.select({ ios: 'Songti SC', android: 'serif', default: 'serif' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export function useHealthHomeTheme(): {
  hh: HealthHomePalette;
  isDark: boolean;
  fonts: typeof healthHomeFonts;
  nutrients: typeof HealthHomeNutrientAccents;
} {
  const { isDark } = useAppTheme();
  return {
    hh: isDark ? HEALTH_HOME_DARK : HEALTH_HOME_LIGHT,
    isDark,
    fonts: healthHomeFonts,
    nutrients: HealthHomeNutrientAccents,
  };
}
