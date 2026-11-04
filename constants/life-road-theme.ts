/**
 * 「我的道路」视觉令牌：对齐根目录设计稿 `我的道路-UI重构.html`。
 * 色板与衣橱 / 折页同属纸色 ATELIER；排印复用 wardrobeFonts。
 */
import { Platform, type TextStyle } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';
import { wardrobeEm, wardrobeFonts } from '@/constants/wardrobe-theme';

export const LIFE_ROAD_LIGHT = {
  paper: '#F4F0E7',
  paper2: '#F1ECE1',
  card: '#FBF8F1',
  card2: '#FFFCF5',
  white: '#fffdf8',
  ink: '#1D2A24',
  ink2: '#46564D',
  ink3: '#627269',
  muted: '#8B958C',
  muted2: '#A6AEA5',
  pine: '#21453A',
  pine2: '#2D5949',
  pine3: '#3D6B58',
  pine4: '#173229',
  sage: '#8CAD9C',
  sage2: '#DCE7DF',
  sage3: '#C5D6C8',
  amber: '#D39A55',
  amber2: '#F3E3C7',
  amber3: '#E6B878',
  clay: '#BF6F52',
  clay2: '#F1DCD2',
  line: '#E3DACB',
  line2: '#D5C9B6',
  line3: '#EDE6D9',
  /** 摘要卡深色面 */
  roadDeep: '#1B392F',
  roadDeepMid: '#2E594A',
  roadDeepEdge: '#234438',
  onRoad: '#F7F1E2',
  onRoadSoft: 'rgba(245,240,227,0.55)',
  onRoadMute: 'rgba(245,240,227,0.47)',
  onRoadDir: '#FFF9EA',
  onRoadFocus: 'rgba(247,241,226,0.89)',
  openAccent: '#F0D5A9',
} as const;

export type LifeRoadPalette = { readonly [K in keyof typeof LIFE_ROAD_LIGHT]: string };

export const LIFE_ROAD_DARK: LifeRoadPalette = {
  paper: '#121A16',
  paper2: '#1E2822',
  card: '#1B2420',
  card2: '#222C27',
  white: '#FFFDF8',
  ink: '#F2EEE4',
  ink2: '#C6D0C9',
  ink3: '#A8B4AC',
  muted: '#8A968F',
  muted2: '#77837C',
  pine: '#A9C7B9',
  pine2: '#8DB5A3',
  pine3: '#6D9482',
  pine4: '#3E6556',
  sage: '#7FA695',
  sage2: 'rgba(127,166,149,0.22)',
  sage3: 'rgba(197,214,200,0.28)',
  amber: '#E0B072',
  amber2: 'rgba(224,176,114,0.18)',
  amber3: '#E6B878',
  clay: '#E08B6D',
  clay2: 'rgba(224,139,109,0.2)',
  line: 'rgba(230,221,206,0.14)',
  line2: 'rgba(230,221,206,0.24)',
  line3: 'rgba(230,221,206,0.1)',
  roadDeep: '#152820',
  roadDeepMid: '#2A4F42',
  roadDeepEdge: '#1F3A31',
  onRoad: '#F7F1E2',
  onRoadSoft: 'rgba(245,240,227,0.55)',
  onRoadMute: 'rgba(245,240,227,0.47)',
  onRoadDir: '#FFF9EA',
  onRoadFocus: 'rgba(247,241,226,0.89)',
  openAccent: '#F0D5A9',
};

export function useLifeRoadTheme(): { lr: LifeRoadPalette; isDark: boolean } {
  const { isDark } = useAppTheme();
  return {
    lr: isDark ? LIFE_ROAD_DARK : LIFE_ROAD_LIGHT,
    isDark,
  };
}

const IS_WEB = Platform.OS === 'web';

function face(
  family: string,
  webWeight?: TextStyle['fontWeight'],
  extra?: TextStyle,
): TextStyle {
  if (IS_WEB && webWeight != null) {
    return { fontFamily: family, fontWeight: webWeight, ...extra };
  }
  return { fontFamily: family, ...extra };
}

/** 道路排印角色（字号对齐设计稿） */
export const lifeRoadType = {
  kicker: {
    ...face(wardrobeFonts.monoBold, '700'),
    fontSize: 10,
    letterSpacing: wardrobeEm(0.18, 10),
  } satisfies TextStyle,

  kickerTiny: {
    ...face(wardrobeFonts.monoSemiBold, '600'),
    fontSize: 9,
    letterSpacing: wardrobeEm(0.16, 9),
  } satisfies TextStyle,

  appTitle: {
    ...face(wardrobeFonts.serifBold, '700'),
    fontSize: 19,
    letterSpacing: wardrobeEm(0.07, 19),
    lineHeight: 22,
  } satisfies TextStyle,

  appSub: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 9,
    letterSpacing: wardrobeEm(0.14, 9),
  } satisfies TextStyle,

  serifDir: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: wardrobeEm(0.025, 16),
  } satisfies TextStyle,

  serifNorth: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 14,
    lineHeight: 24,
    letterSpacing: wardrobeEm(0.025, 14),
  } satisfies TextStyle,

  serifEmpty: {
    ...face(wardrobeFonts.serifBold, '700'),
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: wardrobeEm(0.04, 18),
  } satisfies TextStyle,

  nodeName: {
    ...face(wardrobeFonts.sansSemiBold, '600'),
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: wardrobeEm(0.02, 13),
  } satisfies TextStyle,

  nodeKind: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 9,
    letterSpacing: wardrobeEm(0.12, 9),
  } satisfies TextStyle,

  monoTiny: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 9,
    letterSpacing: wardrobeEm(0.08, 9),
  } satisfies TextStyle,

  body: {
    ...face(wardrobeFonts.sans, '400'),
    fontSize: 12,
    lineHeight: 18,
  } satisfies TextStyle,

  cta: {
    ...face(wardrobeFonts.sansSemiBold, '600'),
    fontSize: 12,
    letterSpacing: wardrobeEm(0.05, 12),
  } satisfies TextStyle,
} as const;

export { wardrobeFonts as lifeRoadFonts, wardrobeEm as lifeRoadEm };
