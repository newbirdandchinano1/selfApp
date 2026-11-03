/**
 * ATELIER 衣橱视觉令牌：对齐 `衣橱-UI重构.html` 的 :root。
 * 仅衣橱页消费，不改动全局主题。夜间随 `useAppTheme`（同财务 / 复盘折页）。
 *
 * 字族（与设计稿栈一致）：
 * --serif → Noto Serif SC
 * --sans  → Noto Sans SC（Web 仍走 PingFang / 雅黑栈）
 * --mono  → Roboto Mono（设计稿 mono 栈末位；DIN 无开源授权）
 *
 * Native 必须用「字重内嵌于 fontFamily」的 expo-google-fonts 面名，
 * 不可再叠 fontWeight，否则 Android 会整段回退成系统默认字体。
 *
 * 色板约定：`pine` 作标题 / 描边强调（夜间变浅）；实心底（FAB / Dock / 主按钮）用 `pineSolid`。
 */
import { Platform, type TextStyle } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export const WARDROBE_LIGHT = {
  paper: '#F3EFE6',
  paper2: '#E9E2D4',
  paper3: '#E1D8C7',
  card: '#FBF8F1',
  card2: '#FFFCF5',
  white: '#FFFDF8',
  ink: '#1D2A24',
  ink2: '#46564D',
  ink3: '#627269',
  muted: '#8B958C',
  muted2: '#A6AEA5',
  pine: '#21453A',
  pine2: '#2D5949',
  pine3: '#3D6B58',
  pine4: '#173229',
  /** 实心松绿填充（FAB / Dock / 主按钮）；夜间保持偏深以保证 onPine 对比 */
  pineSolid: '#21453A',
  pineSolid2: '#2D5949',
  sage: '#8CAD9C',
  sage2: '#DCE7DF',
  sage3: '#C5D6C8',
  amber: '#D39A55',
  amber2: '#F3E3C7',
  amber3: '#E6B878',
  clay: '#BF6F52',
  clay2: '#F1DCD2',
  rose: '#C48C8C',
  sky: '#8AA8B1',
  sky2: '#DDE8EB',
  line: '#E3DACB',
  line2: '#D5C9B6',
  line3: '#EDE6D9',
  onPine: '#F7F2E5',
  screenTop: '#F8F4EA',
  screenMid: '#F4F0E7',
  screenBot: '#F1ECE1',
  weekCard0: '#2E594A',
  weekCard1: '#1C3A30',
  weekCard2: '#234438',
  shadow: 'rgba(31,48,39,0.10)',
  /** 顶栏图标钮 / 操作簇半透底 */
  glass: 'rgba(252,249,241,0.66)',
  glassStrong: 'rgba(252,249,241,0.92)',
  glassBorder: 'rgba(255,255,255,0.72)',
  pineWash: 'rgba(33,69,58,0.06)',
  dim: 'rgba(25,34,28,0.45)',
  amberMark: 'rgba(211,154,85,0.24)',
} as const;

export type WardrobePalette = { readonly [K in keyof typeof WARDROBE_LIGHT]: string };

export const WARDROBE_DARK: WardrobePalette = {
  paper: '#121A16',
  paper2: '#1A2320',
  paper3: '#222B26',
  card: '#1B2420',
  card2: '#1F2A25',
  white: '#FFFDF8',
  ink: '#F2EEE4',
  ink2: '#C6D0C9',
  ink3: '#9AABA2',
  muted: '#8A968F',
  muted2: '#6F7A73',
  pine: '#A9C7B9',
  pine2: '#8DB5A3',
  pine3: '#6D9482',
  pine4: '#3D6B58',
  pineSolid: '#2F5A4C',
  pineSolid2: '#254A3D',
  sage: '#8CAD9C',
  sage2: 'rgba(140,173,156,0.22)',
  sage3: 'rgba(140,173,156,0.32)',
  amber: '#E0B072',
  amber2: 'rgba(224,176,114,0.18)',
  amber3: '#E6B878',
  clay: '#E08B6D',
  clay2: 'rgba(224,139,109,0.2)',
  rose: '#D4A0A0',
  sky: '#8AA8B1',
  sky2: 'rgba(138,168,177,0.22)',
  line: 'rgba(230,221,206,0.12)',
  line2: 'rgba(230,221,206,0.22)',
  line3: 'rgba(230,221,206,0.08)',
  onPine: '#F7F2E5',
  screenTop: '#141C18',
  screenMid: '#121A16',
  screenBot: '#0F1613',
  weekCard0: '#2E594A',
  weekCard1: '#1C3A30',
  weekCard2: '#234438',
  shadow: '#000000',
  glass: 'rgba(255,255,255,0.06)',
  glassStrong: 'rgba(22,32,28,0.94)',
  glassBorder: 'rgba(230,221,206,0.14)',
  pineWash: 'rgba(169,199,185,0.12)',
  dim: 'rgba(0,0,0,0.55)',
  amberMark: 'rgba(224,176,114,0.28)',
};

