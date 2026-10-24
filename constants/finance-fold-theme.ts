/**
 * 折页 · 财务视觉令牌 — 对齐 `finance-screens/财务APP-设计稿.html`
 * Paper / Pine / Sage / Amber / Clay；仅财务相关页消费。
 */
import { Platform } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export const FINANCE_FOLD_LIGHT = {
  paper: '#F3EEE4',
  paper2: '#EAE3D5',
  card: '#FFFCF5',
  cardSoft: 'rgba(255,252,245,0.78)',
  ink: '#1D2923',
  ink2: '#45534B',
  pine: '#1E4034',
  pine2: '#2C5A49',
  pine3: '#3D6C58',
  onPine: '#F8F3E9',
  sage: '#86A795',
  sage2: '#DDE9E1',
  amber: '#D89A4D',
  amber2: '#F4E4C8',
  amberInk: '#A96B22',
  clay: '#C66A4C',
  clay2: '#F4DED6',
  clayInk: '#93452E',
  muted: '#7A847D',
  faint: '#A6ABA3',
  line: '#E4DAC8',
  line2: '#D3C6B2',
  white: '#FFFDF8',
  budgetFrom: '#254A3D',
  budgetMid: '#1C3A30',
  budgetTo: '#183128',
  budgetBorder: '#2C5143',
  budgetLabel: '#B7CBC0',
  budgetAmount: '#F8D9AA',
  budgetAmountSoft: '#E7C58F',
  budgetFoot: '#A7BEB1',
  budgetTrack: 'rgba(255,255,255,0.1)',
  ringTrack: 'rgba(255,255,255,0.09)',
  ringStroke: '#E8BC7B',
  income: '#407A5B',
  expense: '#A45A40',
  shadow: '#1A342A',
} as const;

export type FinanceFoldPalette = { readonly [K in keyof typeof FINANCE_FOLD_LIGHT]: string };

export const FINANCE_FOLD_DARK: FinanceFoldPalette = {
  paper: '#172B24',
  paper2: '#1E322A',
  card: 'rgba(255,255,255,0.055)',
  cardSoft: 'rgba(255,255,255,0.08)',
  ink: '#F6F0E3',
  ink2: '#C6D0C9',
  pine: '#A9C7B9',
  pine2: '#8DB5A3',
  pine3: '#6D9482',
  onPine: '#F7F2E7',
  sage: '#86A795',
  sage2: 'rgba(134,167,149,0.22)',
  amber: '#E0B072',
  amber2: 'rgba(224,176,114,0.18)',
  amberInk: '#EFC894',
  clay: '#E08B6D',
  clay2: 'rgba(224,139,109,0.2)',
  clayInk: '#EDAE99',
  muted: '#9FB5A8',
  faint: '#7A8A82',
  line: 'rgba(235,219,189,0.12)',
  line2: 'rgba(235,219,189,0.22)',
  white: '#FFFDF8',
  budgetFrom: '#24483C',
  budgetMid: '#1A332B',
  budgetTo: '#142820',
  budgetBorder: '#2A4D40',
  budgetLabel: '#B3C8BC',
  budgetAmount: '#F8D8A7',
  budgetAmountSoft: '#E7C58F',
  budgetFoot: '#A8BDB1',
  budgetTrack: 'rgba(255,255,255,0.1)',
  ringTrack: 'rgba(255,255,255,0.1)',
  ringStroke: '#E8BC7B',
  income: '#6AA083',
  expense: '#D17A5D',
  shadow: '#000000',
};

export const financeFoldFonts = {
  serif: Platform.select({ ios: 'Songti SC', android: 'serif', default: 'serif' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export function useFinanceFoldTheme(): {
  ff: FinanceFoldPalette;
  isDark: boolean;
  fonts: typeof financeFoldFonts;
} {
  const { isDark } = useAppTheme();
  return {
    ff: isDark ? FINANCE_FOLD_DARK : FINANCE_FOLD_LIGHT,
    isDark,
    fonts: financeFoldFonts,
  };
}
