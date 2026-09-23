import { MaterialIcons } from '@expo/vector-icons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { AndroidSymbol } from 'expo-symbols';
import React from 'react';
import { type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

/** 应用内语义图标键（与历史 MaterialIcons 名兼容） */
export type AppIconName =
  | 'edit'
  | 'stars'
  | 'chevron-right'
  | 'card-giftcard'
  | 'receipt-long'
  | 'sticky-note-2'
  | 'restaurant-menu'
  | 'arrow-back'
  | keyof typeof MaterialIcons.glyphMap;

type PlatformSymbol = {
  ios: SFSymbol;
  android: AndroidSymbol;
};

/**
 * MaterialIcons 名 → iOS SF Symbol + Android Material Symbol。
 * 未映射的键回退 MaterialIcons，便于渐进替换。
 */
const PLATFORM_SYMBOLS: Partial<Record<string, PlatformSymbol>> = {
  edit: { ios: 'pencil', android: 'edit' },
  stars: { ios: 'star.fill', android: 'stars' },
  'chevron-right': { ios: 'chevron.right', android: 'chevron_right' },
  'card-giftcard': { ios: 'gift.fill', android: 'card_giftcard' },
  'receipt-long': { ios: 'receipt', android: 'receipt_long' },
  'sticky-note-2': { ios: 'note.text', android: 'sticky_note' },
  'restaurant-menu': { ios: 'fork.knife', android: 'restaurant_menu' },
  'arrow-back': { ios: 'chevron.backward', android: 'arrow_back' },
};

export type AppIconProps = {
  name: AppIconName;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
};

/**
 * 平台图标：iOS 用 SF Symbols，Android/Web 用 Material Symbols（expo-symbols）。
 * 无映射时回退 @expo/vector-icons MaterialIcons。
 */
export function AppIcon({ name, size = 22, color, style }: AppIconProps) {
  const mapped = PLATFORM_SYMBOLS[name];
  const materialFallback = (
    <MaterialIcons
      name={name as keyof typeof MaterialIcons.glyphMap}
      size={size}
      color={color as string | undefined}
      style={style as never}
    />
  );

  if (!mapped) {
    return materialFallback;
  }

  return (
    <SymbolView
      name={{ ios: mapped.ios, android: mapped.android, web: mapped.android }}
      size={size}
      tintColor={color}
      weight="regular"
      style={[{ width: size, height: size }, style]}
      fallback={materialFallback}
    />
  );
}
