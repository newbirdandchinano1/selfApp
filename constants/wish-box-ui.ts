import type { TextStyle, ViewStyle } from 'react-native';

/** 心愿匣语义色板（浅色为设计稿基准；深色与首页夜间配色同一暖棕家族） */
export type WishBoxPalette = {
  bg: string;
  card: string;
  cardLocked: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  lineStrong: string;
  pri: string;
  pri2: string;
  priSoft: string;
  priLine: string;
  coinSoft: string;
  coinWash: string;
  mint: string;
  mintSoft: string;
  amberSoft: string;
  graySoft: string;
  sheet: string;
  coin: string;
  once: string;
  overlay: string;
  balance: string;
  danger: string;
  dangerSoft: string;
  progressTrack: string;
  wash: string;
  washLine: string;
  divider: string;
  handle: string;
  fieldSoft: string;
  dashedLine: string;
  dashedText: string;
  dots: string;
  faintInk: string;
  uploadLine: string;
  uploadText: string;
  disabledBg: string;
  disabledText: string;
  tip: string;
  tipLine: string;
  totalLabel: string;
  footer: string;
  switchKnob: string;
  /** 兑换成功页背景（浅色暖纸 / 深色暖夜） */
  successBg: string;
  successBgTop: string;
  successBgMid: string;
  /** 深色墨底上的文字（浅色模式白字，深色墨底为深字） */
  onInk: string;
  onInkSoft: string;
};

export const WishBoxColors: WishBoxPalette = {
  bg: '#F8F2E9',
  card: '#fff',
  cardLocked: '#FCF9F4',
  ink: '#2E2320',
  ink2: '#5C4B44',
  muted: '#A08A7B',
  line: '#EFE2D3',
  lineStrong: '#E7D5C2',
  pri: '#EF5F38',
  pri2: '#FF8A5B',
  priSoft: '#FFECE2',
  priLine: '#F6C9B6',
  coinSoft: '#FFF3DD',
  coinWash: '#FFF3E6',
  mint: '#3FA184',
  mintSoft: '#E7F5ED',
  amberSoft: '#FFF1DC',
  graySoft: '#F1EAE2',
  sheet: '#FFFBF4',
  coin: '#B26A06',
  once: '#C07A12',
  overlay: 'rgba(46,30,23,0.48)',
  balance: '#F06540',
  danger: '#D63A26',
  dangerSoft: '#FDECE7',
  progressTrack: '#F1E3D2',
  wash: '#FBF6EE',
  washLine: '#F1E4D1',
  divider: '#F0E3D2',
  handle: '#E3D2BF',
  fieldSoft: '#FFFDF8',
  dashedLine: '#DFC6AC',
  dashedText: '#A9805F',
  dots: '#B9A795',
  faintInk: '#C9B39C',
  uploadLine: '#D9BFA6',
  uploadText: '#C08A5A',
  disabledBg: '#E7DACA',
  disabledText: '#AB9687',
  tip: '#FFF8F0',
  tipLine: '#E7B68F',
  totalLabel: '#8A6248',
  footer: 'rgba(248,242,233,0.96)',
  switchKnob: '#fff',
  successBg: '#FFF9F0',
  successBgTop: '#FFF9F0',
  successBgMid: '#FDEFE0',
  onInk: '#fff',
  onInkSoft: 'rgba(255,255,255,0.7)',
};

/** 深色：沿用首页心愿匣夜间暖棕，避免子页面回到白卡 */
export const WishBoxColorsDark: WishBoxPalette = {
  bg: '#0F172A',
  card: '#4A3E37',
  cardLocked: '#3F362F',
  ink: '#F7EDE3',
  ink2: '#E2D2C6',
  muted: '#CCB9AC',
  line: '#726052',
  lineStrong: '#8A7361',
  pri: '#FF8A5B',
  pri2: '#FFA07A',
  priSoft: 'rgba(255,138,91,0.18)',
  priLine: 'rgba(255,138,91,0.4)',
  coinSoft: 'rgba(255,193,120,0.16)',
  coinWash: 'rgba(255,193,120,0.12)',
  mint: '#6FD3B0',
  mintSoft: 'rgba(111,211,176,0.16)',
  amberSoft: 'rgba(255,193,120,0.14)',
  graySoft: 'rgba(204,185,172,0.14)',
  sheet: '#3A302A',
  coin: '#FFC178',
  once: '#FFC178',
  overlay: 'rgba(8,10,18,0.62)',
  balance: '#F06540',
  danger: '#FF7A66',
  dangerSoft: 'rgba(255,122,102,0.16)',
  progressTrack: 'rgba(204,185,172,0.24)',
  wash: 'rgba(204,185,172,0.08)',
  washLine: 'rgba(204,185,172,0.2)',
  divider: 'rgba(204,185,172,0.2)',
  handle: 'rgba(204,185,172,0.38)',
  fieldSoft: 'rgba(204,185,172,0.08)',
  dashedLine: 'rgba(204,185,172,0.34)',
  dashedText: '#D8B795',
  dots: '#B39C8B',
  faintInk: '#B8A695',
  uploadLine: 'rgba(204,185,172,0.34)',
  uploadText: '#E0AE80',
  disabledBg: 'rgba(204,185,172,0.18)',
  disabledText: '#A08C7C',
  tip: '#49382E',
  tipLine: '#A87854',
  totalLabel: '#E2C3AD',
  footer: 'rgba(15,23,42,0.94)',
  switchKnob: '#F7EDE3',
  successBg: '#141C2E',
  successBgTop: '#1B2233',
  successBgMid: '#221A1B',
  onInk: '#0F172A',
  onInkSoft: 'rgba(15,23,42,0.65)',
};

