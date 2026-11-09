/**
 * 把任意 Text/TextInput style 解析成「衣橱同款」字体包面名。
 * Native：字重烤进 fontFamily，并去掉 fontWeight，避免 Android 回退系统字。
 * Web：补默认 CSS 栈，保留 fontWeight。
 */
import { Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { AppFontFace, appFonts } from '@/constants/app-fonts';

const APP_SANS = new Set<string>([AppFontFace.sansRegular, AppFontFace.sansBold]);
const APP_SERIF = new Set<string>([AppFontFace.serifSemiBold, AppFontFace.serifBold]);
const APP_MONO = new Set<string>([AppFontFace.monoRegular, AppFontFace.monoBold]);

const SYSTEM_SERIF = new Set([
  'serif',
  'ui-serif',
  'Songti SC',
  'STSong',
  'SimSun',
  'Georgia',
  'Times New Roman',
]);
const SYSTEM_MONO = new Set([
  'monospace',
  'ui-monospace',
  'Menlo',
  'Courier',
  'Courier New',
  'SF Mono',
  'Roboto Mono',
]);
const SYSTEM_SANS = new Set([
  'sans-serif',
  'system-ui',
  'ui-sans-serif',
  'normal',
  'System',
  'UITextField',
]);

function weightNumber(weight: TextStyle['fontWeight'] | undefined): number {
  if (weight == null || weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const n = typeof weight === 'number' ? weight : parseInt(String(weight), 10);
  return Number.isFinite(n) ? n : 400;
}

function isBold(weight: TextStyle['fontWeight'] | undefined): boolean {
  return weightNumber(weight) >= 600;
}

function pickFamily(
  current: string | undefined,
  bold: boolean,
): string {
  if (!current || SYSTEM_SANS.has(current) || APP_SANS.has(current)) {
    return bold ? AppFontFace.sansBold : AppFontFace.sansRegular;
  }
  if (SYSTEM_SERIF.has(current) || APP_SERIF.has(current)) {
    return bold ? AppFontFace.serifBold : AppFontFace.serifSemiBold;
  }
  if (
    SYSTEM_MONO.has(current) ||
    APP_MONO.has(current) ||
    /mono/i.test(current)
  ) {
    return bold ? AppFontFace.monoBold : AppFontFace.monoRegular;
  }
  // 已是应用内显式面名（含 CSS 栈）或其它自定义族：不强制改写族，仅处理 APP_* 
  if (current.includes(',') || current.includes('Noto') || current.includes('RobotoMono')) {
    // Web 栈或已注册名
    if (current.includes('Serif') || current.includes('Song')) {
      return bold ? AppFontFace.serifBold : AppFontFace.serifSemiBold;
    }
    if (/mono/i.test(current)) {
      return bold ? AppFontFace.monoBold : AppFontFace.monoRegular;
    }
    if (current.includes('Sans') || current.includes('PingFang') || current.includes('YaHei')) {
      return bold ? AppFontFace.sansBold : AppFontFace.sansRegular;
    }
  }
  // 未知族（极少）：仍落到全局 Sans，保证全 App 统一
  return bold ? AppFontFace.sansBold : AppFontFace.sansRegular;
}

export function resolveAppFontStyle(
  style: StyleProp<TextStyle> | undefined,
): StyleProp<TextStyle> {
  if (Platform.OS === 'web') {
    const flat = StyleSheet.flatten(style) ?? {};
    if (flat.fontFamily) return style;
    return [{ fontFamily: appFonts.sans }, style];
  }

  const flat = StyleSheet.flatten(style) ?? {};
  const bold = isBold(flat.fontWeight);
  const fontFamily = pickFamily(
    typeof flat.fontFamily === 'string' ? flat.fontFamily : undefined,
    bold,
  );

  // 去掉 fontWeight，避免与「单字重面」冲突导致系统回退
  const { fontWeight: _ignored, fontFamily: _old, ...rest } = flat;
  return {
    ...rest,
    fontFamily,
  };
}
