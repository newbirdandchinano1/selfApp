/**
 * 全局设计令牌 — 以财务页 `(tabs)/finance` 为基准提取。
 * React Native 项目通过 `useAppTheme` 消费。
 */

/** 4pt 网格间距 */
export const Spacing = {
  /** 4 */
  xs: 4,
  /** 6 */
  sm: 6,
  /** 8 */
  md: 8,
  /** 10 */
  lg: 10,
  /** 12 */
  xl: 12,
  /** 14 */
  '2xl': 14,
  /** 16 */
  '3xl': 16,
  /** 18 — 区块/卡片内常用 */
  '4xl': 18,
  /** 20 — 页面水平边距 */
  '5xl': 20,
  /** 24 */
  '6xl': 24,
  /** 28 — 底部浮动输入条 */
  '7xl': 28,
} as const;

/** 圆角 — 财务页高频值 */
export const Radius = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 16,
  /** 主卡片、净值卡 */
  '2xl': 18,
  /** Bottom Sheet 顶角 */
  sheet: 22,
  /** 浮动记账条 */
  composer: 28,
  /** 圆形图标按钮 (size/2) */
  icon: 18,
  pill: 999,
} as const;

export const Layout = {
  pagePaddingX: Spacing['5xl'],
  contentMaxWidth: 420,
  headerHeight: 48,
  iconButtonSize: 36,
  hitSlop: 8,
} as const;

/** 字重与字号 — 财务页偏粗、紧凑字距 */
export const Typography = {
  display: { fontSize: 44, fontWeight: '900' as const, letterSpacing: -1.2, lineHeight: 48 },
  h1: { fontSize: 26, fontWeight: '900' as const, letterSpacing: -0.8 },
  h2: { fontSize: 22, fontWeight: '900' as const, letterSpacing: -0.6 },
  h3: { fontSize: 18, fontWeight: '900' as const, letterSpacing: -0.3 },
  title: { fontSize: 16, fontWeight: '900' as const, letterSpacing: -0.2 },
  body: { fontSize: 14, fontWeight: '600' as const },
  bodyStrong: { fontSize: 14, fontWeight: '900' as const, letterSpacing: -0.2 },
  caption: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.3 },
  label: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.6 },
  kicker: { fontSize: 10, fontWeight: '900' as const, letterSpacing: 1.8, textTransform: 'uppercase' as const },
} as const;

export const Shadows = {
  card: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  composer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 24,
  },
} as const;

/** 语义色板 — 浅色（财务页主路径） */
export const PaletteLight = {
  background: '#faf8ff',
  surface: '#ffffff',
  surfaceMuted: '#f4f6fb',
  surfaceSubtle: '#f9fafb',
  input: '#f2f3ff',
  text: '#131b2e',
  textSecondary: '#424754',
  textMuted: '#9ca3af',
  primary: '#0058be',
  primarySoft: '#3b82f6',
  primaryMuted: '#e3eefc',
  primaryRing: '#7eb6ff',
  secondary: '#006c49',
  tertiary: '#825100',
  danger: '#dc2626',
  dangerSoft: '#ef4444',
  dangerSurface: '#991b1b',
  success: '#006c49',
  successSwitch: '#4ade80',
  outline: 'rgba(194,198,214,0.26)',
  outlineStrong: '#e5e7eb',
  overlay: 'rgba(0,0,0,0.25)',
  onPrimary: '#ffffff',
  onAccent: '#ffffff',
  accentCard: '#283044',
  accentIcon: '#ffddb8',
  capsule: '#eef2fb',
  progressTrack: '#e3eefc',
  progressFill: '#3b82f6',
  headerScrim: 'rgba(255,255,255,0.82)',
  tabBarBorder: '#f1f5f9',
  iconOnLight: '#111827',
} as const;

/** 语义色板 — 深色 */
export const PaletteDark = {
  background: '#0f172a',
  surface: '#1e293b',
  surfaceMuted: 'rgba(148,163,184,0.12)',
  surfaceSubtle: 'rgba(148,163,184,0.10)',
  input: '#161d2b',
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  primary: '#60a5fa',
  primarySoft: '#60a5fa',
  primaryMuted: 'rgba(96,165,250,0.2)',
  primaryRing: '#60a5fa',
  secondary: '#34d399',
  tertiary: '#fbbf24',
  danger: '#dc2626',
  dangerSoft: '#ef4444',
  dangerSurface: '#fecaca',
  success: '#34d399',
  successSwitch: '#4ade80',
  outline: 'rgba(148,163,184,0.16)',
  outlineStrong: 'rgba(148,163,184,0.24)',
  overlay: 'rgba(0,0,0,0.45)',
  onPrimary: '#ffffff',
  onAccent: '#ffffff',
  accentCard: 'rgba(30,41,59,0.92)',
  accentIcon: '#fbbf24',
  capsule: 'rgba(148,163,184,0.14)',
  progressTrack: 'rgba(96,165,250,0.2)',
  progressFill: '#60a5fa',
  headerScrim: 'rgba(15,23,42,0.82)',
  tabBarBorder: '#1e293b',
  iconOnLight: '#f8fafc',
} as const;

export type ColorScheme = 'light' | 'dark';
export type AppPalette = { readonly [K in keyof typeof PaletteLight]: string };

export function getPalette(scheme: ColorScheme): AppPalette {
  return (scheme === 'dark' ? PaletteDark : PaletteLight) as AppPalette;
}

/** 健康页营养素区分色（功能语义，非全局主色） */
export const HealthNutrientAccents = {
  hydration: '#10b981',
  protein: '#f59e0b',
  carbohydrate: '#eab308',
  calories: '#ef4444',
} as const;

/** 供 NativeWind / Tailwind 预设参考（本项目主路径为 RN StyleSheet） */
export const tailwindPreset = {
  theme: {
    extend: {
      colors: {
        app: {
          bg: PaletteLight.background,
          surface: PaletteLight.surface,
          primary: PaletteLight.primary,
          secondary: PaletteLight.secondary,
          tertiary: PaletteLight.tertiary,
          danger: PaletteLight.danger,
          muted: PaletteLight.textSecondary,
        },
      },
      borderRadius: {
        card: `${Radius['2xl']}px`,
        sheet: `${Radius.sheet}px`,
        pill: `${Radius.pill}px`,
      },
      spacing: {
        page: `${Spacing['5xl']}px`,
      },
    },
  },
} as const;
