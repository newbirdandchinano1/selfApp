/**
 * 应用主题色 — 与健康页设计规范对齐（奶油纸 / 松墨绿 / sage）。
 * 完整令牌见 `constants/design-tokens.ts` 与 `health-home-theme.ts`，运行时语义色见 `useAppTheme`。
 */

import { Platform } from 'react-native';

import { appFonts, APP_MONO_STACK, APP_SANS_STACK, APP_SERIF_STACK } from './app-fonts';
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

/** 全局字族：Native 走字体包注册名；Web 走设计稿 CSS 栈 */
export const Fonts = Platform.select({
  web: {
    sans: APP_SANS_STACK,
    serif: APP_SERIF_STACK,
    rounded: APP_SANS_STACK,
    mono: APP_MONO_STACK,
  },
  default: {
    sans: appFonts.sans,
    serif: appFonts.serif,
    rounded: appFonts.sans,
    mono: appFonts.mono,
  },
});
