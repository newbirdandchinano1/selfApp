/**
 * 全局设计令牌 — 以健康页 `health-home-theme`（奶油纸 / 松墨绿 / sage）为品牌基准。
 * 财务 / 任务 / 复盘等折页可另有 fold 令牌；React Native 主路径经 `useAppTheme` 消费本色板。
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

/**
 * 字重与字号。页面标题用 Semibold/Bold，正文 Regular，大数字才加重并收紧字距。
 * 含 lineHeight，系统缩放时行距同步。不加载自定义字体，使用系统字。
 */
export const Typography = {
  display: { fontSize: 44, fontWeight: '700' as const, letterSpacing: -1.1, lineHeight: 52 },
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.6, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '600' as const, letterSpacing: -0.3, lineHeight: 24 },
  title: { fontSize: 16, fontWeight: '600' as const, letterSpacing: -0.2, lineHeight: 22 },
  body: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  bodyStrong: { fontSize: 14, fontWeight: '600' as const, letterSpacing: -0.2, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400' as const, letterSpacing: 0, lineHeight: 16 },
  label: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.2, lineHeight: 14 },
  /** ≥11pt：满足 HIG 可读地板；不再使用 10pt kicker */
  kicker: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    lineHeight: 14,
  },
} as const;

export type TypographyRole = keyof typeof Typography;

