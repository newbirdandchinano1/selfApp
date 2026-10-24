import {
  getPalette,
  Layout,
  Motion,
  Radius,
  Shadows,
  Spacing,
  TextScalePolicy,
  Typography,
  type AppPalette,
  type ColorScheme,
} from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type AppTheme = {
  scheme: ColorScheme;
  isDark: boolean;
  colors: AppPalette;
  spacing: typeof Spacing;
  radius: typeof Radius;
  layout: typeof Layout;
  /** 基准角色尺寸；配合 Text allowFontScaling / AppText 跟随系统字号 */
  typography: typeof Typography;
  textScale: typeof TextScalePolicy;
  shadows: typeof Shadows;
  motion: typeof Motion;
};

/**
 * 全局语义主题 — 与健康页 `health-home-theme`（松墨绿品牌）一致。
 * 新页面与 `components/ui/*` 应优先使用此 hook；财务折页另见 `finance-fold-theme`。
 */
export function useAppTheme(): AppTheme {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return {
    scheme,
    isDark: scheme === 'dark',
    colors: getPalette(scheme),
    spacing: Spacing,
    radius: Radius,
    layout: Layout,
    typography: Typography,
    textScale: TextScalePolicy,
    shadows: Shadows,
    motion: Motion,
  };
}
