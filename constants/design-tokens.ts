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
  /** 圆形图标按钮 (size/2)，配合 Layout.iconButtonSize=44 */
  icon: 22,
  pill: 999,
} as const;

export const Layout = {
  pagePaddingX: Spacing['5xl'],
  contentMaxWidth: 420,
  /** 宽屏任务页等内容区上限 */
  contentMaxWidthWide: 720,
  headerHeight: 48,
  /**
   * 最小触控热区：iOS HIG 44pt / Material 48dp。
   * 在 StyleSheet.create 外用 getMinTouchTarget() 取分端值。
   */
  minTouchTarget: 44,
  minTouchTargetAndroid: 48,
  /** 图标按钮默认边长；运行时优先用 getMinTouchTarget() */
  iconButtonSize: 44,
  hitSlop: 8,
} as const;


/** 运行时触控下限（StyleSheet 静态值请继续用 Layout.minTouchTarget 作下限） */
export function getMinTouchTarget(platform: typeof import('react-native').Platform.OS = 'ios'): number {
  return platform === 'android' ? Layout.minTouchTargetAndroid : Layout.minTouchTarget;
}

/**
 * 系统字号缩放策略（与 Dynamic Type / Android fontScale 对齐）。
 * RN `Text` 默认 `allowFontScaling`；角色用基准 pt + lineHeight，由系统倍率缩放，
 * 勿再手工 × fontScale，避免双重放大。
 */
export const TextScalePolicy = {
  /** 顶栏、标签、统计等密集 UI */
  maxMultiplierChrome: 1.35,
  /** 姓名、正文、菜单标题等可读内容 */
  maxMultiplierContent: 2,
  /** iOS HIG 可读下限（缩放前 pt） */
  minReadableSize: 11,
} as const;

/** 字重与字号 — 财务页偏粗、紧凑字距；含 lineHeight 以便系统缩放时行距同步 */
export const Typography = {
  display: { fontSize: 44, fontWeight: '900' as const, letterSpacing: -1.2, lineHeight: 52 },
  h1: { fontSize: 28, fontWeight: '900' as const, letterSpacing: -0.8, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '900' as const, letterSpacing: -0.6, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '900' as const, letterSpacing: -0.3, lineHeight: 24 },
  title: { fontSize: 16, fontWeight: '900' as const, letterSpacing: -0.2, lineHeight: 22 },
  body: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20 },
  bodyStrong: { fontSize: 14, fontWeight: '900' as const, letterSpacing: -0.2, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.3, lineHeight: 16 },
  label: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.6, lineHeight: 14 },
  /** ≥11pt：满足 HIG 可读地板；不再使用 10pt kicker */
  kicker: {
    fontSize: 11,
    fontWeight: '900' as const,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
    lineHeight: 14,
  },
} as const;

export type TypographyRole = keyof typeof Typography;

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

/**
 * 任务页专用语义色（优先级象限、热力图、积分等）。
 * 与全局 Palette 并存，避免把功能色塞进主 brand。
 */
