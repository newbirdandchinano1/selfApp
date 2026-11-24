/**
 * 「我的道路」视觉令牌：奶油松墨高定版（对齐 editorial HTML 原型）。
 * 色板与衣橱 / 折页同属纸色 ATELIER；排印复用 wardrobeFonts。
 */
import { Platform, type TextStyle } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';
import { wardrobeEm, wardrobeFonts } from '@/constants/wardrobe-theme';

export const LIFE_ROAD_LIGHT = {
  paper: '#F5F3E8',
  paper2: '#ECE9DA',
  card: '#FAF8F0',
  card2: '#FAF8F0',
  white: '#FFFDF8',
  ink: '#1E3932',
  ink2: '#2A4740',
  ink3: '#3D5C52',
  muted: '#8B9D91',
  muted2: '#A3B3A8',
  pine: '#1E3932',
  pine2: '#2D5949',
  pine3: '#3D6B58',
  pine4: '#15211C',
  sage: '#5F8A6E',
  sage2: '#DCE7DF',
  sage3: '#C5D6C8',
  amber: '#E0B35A',
  amber2: '#F3E3C7',
  amber3: '#E0B072',
  clay: '#BF6F52',
  clay2: '#F1DCD2',
  line: 'rgba(30, 57, 50, 0.08)',
  line2: 'rgba(30, 57, 50, 0.12)',
  line3: 'rgba(30, 57, 50, 0.06)',
  /** 摘要卡 / 月焦点深色面：hero #15211C → #1E3932 */
  roadDeep: '#15211C',
  roadDeepMid: '#1E3932',
  roadDeepEdge: '#1A2E28',
  onRoad: '#F5F3E8',
  onRoadSoft: 'rgba(245,243,232,0.55)',
  onRoadMute: 'rgba(245,243,232,0.47)',
  onRoadDir: '#F5F3E8',
  onRoadFocus: 'rgba(245,243,232,0.9)',
  openAccent: '#A9C7B9',
  /** 道路树主卡（半透明奶油纸） */
  treeCard: 'rgba(250,248,240,0.72)',
  /** 顶栏返回 / 次级面板 */
  softPanel: 'rgba(250,248,240,0.45)',
  iconBtn: 'rgba(250,248,240,0.7)',
  /** 白叠：芯片、编辑钮、AI 钮 */
  chip: 'rgba(255,255,255,0.55)',
  chipSoft: 'rgba(255,255,255,0.38)',
  chipGhost: 'rgba(255,255,255,0.2)',
  checkEmpty: 'rgba(255,255,255,0.45)',
  emptyPlusBg: 'rgba(255,255,255,0.22)',
  /** 同步条 / 当前行淡绿洗 */
  syncWash: 'rgba(95,138,110,0.12)',
  syncBorder: 'rgba(30,57,50,0.08)',
  currentWash: 'rgba(95,138,110,0.14)',
  currentBorder: 'rgba(95,138,110,0.28)',
  pineGhost: 'rgba(30,57,50,0.05)',
  pineGhostBorder: 'rgba(30,57,50,0.06)',
  pineWash: 'rgba(30,57,50,0.06)',
  pineWashStrong: 'rgba(30,57,50,0.08)',
  createProjBg: 'rgba(95,138,110,0.14)',
  createProjBorder: 'rgba(95,138,110,0.3)',
  nowBg: 'rgba(224,179,90,0.14)',
  nowBorder: 'rgba(224,179,90,0.22)',
  nowInk: '#9A6A2D',
  northOrbit: 'rgba(30,57,50,0.06)',
  nextYearBg: 'rgba(250,248,240,0.4)',
  /** 状态 pill */
  toneOnTrack: '#41604F',
  toneOnTrackBg: 'rgba(220,231,223,0.72)',
  toneOnTrackBorder: 'rgba(140,173,156,0.24)',
  tonePaused: '#8C6A3C',
  tonePausedBg: 'rgba(243,227,199,0.72)',
  tonePausedBorder: 'rgba(224,179,90,0.24)',
  toneArrived: '#1F4A3B',
  toneArrivedBg: 'rgba(197,214,200,0.6)',
  toneArrivedBorder: 'rgba(61,107,88,0.22)',
  toneDropped: '#8C5541',
  toneDroppedBg: 'rgba(241,220,210,0.72)',
  toneDroppedBorder: 'rgba(191,111,82,0.2)',
} as const;

