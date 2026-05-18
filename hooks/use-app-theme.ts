import {
  getPalette,
  Layout,
  Radius,
  Shadows,
  Spacing,
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
  typography: typeof Typography;
  shadows: typeof Shadows;
};

/**
 * 全局语义主题 — 与财务页 `FinanceScreen` 内联色值一致。
 * 新页面与 `components/ui/*` 应优先使用此 hook。
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
    shadows: Shadows,
  };
}