export const TaskUiColors = {
  light: {
    priorityP4: '#ba1a1a',
    priorityP3: '#9a5b00',
    priorityP3Alt: '#825100',
    priorityP2: '#0058be',
    priorityP1: '#727785',
    doneText: '#6b7280',
    pointsAccent: '#f59e0b',
    overdueSurface: '#fff5f5',
    shelvedSurface: '#f0f2f7',
    habitBreakSuccess: '#059669',
    habitKindBreak: '#c2410c',
    habitKindTask: '#1d4ed8',
    hairline: 'rgba(148,163,184,0.22)',
    hairlineStrong: 'rgba(148,163,184,0.28)',
    hairlineSoft: 'rgba(148,163,184,0.14)',
    hairlineFaint: 'rgba(148,163,184,0.12)',
    hairlineMuted: 'rgba(114,119,133,0.1)',
    hairlineMutedBorder: 'rgba(114,119,133,0.24)',
    hairlineMutedStrong: 'rgba(114,119,133,0.28)',
    headerBorder: 'rgba(194,198,214,0.55)',
    headerScrim: 'rgba(250,248,255,0.86)',
    pointsChipBg: 'rgba(251,191,36,0.12)',
    pointsChipBorder: 'rgba(217,119,6,0.22)',
    primaryWash: 'rgba(0,88,190,0.08)',
    primaryWashStrong: 'rgba(0,88,190,0.1)',
    primaryWashBorder: 'rgba(0,88,190,0.22)',
    primaryWashLine: 'rgba(0,88,190,0.28)',
    successWash: 'rgba(0,108,73,0.08)',
    successWashStrong: 'rgba(0,108,73,0.1)',
    successWashBorder: 'rgba(0,108,73,0.28)',
    successWashLine: 'rgba(0,108,73,0.24)',
    dangerWash: 'rgba(186,26,26,0.1)',
    dangerWashBorder: 'rgba(186,26,26,0.28)',
    dangerSoftWash: 'rgba(220,38,38,0.08)',
    dangerSoftBorder: 'rgba(220,38,38,0.35)',
    dangerSlipBorder: 'rgba(220,38,38,0.55)',
    dangerSlipText: '#dc2626',
    dangerSlipBadgeBg: 'rgba(220,38,38,0.12)',
    dangerSlipBadgeBorder: 'rgba(220,38,38,0.4)',
    tagWash: '#e2e7ff',
    treeLine: 'rgba(203,213,225,0.9)',
    surfaceFrost: 'rgba(248,250,252,0.9)',
    surfaceFrostSoft: 'rgba(248,250,252,0.72)',
    overlayDim: 'rgba(15,23,42,0.28)',
    onAccent: '#ffffff',
    heatmapLevels: ['#EAEBEE', '#C1DFCC', '#87C3A0', '#4EA871', '#329258'] as const,
  },
  dark: {
    priorityP4: '#f87171',
    priorityP3: '#fbbf24',
    priorityP3Alt: '#fbbf24',
    priorityP2: '#60a5fa',
    priorityP1: '#94a3b8',
    doneText: '#94a3b8',
    pointsAccent: '#f59e0b',
    overdueSurface: '#2c2326',
    shelvedSurface: '#252a34',
    habitBreakSuccess: '#059669',
    habitKindBreak: '#fb923c',
    habitKindTask: '#60a5fa',
    hairline: 'rgba(148,163,184,0.22)',
    hairlineStrong: 'rgba(148,163,184,0.28)',
    hairlineSoft: 'rgba(148,163,184,0.14)',
    hairlineFaint: 'rgba(148,163,184,0.12)',
    hairlineMuted: 'rgba(148,163,184,0.16)',
    hairlineMutedBorder: 'rgba(148,163,184,0.36)',
    hairlineMutedStrong: 'rgba(148,163,184,0.38)',
    headerBorder: 'rgba(148,163,184,0.18)',
    headerScrim: 'rgba(15,23,42,0.75)',
    pointsChipBg: 'rgba(251,191,36,0.14)',
    pointsChipBorder: 'rgba(251,191,36,0.28)',
    primaryWash: 'rgba(96,165,250,0.12)',
    primaryWashStrong: 'rgba(96,165,250,0.14)',
    primaryWashBorder: 'rgba(96,165,250,0.35)',
    primaryWashLine: 'rgba(96,165,250,0.45)',
    successWash: 'rgba(52,211,153,0.12)',
    successWashStrong: 'rgba(52,211,153,0.14)',
    successWashBorder: 'rgba(52,211,153,0.38)',
    successWashLine: 'rgba(52,211,153,0.32)',
    dangerWash: 'rgba(248,113,113,0.16)',
    dangerWashBorder: 'rgba(248,113,113,0.38)',
    dangerSoftWash: 'rgba(239,68,68,0.16)',
    dangerSoftBorder: 'rgba(248,113,113,0.5)',
    dangerSlipBorder: 'rgba(248,113,113,0.7)',
    dangerSlipText: '#f87171',
    dangerSlipBadgeBg: 'rgba(248,113,113,0.22)',
    dangerSlipBadgeBorder: 'rgba(248,113,113,0.5)',
    tagWash: 'rgba(148,163,184,0.14)',
    treeLine: 'rgba(148,163,184,0.22)',
    surfaceFrost: 'rgba(15,23,42,0.28)',
    surfaceFrostSoft: 'rgba(30,41,59,0.35)',
    overlayDim: 'rgba(15,23,42,0.28)',
    onAccent: '#ffffff',
    heatmapLevels: [
      'rgba(51,65,85,0.78)',
      'rgba(193,223,204,0.32)',
      'rgba(135,195,160,0.5)',
      'rgba(78,168,113,0.68)',
      'rgba(50,146,88,0.85)',
    ] as const,
  },
} as const;

export function getTaskUiColors(isDark: boolean) {
  return isDark ? TaskUiColors.dark : TaskUiColors.light;
}

/** 任务优先级色（标签/旗帜） */
export function getTaskPriorityTone(priority: number, isDark: boolean): string {
  const c = getTaskUiColors(isDark);
  if (priority >= 4) return c.priorityP4;
  if (priority === 3) return c.priorityP3;
  if (priority === 2) return c.priorityP2;
  return c.priorityP1;
}

/** 待办勾选图标色（P3 与旗帜略有区分，沿用历史语义） */
export function getTaskPriorityCheckTone(priority: number, isDark: boolean): string {
  const c = getTaskUiColors(isDark);
  if (priority >= 4) return c.priorityP4;
  if (priority === 3) return c.priorityP3Alt;
  if (priority === 2) return c.priorityP2;
  return c.priorityP1;
}

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