export type LifeRoadPalette = { readonly [K in keyof typeof LIFE_ROAD_LIGHT]: string };

/** 松林夜：对齐 HTML `.theme-dark` */
export const LIFE_ROAD_DARK: LifeRoadPalette = {
  paper: '#121A16',
  paper2: '#1E2C25',
  card: '#17211C',
  card2: '#1E2C25',
  white: '#1E2C25',
  ink: '#A9C7B9',
  ink2: '#C6D0C9',
  ink3: '#8AA89A',
  muted: '#526E60',
  muted2: '#3E564B',
  pine: '#A9C7B9',
  pine2: '#8DB5A3',
  pine3: '#6D9482',
  pine4: '#3E6556',
  sage: '#769988',
  sage2: 'rgba(118,153,136,0.22)',
  sage3: 'rgba(169,199,185,0.28)',
  amber: '#E0B072',
  amber2: 'rgba(224,176,114,0.18)',
  amber3: '#E0B072',
  clay: '#E08B6D',
  clay2: 'rgba(224,139,109,0.2)',
  line: 'rgba(169,199,185,0.10)',
  line2: 'rgba(169,199,185,0.16)',
  line3: 'rgba(169,199,185,0.08)',
  roadDeep: '#0D1410',
  roadDeepMid: '#17261F',
  roadDeepEdge: '#121C17',
  onRoad: '#F5F3E8',
  onRoadSoft: 'rgba(245,243,232,0.55)',
  onRoadMute: 'rgba(245,243,232,0.47)',
  onRoadDir: '#F5F3E8',
  onRoadFocus: 'rgba(245,243,232,0.9)',
  openAccent: '#A9C7B9',
  treeCard: '#17211C',
  softPanel: 'rgba(255,252,245,0.05)',
  iconBtn: '#1E2C25',
  chip: 'rgba(255,252,245,0.08)',
  chipSoft: 'rgba(255,252,245,0.06)',
  chipGhost: 'rgba(255,252,245,0.05)',
  checkEmpty: 'rgba(255,252,245,0.06)',
  emptyPlusBg: 'rgba(255,252,245,0.05)',
  syncWash: 'rgba(118,153,136,0.14)',
  syncBorder: 'rgba(169,199,185,0.16)',
  currentWash: 'rgba(118,153,136,0.18)',
  currentBorder: 'rgba(169,199,185,0.32)',
  pineGhost: 'rgba(169,199,185,0.1)',
  pineGhostBorder: 'rgba(169,199,185,0.12)',
  pineWash: 'rgba(169,199,185,0.1)',
  pineWashStrong: 'rgba(169,199,185,0.14)',
  createProjBg: 'rgba(118,153,136,0.16)',
  createProjBorder: 'rgba(169,199,185,0.28)',
  nowBg: 'rgba(224,176,114,0.16)',
  nowBorder: 'rgba(224,176,114,0.28)',
  nowInk: '#EFC894',
  northOrbit: 'rgba(169,199,185,0.08)',
  nextYearBg: 'rgba(255,252,245,0.05)',
  toneOnTrack: '#A9C7B9',
  toneOnTrackBg: 'rgba(118,153,136,0.22)',
  toneOnTrackBorder: 'rgba(140,173,156,0.28)',
  tonePaused: '#E0B072',
  tonePausedBg: 'rgba(224,176,114,0.18)',
  tonePausedBorder: 'rgba(224,176,114,0.28)',
  toneArrived: '#8DB5A3',
  toneArrivedBg: 'rgba(197,214,200,0.16)',
  toneArrivedBorder: 'rgba(141,181,163,0.28)',
  toneDropped: '#E08B6D',
  toneDroppedBg: 'rgba(224,139,109,0.18)',
  toneDroppedBorder: 'rgba(224,139,109,0.28)',
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
    fontSize: 15,
    letterSpacing: wardrobeEm(0.06, 15),
    lineHeight: 20,
  } satisfies TextStyle,

  appSub: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 10,
    letterSpacing: wardrobeEm(0.08, 10),
  } satisfies TextStyle,

  serifDir: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 17,
    lineHeight: 28,
    letterSpacing: wardrobeEm(0.02, 17),
  } satisfies TextStyle,

  serifNorth: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 15,
    lineHeight: 25,
    letterSpacing: wardrobeEm(0.02, 15),
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
