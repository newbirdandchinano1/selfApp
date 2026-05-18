/**
 * 应用主题色 — 与财务页设计规范对齐。
 * 完整令牌见 `constants/design-tokens.ts`，运行时语义色见 `useAppTheme`。
 */

import { Platform } from 'react-native';

import { getPalette, PaletteDark, PaletteLight } from './design-tokens';

const light = PaletteLight;
const dark = PaletteDark;

/** @deprecated 新代码请用 `useAppTheme().colors` */
export const Colors = {
  light: {
    text: light.text,
    textSecondary: light.textSecondary,
    background: light.background,
    surface: light.surface,
    tint: light.primary,
    icon: light.textSecondary,
    tabIconDefault: light.textSecondary,
    tabIconSelected: light.primary,
    primary: light.primary,
    secondary: light.secondary,
    tertiary: light.tertiary,
    danger: light.danger,
    input: light.input,
    outline: light.outline,
  },
  dark: {
    text: dark.text,
    textSecondary: dark.textSecondary,
    background: dark.background,
    surface: dark.surface,
    tint: dark.primary,
    icon: dark.textSecondary,
    tabIconDefault: dark.textSecondary,
    tabIconSelected: dark.primary,
    primary: dark.primary,
    secondary: dark.secondary,
    tertiary: dark.tertiary,
    danger: dark.danger,
    input: dark.input,
    outline: dark.outline,
  },
};

export { getPalette, PaletteDark, PaletteLight };

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
