/**
 * 备忘录视觉令牌。只服务备忘录三页，不改全局 Palette / Motion。
 * 颜色、字号，以及列表卡片 / 时间线的静态尺寸。弹层位移不在这里。
 */
import { PaletteDark, Radius, Typography, type AppPalette } from '@/constants/design-tokens';

export const MemoRadius = {
  card: Radius.lg,
  tag: Radius.xs,
  sheet: Radius.xl,
  field: Radius.md,
} as const;

/** 列表卡片与时间线的静态尺寸。同一天的竖线靠负 margin 穿过卡片间距。 */
export const MemoListLayout = {
  cardPaddingH: 14,
  cardPaddingV: 12,
  cardGap: 8,
  timelineWidth: 16,
  timelineDot: 8,
  /** 圆点与标题行对齐 */
  timelinePadTop: 18,
} as const;

/** 三页共用的字号角色，替代页面里的 800 字重。 */
export const MemoText = {
  listTitle: Typography.title,
  preview: Typography.body,
  time: Typography.label,
  section: Typography.label,
  tag: Typography.label,
  chip: Typography.bodyStrong,
  caption: Typography.caption,
  kicker: Typography.label,
  sheetTitle: Typography.h3,
  sheetOption: Typography.bodyStrong,
  detailTitle: Typography.h2,
  editTitle: Typography.h2,
  save: Typography.bodyStrong,
  aiBody: { ...Typography.body, lineHeight: 22 },
  /** 详情正文段落、列表与引用。 */
  reading: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
} as const;

export type MemoTagStyle = {
  backgroundColor: string;
  borderColor: string;
  borderLeftWidth: number;
  borderLeftColor: string;
  color: string;
};

function normalizeHex(color: string): string | null {
  const raw = color.trim();
  if (!raw.startsWith('#')) return null;
  const h = raw.slice(1);
  if (h.length === 3) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  if (h.length === 6 || h.length === 8) return `#${h.slice(0, 6)}`;
  return null;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 白字叠在标签色上的对比度。无法解析时返回 null。 */
function contrastWithWhite(hex: string): number | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return (1 + 0.05) / (luminance + 0.05);
}

/**
 * 浅色：标签色洗底 + 同色字。
 * 深色：实心标签色 + 白字，与标签选择器一致。
 * 深色标签上白字对比不足时，改为深底、标签色左边线、深色正文色，不用半透明叠色。
 */
export function memoTagStyle(color: string, isDark: boolean): MemoTagStyle {
  const hex = normalizeHex(color) ?? color;
  if (!isDark) {
    const wash = normalizeHex(color);
    return {
      backgroundColor: wash ? `${wash}18` : color,
      borderColor: wash ? `${wash}55` : color,
      borderLeftWidth: 0,
      borderLeftColor: 'transparent',
      color: hex,
    };
  }

  const contrast = contrastWithWhite(color);
  if (contrast != null && contrast < 4.5) {
    return {
      backgroundColor: PaletteDark.surface,
      borderColor: PaletteDark.outline,
      borderLeftWidth: 3,
      borderLeftColor: hex,
      color: PaletteDark.text,
    };
  }

  return {
    backgroundColor: hex,
    borderColor: hex,
    borderLeftWidth: 0,
    borderLeftColor: 'transparent',
    color: '#ffffff',
  };
}

export function memoCardSurface(colors: AppPalette, pinned: boolean): {
  backgroundColor: string;
  borderColor: string;
} {
  return {
    backgroundColor: pinned ? colors.surfaceSubtle : colors.surface,
    borderColor: colors.outline,
  };
}

export function memoTimelineColor(colors: AppPalette, pinned: boolean): string {
  return pinned ? colors.tertiary : colors.primary;
}
