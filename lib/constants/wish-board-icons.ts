import { MaterialIcons } from '@expo/vector-icons';

export type WishBoardIconOption = {
  key: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

/** 心愿板可选图标（Material Icons 名称，存入 icon_key） */
export const WISH_BOARD_ICON_OPTIONS: WishBoardIconOption[] = [
  { key: 'card-giftcard', icon: 'card-giftcard' },
  { key: 'favorite', icon: 'favorite' },
  { key: 'movie', icon: 'movie' },
  { key: 'restaurant', icon: 'restaurant' },
  { key: 'local-cafe', icon: 'local-cafe' },
  { key: 'sports-esports', icon: 'sports-esports' },
  { key: 'fitness-center', icon: 'fitness-center' },
  { key: 'flight', icon: 'flight' },
  { key: 'shopping-bag', icon: 'shopping-bag' },
  { key: 'spa', icon: 'spa' },
  { key: 'music-note', icon: 'music-note' },
  { key: 'menu-book', icon: 'menu-book' },
  { key: 'pets', icon: 'pets' },
  { key: 'park', icon: 'park' },
  { key: 'nightlife', icon: 'nightlife' },
  { key: 'icecream', icon: 'icecream' },
  { key: 'redeem', icon: 'redeem' },
  { key: 'celebration', icon: 'celebration' },
  { key: 'self-improvement', icon: 'self-improvement' },
  { key: 'star', icon: 'star' },
];

export const DEFAULT_WISH_BOARD_ICON_KEY = 'card-giftcard';

export function resolveWishBoardIcon(
  iconKey: string | null | undefined,
): keyof typeof MaterialIcons.glyphMap {
  const key = (iconKey ?? '').trim();
  const matched = WISH_BOARD_ICON_OPTIONS.find(o => o.key === key);
  if (matched) return matched.icon;
  if (key && key in MaterialIcons.glyphMap) {
    return key as keyof typeof MaterialIcons.glyphMap;
  }
  return DEFAULT_WISH_BOARD_ICON_KEY as keyof typeof MaterialIcons.glyphMap;
}
