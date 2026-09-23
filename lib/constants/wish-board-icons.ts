/**
 * 心愿板图标：彩色 emoji（与打卡图标同源思路，跨端一致、无需额外字体包）。
 * icon_key 存 key；旧版 Material Icons 名称会映射到对应 emoji，保证历史数据仍可显示。
 */

export type WishBoardIconOption = {
  key: string;
  emoji: string;
  /** 列表角标浅色底 */
  tint: string;
  label: string;
};

export const WISH_BOARD_ICON_OPTIONS: WishBoardIconOption[] = [
  { key: 'gift', emoji: '🎁', tint: '#F472B6', label: '礼物' },
  { key: 'heart', emoji: '💖', tint: '#FB7185', label: '心动' },
  { key: 'movie', emoji: '🎬', tint: '#A78BFA', label: '电影' },
  { key: 'food', emoji: '🍜', tint: '#FB923C', label: '美食' },
  { key: 'coffee', emoji: '☕', tint: '#C4A484', label: '咖啡' },
  { key: 'game', emoji: '🎮', tint: '#60A5FA', label: '游戏' },
  { key: 'fitness', emoji: '💪', tint: '#34D399', label: '运动' },
  { key: 'travel', emoji: '✈️', tint: '#38BDF8', label: '旅行' },
  { key: 'shopping', emoji: '🛍️', tint: '#F472B6', label: '购物' },
  { key: 'spa', emoji: '🛁', tint: '#2DD4BF', label: '放松' },
  { key: 'music', emoji: '🎵', tint: '#C084FC', label: '音乐' },
  { key: 'book', emoji: '📚', tint: '#FBBF24', label: '阅读' },
  { key: 'pet', emoji: '🐱', tint: '#FDBA74', label: '萌宠' },
  { key: 'nature', emoji: '🌸', tint: '#F9A8D4', label: '自然' },
  { key: 'party', emoji: '🥳', tint: '#F87171', label: '派对' },
  { key: 'dessert', emoji: '🍦', tint: '#FCA5A5', label: '甜品' },
  { key: 'camera', emoji: '📷', tint: '#94A3B8', label: '摄影' },
  { key: 'star', emoji: '⭐', tint: '#FACC15', label: '星星' },
  { key: 'beach', emoji: '🏖️', tint: '#38BDF8', label: '度假' },
  { key: 'karaoke', emoji: '🎤', tint: '#E879F9', label: 'K歌' },
  { key: 'bike', emoji: '🚴', tint: '#4ADE80', label: '骑行' },
  { key: 'camping', emoji: '🏕️', tint: '#86EFAC', label: '露营' },
  { key: 'art', emoji: '🎨', tint: '#FB7185', label: '艺术' },
  { key: 'ticket', emoji: '🎟️', tint: '#A78BFA', label: '门票' },
];

export const DEFAULT_WISH_BOARD_ICON_KEY = 'gift';

/** 旧版 Material Icons icon_key → 新 key */
const LEGACY_ICON_KEY_MAP: Record<string, string> = {
  'card-giftcard': 'gift',
  favorite: 'heart',
  movie: 'movie',
  restaurant: 'food',
  'local-cafe': 'coffee',
  'sports-esports': 'game',
  'fitness-center': 'fitness',
  flight: 'travel',
  'shopping-bag': 'shopping',
  spa: 'spa',
  'music-note': 'music',
  'menu-book': 'book',
  pets: 'pet',
  park: 'nature',
  nightlife: 'party',
  icecream: 'dessert',
  redeem: 'gift',
  celebration: 'party',
  'self-improvement': 'spa',
  star: 'star',
};

function normalizeIconKey(iconKey: string | null | undefined): string {
  const raw = (iconKey ?? '').trim();
  if (!raw) return DEFAULT_WISH_BOARD_ICON_KEY;
  if (WISH_BOARD_ICON_OPTIONS.some(o => o.key === raw)) return raw;
  const mapped = LEGACY_ICON_KEY_MAP[raw];
  if (mapped) return mapped;
  return DEFAULT_WISH_BOARD_ICON_KEY;
}

export function resolveWishBoardIconOption(
  iconKey: string | null | undefined,
): WishBoardIconOption {
  const key = normalizeIconKey(iconKey);
  return (
    WISH_BOARD_ICON_OPTIONS.find(o => o.key === key) ??
    WISH_BOARD_ICON_OPTIONS.find(o => o.key === DEFAULT_WISH_BOARD_ICON_KEY)!
  );
}

/** @deprecated 请用 resolveWishBoardIconOption；保留给旧调用方过渡 */
export function resolveWishBoardIcon(iconKey: string | null | undefined): string {
  return resolveWishBoardIconOption(iconKey).emoji;
}

export function wishBoardIconTintSoft(tint: string, isDark: boolean): string {
  // 把主题色做成浅底：暗色略透明，亮色更淡
  const hex = tint.replace('#', '');
  if (hex.length !== 6) return isDark ? 'rgba(244,114,182,0.15)' : 'rgba(190,24,93,0.08)';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return isDark ? `rgba(${r},${g},${b},0.22)` : `rgba(${r},${g},${b},0.16)`;
}