/** 浅色别名；新代码请用 `useWardrobeTheme().w` */
export const WARDROBE = WARDROBE_LIGHT;

export function useWardrobeTheme(): {
  w: WardrobePalette;
  isDark: boolean;
} {
  const { isDark } = useAppTheme();
  return {
    w: isDark ? WARDROBE_DARK : WARDROBE_LIGHT,
    isDark,
  };
}

const IS_WEB = Platform.OS === 'web';

/** 设计稿 :root 字族栈（Web 直接复用，与 HTML 一致） */
const SERIF_STACK =
  '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif';
const SANS_STACK = '"PingFang SC","Microsoft YaHei UI","Noto Sans SC",sans-serif';
const MONO_STACK = '"DIN Alternate","SF Mono","Cascadia Mono","Roboto Mono",monospace';
const ITALIC_STACK = 'Georgia,"Times New Roman",serif';

/**
 * Native 面名 = expo-google-fonts 注册名。
 * Web 使用设计稿 CSS 栈，字重靠 fontWeight。
 */
export const wardrobeFonts = {
  serif: IS_WEB ? SERIF_STACK : 'NotoSerifSC_600SemiBold',
  serifBold: IS_WEB ? SERIF_STACK : 'NotoSerifSC_700Bold',
  sans: IS_WEB ? SANS_STACK : 'NotoSansSC_400Regular',
  sansMedium: IS_WEB ? SANS_STACK : 'NotoSansSC_500Medium',
  sansSemiBold: IS_WEB ? SANS_STACK : 'NotoSansSC_600SemiBold',
  sansBold: IS_WEB ? SANS_STACK : 'NotoSansSC_700Bold',
  mono: IS_WEB ? MONO_STACK : 'RobotoMono_400Regular',
  monoMedium: IS_WEB ? MONO_STACK : 'RobotoMono_500Medium',
  monoSemiBold: IS_WEB ? MONO_STACK : 'RobotoMono_600SemiBold',
  monoBold: IS_WEB ? MONO_STACK : 'RobotoMono_700Bold',
  displayItalic: IS_WEB ? ITALIC_STACK : Platform.select({ ios: 'Georgia', default: 'NotoSerifSC_600SemiBold' })!,
} as const;

/** CSS `letter-spacing: Nem` → RN `letterSpacing`（逻辑像素） */
export function wardrobeEm(em: number, fontSize: number): number {
  return Math.round(em * fontSize * 100) / 100;
}

/** Web 可写 fontWeight；Native 字重已烤进 fontFamily，禁止再写 weight */
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

type WT = TextStyle;

/**
 * 衣橱排印角色：字号 / 字距 / 字面对齐设计稿 class。
 * 颜色与边距仍由各组件样式补充。
 */