/** 动效只服务按压和进入，不做逐项编排 */
export const Motion = {
  /** @deprecated 兼容旧调用；新代码用 pressScaleButton / pressScaleCard */
  pressScale: 0.98,
  /** @deprecated 兼容旧调用；新代码用 pressOpacityButton */
  pressOpacity: 0.92,
  /** 主按钮 / 图标按钮按下缩放 */
  pressScaleButton: 0.98,
  /** 可点击整卡按下缩放（更克制，且不叠透明度） */
  pressScaleCard: 0.985,
  /** 主按钮 / 图标按钮按下透明度 */
  pressOpacityButton: 0.94,
  /** 按下 timing 时长 ms */
  pressInMs: 90,
  /** 抬起 spring；RN Animated.spring 的 speed / bounciness */
  pressOutSpring: { speed: 24, bounciness: 3 },
  enterMs: 220,
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

/** 语义色板 — 浅色（对齐 HEALTH_HOME_LIGHT：奶油纸 / 松墨绿） */
export const PaletteLight = {
  background: '#F5F3E8',
  surface: '#FFFEF8',
  surfaceMuted: '#F3F1E6',
  surfaceSubtle: '#EDEBD8',
  input: '#EDEBD8',
  text: '#1E2A24',
  textSecondary: '#4E5A54',
  textMuted: '#7E877F',
  primary: '#1E3932',
  primarySoft: '#7FA695',
  primaryMuted: '#DDE6DF',
  primaryRing: '#2D463F',
  secondary: '#5F8A6E',
  tertiary: '#E0B35A',
  danger: '#dc2626',
  dangerSoft: '#ef4444',
  dangerSurface: '#991b1b',
  success: '#5F8A6E',
  successSwitch: '#4ade80',
  outline: 'rgba(30,57,50,0.09)',
  outlineStrong: 'rgba(30,57,50,0.14)',
  overlay: 'rgba(0,0,0,0.25)',
  onPrimary: '#F7F5EC',
  onAccent: '#F7F5EC',
  accentCard: '#1E3932',
  accentIcon: '#E0B35A',
  capsule: '#DDE6DF',
  progressTrack: 'rgba(30,57,50,0.08)',
  progressFill: '#1E3932',
  headerScrim: 'rgba(245,243,232,0.92)',
  tabBarBorder: 'rgba(30,57,50,0.14)',
  iconOnLight: '#1E2A24',
} as const;

/** 语义色板 — 深色（对齐 HEALTH_HOME_DARK） */
export const PaletteDark = {
  background: '#121A16',
  surface: '#1B2420',
  surfaceMuted: 'rgba(148,163,152,0.1)',
  surfaceSubtle: 'rgba(148,163,152,0.08)',
  input: '#1A2320',
  text: '#F2EEE4',
  textSecondary: '#C6D0C9',
  textMuted: '#8A968F',
  primary: '#A9C7B9',
  primarySoft: '#7FA695',
  primaryMuted: 'rgba(127,166,149,0.22)',
  primaryRing: '#A9C7B9',
  secondary: '#7FA695',
  tertiary: '#E0B072',
  danger: '#dc2626',
  dangerSoft: '#ef4444',
  dangerSurface: '#fecaca',
  success: '#7FA695',
  successSwitch: '#4ade80',
  outline: 'rgba(230,221,206,0.12)',
  outlineStrong: 'rgba(230,221,206,0.22)',
  overlay: 'rgba(0,0,0,0.45)',
  onPrimary: '#F7F2E7',
  onAccent: '#F7F2E7',
  accentCard: 'rgba(27,36,32,0.92)',
  accentIcon: '#E0B072',
  capsule: 'rgba(127,166,149,0.22)',
  progressTrack: 'rgba(230,221,206,0.14)',
  progressFill: '#A9C7B9',
  headerScrim: 'rgba(18,26,22,0.92)',
  tabBarBorder: 'rgba(230,221,206,0.22)',
  iconOnLight: '#F2EEE4',
} as const;

export type ColorScheme = 'light' | 'dark';
export type AppPalette = { readonly [K in keyof typeof PaletteLight]: string };

export function getPalette(scheme: ColorScheme): AppPalette {
  return (scheme === 'dark' ? PaletteDark : PaletteLight) as AppPalette;
}

/** 健康页营养素区分色（功能语义，非全局主色；对齐 health-screens 设计稿） */
export const HealthNutrientAccents = {
  hydration: '#4F8FA8',
  protein: '#C47852',
  carbohydrate: '#C4A04A',
  calories: '#5F8A6E',
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
    priorityP2: '#1E3932',
    priorityP1: '#727785',
    doneText: '#6b7280',
    pointsAccent: '#E0B35A',
    overdueSurface: '#fff5f5',
    shelvedSurface: '#F3F1E6',
    habitBreakSuccess: '#059669',
    habitKindBreak: '#c2410c',
    habitKindTask: '#2D463F',
    hairline: 'rgba(30,57,50,0.1)',
    hairlineStrong: 'rgba(30,57,50,0.16)',
    hairlineSoft: 'rgba(30,57,50,0.08)',
    hairlineFaint: 'rgba(30,57,50,0.06)',
    hairlineMuted: 'rgba(78,90,84,0.1)',
    hairlineMutedBorder: 'rgba(78,90,84,0.22)',
    hairlineMutedStrong: 'rgba(78,90,84,0.28)',
    headerBorder: 'rgba(30,57,50,0.14)',
    headerScrim: 'rgba(245,243,232,0.92)',
    pointsChipBg: 'rgba(224,179,90,0.14)',
    pointsChipBorder: 'rgba(224,179,90,0.28)',
    /** 积分摘要表面（浅色暖纸，非主色） */
    pointsSurface: '#fff8eb',
    pointsSurfaceBorder: 'rgba(224,179,90,0.28)',
    primaryWash: 'rgba(30,57,50,0.08)',
    primaryWashStrong: 'rgba(30,57,50,0.12)',
    primaryWashBorder: 'rgba(30,57,50,0.22)',
    primaryWashLine: 'rgba(30,57,50,0.28)',
    successWash: 'rgba(95,138,110,0.1)',
    successWashStrong: 'rgba(95,138,110,0.14)',
    successWashBorder: 'rgba(95,138,110,0.28)',
    successWashLine: 'rgba(95,138,110,0.24)',
    dangerWash: 'rgba(186,26,26,0.1)',
    dangerWashBorder: 'rgba(186,26,26,0.28)',
    dangerSoftWash: 'rgba(220,38,38,0.08)',
    dangerSoftBorder: 'rgba(220,38,38,0.35)',
    dangerSlipBorder: 'rgba(220,38,38,0.55)',
    dangerSlipText: '#dc2626',
    dangerSlipBadgeBg: 'rgba(220,38,38,0.12)',
    dangerSlipBadgeBorder: 'rgba(220,38,38,0.4)',
    tagWash: '#DDE6DF',
    treeLine: 'rgba(30,57,50,0.14)',
    surfaceFrost: 'rgba(255,254,248,0.9)',
    surfaceFrostSoft: 'rgba(245,243,232,0.78)',
    overlayDim: 'rgba(30,42,36,0.28)',
    onAccent: '#F7F5EC',
    heatmapLevels: ['#EAEBEE', '#C1DFCC', '#87C3A0', '#4EA871', '#329258'] as const,
  },
  dark: {
    priorityP4: '#f87171',
    priorityP3: '#fbbf24',
    priorityP3Alt: '#fbbf24',
    priorityP2: '#A9C7B9',
    priorityP1: '#8A968F',
    doneText: '#8A968F',
    pointsAccent: '#E0B072',
    overdueSurface: '#2c2326',
    shelvedSurface: '#1A2320',
    habitBreakSuccess: '#059669',
    habitKindBreak: '#fb923c',
    habitKindTask: '#A9C7B9',
    hairline: 'rgba(230,221,206,0.14)',
    hairlineStrong: 'rgba(230,221,206,0.22)',
    hairlineSoft: 'rgba(230,221,206,0.1)',
    hairlineFaint: 'rgba(230,221,206,0.08)',
    hairlineMuted: 'rgba(148,163,152,0.16)',
    hairlineMutedBorder: 'rgba(148,163,152,0.32)',
    hairlineMutedStrong: 'rgba(148,163,152,0.38)',
    headerBorder: 'rgba(230,221,206,0.18)',
    headerScrim: 'rgba(18,26,22,0.88)',
    pointsChipBg: 'rgba(224,176,114,0.14)',
    pointsChipBorder: 'rgba(224,176,114,0.28)',
    /** 积分摘要表面（深色暖底，非简单反转） */
    pointsSurface: '#2a2110',
    pointsSurfaceBorder: 'rgba(224,176,114,0.28)',
    primaryWash: 'rgba(169,199,185,0.14)',
    primaryWashStrong: 'rgba(169,199,185,0.18)',
    primaryWashBorder: 'rgba(169,199,185,0.35)',
    primaryWashLine: 'rgba(169,199,185,0.45)',
    successWash: 'rgba(127,166,149,0.14)',
    successWashStrong: 'rgba(127,166,149,0.18)',
    successWashBorder: 'rgba(127,166,149,0.38)',
    successWashLine: 'rgba(127,166,149,0.32)',
    dangerWash: 'rgba(248,113,113,0.16)',
    dangerWashBorder: 'rgba(248,113,113,0.38)',
    dangerSoftWash: 'rgba(239,68,68,0.16)',
    dangerSoftBorder: 'rgba(248,113,113,0.5)',
    dangerSlipBorder: 'rgba(248,113,113,0.7)',
    dangerSlipText: '#f87171',
    dangerSlipBadgeBg: 'rgba(248,113,113,0.22)',
    dangerSlipBadgeBorder: 'rgba(248,113,113,0.5)',
    tagWash: 'rgba(127,166,149,0.18)',
    treeLine: 'rgba(230,221,206,0.18)',
    surfaceFrost: 'rgba(18,26,22,0.35)',
    surfaceFrostSoft: 'rgba(27,36,32,0.4)',
    overlayDim: 'rgba(18,26,22,0.4)',
    onAccent: '#F7F2E7',
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