export function getWishBoxPalette(isDark: boolean): WishBoxPalette {
  return isDark ? WishBoxColorsDark : WishBoxColors;
}

/** 设计稿里的渐变（135° 对角），供 SVG LinearGradient 使用 */
export const WishBoxGradients = {
  /** 积分卡：左上亮橙 → 主橙 → 右下深红 */
  balance: ['#FF9366', '#F06540', '#D94A2B'] as const,
  /** 积分卡光带扫过的高光 */
  balanceShine: 'rgba(255,255,255,0.38)',
  /** 主按钮（135° 柿子橙） */
  primary: ['#FF8A5B', '#EF5F38'] as const,
  /** 头像 */
  avatar: ['#FFB37E', '#EF5F38'] as const,
  /** 进度条填充（暖橙） */
  barWarm: ['#FFB37E', '#EF5F38'] as const,
  /** 进度条填充（薄荷） */
  barMint: ['#7CCBAE', '#3FA184'] as const,
} as const;

/** 深色下积分卡略收亮度，避免夜间刺眼 */
export const WishBoxGradientsDark = {
  balance: ['#E5764A', '#D0552F', '#A94A2A'] as const,
  balanceShine: 'rgba(255,255,255,0.22)',
  primary: ['#FF8A5B', '#EF5F38'] as const,
  avatar: ['#FFB37E', '#EF5F38'] as const,
  barWarm: ['#FFB37E', '#EF5F38'] as const,
  barMint: ['#7CCBAE', '#3FA184'] as const,
} as const;

export type WishBoxGradientSet = {
  readonly balance: readonly string[];
  readonly balanceShine: string;
  readonly primary: readonly string[];
  readonly avatar: readonly string[];
  readonly barWarm: readonly string[];
  readonly barMint: readonly string[];
};

export function getWishBoxGradients(isDark: boolean): WishBoxGradientSet {
  return isDark ? WishBoxGradientsDark : WishBoxGradients;
}

export type WishBoxColorKey = keyof typeof WishBoxColors;

export type WishBoxShadowSet = {
  card: ViewStyle;
  soft: ViewStyle;
  balance: ViewStyle;
  sheet: ViewStyle;
  button: ViewStyle;
  dangerButton: ViewStyle;
  dialog: ViewStyle;
};

export const WishBoxShadows = {
  card: {
    shadowColor: '#603A24',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 13,
    elevation: 4,
  } satisfies ViewStyle,
  soft: {
    shadowColor: '#603A24',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  } satisfies ViewStyle,
  balance: {
    shadowColor: '#D94A2B',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.35,
    shadowRadius: 17,
    elevation: 8,
  } satisfies ViewStyle,
  sheet: {
    shadowColor: '#2E1E17',
    shadowOffset: { width: 0, height: -18 },
    shadowOpacity: 0.25,
    shadowRadius: 25,
    elevation: 16,
  } satisfies ViewStyle,
  button: {
    shadowColor: '#EF5F38',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  } satisfies ViewStyle,
  dangerButton: {
    shadowColor: '#D63A26',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  } satisfies ViewStyle,
  dialog: {
    shadowColor: '#2E1E17',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 20,
  } satisfies ViewStyle,
} satisfies WishBoxShadowSet;

export const WishBoxShadowsDark: WishBoxShadowSet = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  balance: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 9,
  },
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -18 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 16,
  },
  button: {
    shadowColor: '#EF5F38',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 6,
  },
  dangerButton: {
    shadowColor: '#D63A26',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 6,
  },
  dialog: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.5,
    shadowRadius: 34,
    elevation: 20,
  },
};

export function getWishBoxShadows(isDark: boolean): WishBoxShadowSet {
  return isDark ? WishBoxShadowsDark : WishBoxShadows;
}

export const WishBoxText = {
  tabular: { fontVariant: ['tabular-nums'] } satisfies TextStyle,
} as const;

/** 展示用千分位；支持整数与小数 */
export function formatWishBoxPoints(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  const abs = Math.abs(n);
  const [intRaw, frac] = String(abs).split('.');
  const intPart = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac != null ? `${intPart}.${frac}` : intPart;
  return neg ? `-${body}` : body;
}

/** 早上好 / 下午好 / 晚上好（不含表情，表情由 `greetingMoonByHour` 放在名字后） */
export function greetingByHour(date: Date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return '早上好';
  if (h >= 12 && h < 18) return '下午好';
  return '晚上好';
}

/** 晚间问候的月亮后缀（设计稿：「晚上好，小满 🌙」），其余时段为空串 */
export function greetingMoonByHour(date: Date = new Date()): string {
  const h = date.getHours();
  return h >= 18 || h < 5 ? ' 🌙' : '';
}

/** 取名称首字（Unicode 安全） */
export function monogramFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = [...trimmed][0];
  return first ?? '?';
}

/** 图标 tint → 浅色底（心愿卡 wtile） */
export function wishBoxTintWash(tint: string): string {
  const hex = tint.replace('#', '');
  if (hex.length !== 6) return WishBoxColors.priSoft;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.22)`;
}

/**
 * 图标 tint → 135° 两段渐变（设计稿「大图标底」：浅色 → 原色）。
 * t 为向白色混合的比例：起始更浅、终点接近原色。
 */
export function wishBoxTintGradient(tint: string): readonly [string, string] {
  const hex = tint.replace('#', '');
  if (hex.length !== 6) return ['#FFE4CF', WishBoxColors.pri];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (t: number) => {
    const rr = Math.round(r + (255 - r) * t);
    const gg = Math.round(g + (255 - g) * t);
    const bb = Math.round(b + (255 - b) * t);
    return `rgb(${rr},${gg},${bb})`;
  };
  return [mix(0.55), mix(0.18)];
}
