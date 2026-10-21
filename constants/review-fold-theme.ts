/**
 * 「折页 · FOLD」复盘视觉令牌：纸底、松绿墨、琥珀点缀。
 * 与全局财务蓝主题并存，仅在复盘相关页面消费。
 *
 * `fold` 是底层色板（键名沿用设计稿），`palette` 是语义别名，
 * 页面组件优先用语义名（ink / paperAlt / cardRing / amberInk …）。
 */
import { Platform } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

/** 折页 · FOLD 设计令牌（复盘页面专用，不影响全局蓝色主题） */
export const FOLD_LIGHT = {
  paper: '#F4F0E8',
  paper2: '#EDE7DB',
  card: '#FFFCF5',
  cardSoft: 'rgba(255,252,245,0.72)',
  ink: '#202A25',
  ink2: '#46534C',
  pine: '#23443A',
  pine2: '#2F5A4C',
  pineButton: '#23443A',
  onPineButton: '#F9F5EB',
  sage: '#7FA695',
  sage2: '#DDE8E0',
  amber: '#D99A4E',
  amber2: '#F4E5CC',
  clay: '#C96A4B',
  clay2: '#F5DED6',
  muted: '#7A857D',
  faint: '#A0A69E',
  line: '#E6DDCE',
  line2: '#D8CDBB',
  white: '#FFFDF8',
  summaryBg: '#1F3A31',
  summaryText: '#F5F0E5',
  summaryMuted: '#AEC4B9',
  summaryLine: 'rgba(255,255,255,0.14)',
  badgeBg: 'rgba(217,154,78,0.15)',
  badgeBorder: 'rgba(241,190,120,0.25)',
  badgeText: '#F1C17D',
  aiBg: '#F7EFDF',
  aiBorder: '#E4D4BA',
  aiInk: '#8E642C',
  heat0: '#ECE7DA',
  heat1: '#DCE7DE',
  heat2: '#B9D0C1',
  heat3: '#7FA695',
  heat4: '#3E6556',
  starEmpty: '#D7CEBC',
  trackOff: '#D8D4C9',
  shadow: '#32362B',
} as const;

export type FoldPalette = { readonly [K in keyof typeof FOLD_LIGHT]: string };

export const FOLD_DARK: FoldPalette = {
  paper: '#121A16',
  paper2: '#1E2822',
  card: '#1B2420',
  cardSoft: 'rgba(27,36,32,0.75)',
  ink: '#F2EEE4',
  ink2: '#C6D0C9',
  pine: '#A9C7B9',
  pine2: '#8DB5A3',
  pineButton: '#2F5A4C',
  onPineButton: '#F7F2E7',
  sage: '#7FA695',
  sage2: 'rgba(127,166,149,0.22)',
  amber: '#E0B072',
  amber2: 'rgba(224,176,114,0.18)',
  clay: '#E08B6D',
  clay2: 'rgba(224,139,109,0.2)',
  muted: '#8A968F',
  faint: '#77837C',
  line: 'rgba(230,221,206,0.14)',
  line2: 'rgba(230,221,206,0.24)',
  white: '#FFFDF8',
  summaryBg: '#1B332B',
  summaryText: '#F5F0E5',
  summaryMuted: '#AEC4B9',
  summaryLine: 'rgba(255,255,255,0.14)',
  badgeBg: 'rgba(217,154,78,0.15)',
  badgeBorder: 'rgba(241,190,120,0.25)',
  badgeText: '#F1C17D',
  aiBg: '#2A2418',
  aiBorder: 'rgba(217,154,78,0.28)',
  aiInk: '#E6B878',
  heat0: '#26312B',
  heat1: '#33473D',
  heat2: '#48675A',
  heat3: '#6D9482',
  heat4: '#8FBEAA',
  starEmpty: '#4A544D',
  trackOff: '#3A443E',
  shadow: '#000000',
};

export const foldFonts = {
  serif: Platform.select({ ios: 'Songti SC', android: 'serif', default: 'serif' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

/** 语义别名：页面组件按「用途」取色，而不是记住设计稿色号。 */
export type FoldSemanticPalette = {
  paper: string;
  paperAlt: string;
  card: string;
  cardRing: string;
  ink: string;
  inkSoft: string;
  muted: string;
  faint: string;
  pine: string;
  pineSolid: string;
  onPine: string;
  sage: string;
  sageSoft: string;
  sageInk: string;
  amber: string;
  amberSoft: string;
  amberInk: string;
  clay: string;
  claySoft: string;
  clayInk: string;
  line: string;
  lineStrong: string;
  shadow: string;
  success: string;
  successSoft: string;
  aiBg: string;
  aiInk: string;
  aiSoft: string;
  aiLine: string;
  aiOrb: string;
};

export function adaptFoldPalette(fold: FoldPalette, isDark: boolean): FoldSemanticPalette {
  return {
    paper: fold.paper,
    paperAlt: fold.paper2,
    card: fold.card,
    cardRing: fold.line,
    ink: fold.ink,
    inkSoft: fold.ink2,
    muted: fold.muted,
    faint: fold.faint,
    pine: fold.pine,
    pineSolid: fold.pineButton,
    onPine: fold.onPineButton,
    sage: fold.sage,
    sageSoft: fold.sage2,
    sageInk: isDark ? fold.pine : fold.pine2,
    amber: fold.amber,
    amberSoft: fold.amber2,
    amberInk: isDark ? '#EFC894' : '#9A6D2C',
    clay: fold.clay,
    claySoft: fold.clay2,
    clayInk: isDark ? '#EDAE99' : '#8F422B',
    line: fold.line,
    lineStrong: fold.line2,
    shadow: fold.shadow,
    success: fold.sage,
    successSoft: fold.sage2,
    aiBg: fold.summaryBg,
    aiInk: fold.summaryText,
    aiSoft: fold.summaryMuted,
    aiLine: fold.summaryLine,
    aiOrb: fold.badgeText,
  };
}

export function useFoldTheme(): {
  fold: FoldPalette;
  palette: FoldSemanticPalette;
  isDark: boolean;
  fonts: typeof foldFonts;
} {
  const { isDark } = useAppTheme();
  const fold = isDark ? FOLD_DARK : FOLD_LIGHT;
  return { fold, palette: adaptFoldPalette(fold, isDark), isDark, fonts: foldFonts };
}
