/**
 * 全局排印字族：全部走 expo-google-fonts 字体包，不用系统默认字。
 *
 * 瘦身策略：只打包必要字重
 * - Noto Sans SC：400 + 700（medium → 400，semibold → 700）
 * - Noto Serif SC：600 + 700
 * - Roboto Mono：400 + 700（medium/semibold → 400/700）
 *
 * Native 面名 = 注册名，禁止再叠 fontWeight（Android 会整段回退）。
 * Web 使用设计稿 CSS 栈，字重靠 fontWeight。
 */
import { Platform, type TextStyle } from 'react-native';

const IS_WEB = Platform.OS === 'web';

/** 设计稿 :root 字族栈（Web 直接复用） */
export const APP_SERIF_STACK =
  '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif';
export const APP_SANS_STACK = '"PingFang SC","Microsoft YaHei UI","Noto Sans SC",sans-serif';
export const APP_MONO_STACK = '"DIN Alternate","SF Mono","Cascadia Mono","Roboto Mono",monospace';

/** Native 注册名（与 useFonts 键一致） */
export const AppFontFace = {
  sansRegular: 'NotoSansSC_400Regular',
  sansBold: 'NotoSansSC_700Bold',
  serifSemiBold: 'NotoSerifSC_600SemiBold',
  serifBold: 'NotoSerifSC_700Bold',
  monoRegular: 'RobotoMono_400Regular',
  monoBold: 'RobotoMono_700Bold',
} as const;

/**
 * 统一字族令牌。各模块 theme（wardrobe / fold / health / finance）应复用此对象。
 */
export const appFonts = {
  serif: IS_WEB ? APP_SERIF_STACK : AppFontFace.serifSemiBold,
  serifBold: IS_WEB ? APP_SERIF_STACK : AppFontFace.serifBold,
  sans: IS_WEB ? APP_SANS_STACK : AppFontFace.sansRegular,
  /** 瘦身后无 500 面，映射到 400 */
  sansMedium: IS_WEB ? APP_SANS_STACK : AppFontFace.sansRegular,
  /** 瘦身后无 600 面，映射到 700 */
  sansSemiBold: IS_WEB ? APP_SANS_STACK : AppFontFace.sansBold,
  sansBold: IS_WEB ? APP_SANS_STACK : AppFontFace.sansBold,
  mono: IS_WEB ? APP_MONO_STACK : AppFontFace.monoRegular,
  monoMedium: IS_WEB ? APP_MONO_STACK : AppFontFace.monoRegular,
  monoSemiBold: IS_WEB ? APP_MONO_STACK : AppFontFace.monoBold,
  monoBold: IS_WEB ? APP_MONO_STACK : AppFontFace.monoBold,
  /** 展示斜体也走 Serif 包，不再用系统 Georgia */
  displayItalic: IS_WEB ? APP_SERIF_STACK : AppFontFace.serifSemiBold,
} as const;

export type AppFonts = typeof appFonts;

/** Web 可写 fontWeight；Native 字重已烤进 fontFamily，禁止再写 weight */
export function face(
  family: string,
  webWeight?: TextStyle['fontWeight'],
  extra?: TextStyle,
): TextStyle {
  if (IS_WEB && webWeight != null) {
    return { fontFamily: family, fontWeight: webWeight, ...extra };
  }
  return { fontFamily: family, ...extra };
}