export const wardrobeType = {
  kicker: {
    ...face(wardrobeFonts.monoBold, '700'),
    fontSize: 7.5,
    letterSpacing: wardrobeEm(0.2, 7.5),
  } satisfies WT,

  appTitle: {
    ...face(wardrobeFonts.serifBold, '700'),
    fontSize: 19,
    letterSpacing: wardrobeEm(0.07, 19),
    lineHeight: 21,
  } satisfies WT,

  appSub: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 7,
    letterSpacing: wardrobeEm(0.21, 7),
  } satisfies WT,

  heroTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 34,
    // 略大于 1.1em，避免宋体顶部被裁切
    lineHeight: 42,
    letterSpacing: wardrobeEm(0.02, 34),
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  } satisfies WT,

  /** 设计稿 `.hero-title .q`：Georgia 斜体琥珀问号（半角，才能吃到 Latin 斜体面） */
  heroQ: {
    ...face(wardrobeFonts.displayItalic, '400'),
    fontStyle: 'italic' as const,
    fontSize: 31,
    lineHeight: 42,
    marginLeft: 1,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  } satisfies WT,

  heroSub: {
    ...face(wardrobeFonts.sans, '400'),
    fontSize: 9.5,
    letterSpacing: wardrobeEm(0.02, 9.5),
  } satisfies WT,

  pageTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 31,
    lineHeight: 36,
    letterSpacing: wardrobeEm(0.03, 31),
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  } satisfies WT,

  pageSub: {
    ...face(wardrobeFonts.sans, '400'),
    fontSize: 9.5,
    lineHeight: 16,
  } satisfies WT,

  sectionTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: wardrobeEm(0.03, 21),
  } satisfies WT,

  sectionMeta: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 7,
    letterSpacing: wardrobeEm(0.06, 7),
  } satisfies WT,

  sheetTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 19,
    letterSpacing: wardrobeEm(0.04, 19),
  } satisfies WT,

  featureTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 25,
    lineHeight: 28,
    letterSpacing: wardrobeEm(0.04, 25),
  } satisfies WT,

  outfitTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: wardrobeEm(0.03, 15),
  } satisfies WT,

  detailTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: wardrobeEm(0.04, 22),
  } satisfies WT,

  profileName: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 17,
    letterSpacing: wardrobeEm(0.04, 17),
  } satisfies WT,

  profileMeta: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.08, 6.5),
  } satisfies WT,

  profileBadge: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 5.5,
    letterSpacing: wardrobeEm(0.1, 5.5),
  } satisfies WT,

  useTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 15.5,
    letterSpacing: wardrobeEm(0.04, 15.5),
  } satisfies WT,

  emptyTitle: {
    ...face(wardrobeFonts.serif, '600'),
    fontSize: 18,
    letterSpacing: wardrobeEm(0.04, 18),
  } satisfies WT,

  foot: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.18, 6.5),
  } satisfies WT,

  dockLabel: {
    ...face(wardrobeFonts.sansSemiBold, '600'),
    fontSize: 8,
    letterSpacing: wardrobeEm(0.1, 8),
  } satisfies WT,

  itemName: {
    ...face(wardrobeFonts.sansSemiBold, '600'),
    fontSize: 11.5,
    letterSpacing: wardrobeEm(0.01, 11.5),
  } satisfies WT,

  itemSub: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 7,
    letterSpacing: wardrobeEm(0.03, 7),
  } satisfies WT,

  popTitle: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.2, 6.5),
  } satisfies WT,

  stampDay: {
    ...face(wardrobeFonts.monoBold, '700'),
    fontSize: 22,
    lineHeight: 22,
  } satisfies WT,

  stampMon: {
    ...face(wardrobeFonts.mono, '400'),
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.2, 6.5),
  } satisfies WT,

  wcBig: {
    ...face(wardrobeFonts.monoBold, '700'),
    fontSize: 42,
    lineHeight: 40,
    letterSpacing: wardrobeEm(-0.02, 42),
  } satisfies WT,

  statNum: {
    ...face(wardrobeFonts.monoBold, '700'),
    fontSize: 17,
    letterSpacing: wardrobeEm(-0.01, 17),
  } satisfies WT,

  statLabel: {
    ...face(wardrobeFonts.sans, '400'),
    fontSize: 7,
    letterSpacing: wardrobeEm(0.12, 7),
  } satisfies WT,

  body: face(wardrobeFonts.sans, '400'),
  mono: face(wardrobeFonts.mono, '400'),
} as const;

/** 设计稿 --ease / --spring */
export const WARDROBE_EASE = { x1: 0.22, y1: 1, x2: 0.36, y2: 1 } as const;
export const WARDROBE_SPRING = { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } as const;
