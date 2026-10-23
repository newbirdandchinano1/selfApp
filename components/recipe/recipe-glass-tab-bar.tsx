import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { hydrateRecipeHaptic, recipeSelectionHaptic } from '@/lib/recipe-haptic';
import { getRecipePalette } from '@/lib/recipe-theme';
import {
  resetTabBarAutoHide,
  tabBarVisibility,
  useTabBarHidden,
} from '@/lib/tab-bar-auto-hide';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  SharedValue,
  cancelAnimation,
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedGlassBubble } from '@/components/recipe/recipe-animated-glass-bubble';
import type { BubbleTheme } from '@/components/recipe/recipe-glass-bubble-types';

const AnimatedText = Animated.createAnimatedComponent(Text);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const RECIPE_GLASS_TAB_BAR_HEIGHT = 58;
export const RECIPE_GLASS_TAB_BAR_GAP = 12;

/**
 * 统一可维护的动效参数（按真机手感微调此处即可）。
 * 使用物理弹簧（stiffness/damping/mass），可打断且保留速度；
 * 不要用 duration+dampingRatio + cancelAnimation，连点会跳变。
 */
export const RECIPE_TAB_MOTION = {
  /** 按下瞬间缩小（整项） */
  pressScale: 0.9,
  /** 选中时该项（图标+文字）放大峰值 */
  selectPop: 1.16,
  /** 切换 Tab 时整条胶囊底栏放大峰值 */
  barPop: 1.06,
  /** 选中回落后静止尺寸 */
  selectRest: 1,
  /** 未选中尺寸 */
  idleScale: 1,
  /** 文字透明度（不做缩放，避免与图标重叠/跳动） */
  labelActiveOpacity: 1,
  labelIdleOpacity: 0.55,
  /** 弹出到峰值的短行程（ms） */
  popUpMs: 100,
  /** 整栏弹起行程（ms） */
  barPopMs: 110,
  /** 玻璃气泡位移 */
  travel: { stiffness: 260, damping: 28, mass: 0.85 },
  /** 玻璃显现 / 收敛 */
  glass: { stiffness: 300, damping: 30, mass: 0.75 },
  /** 回落 / 取消选中 */
  settle: { stiffness: 320, damping: 28, mass: 0.8 },
  /** 场景页交叉淡入（与 travel 同拍） */
  scene: {
    stiffness: 260,
    damping: 30,
    mass: 0.9,
    overshootClamping: true as const,
    restDisplacementThreshold: 0.01,
    restSpeedThreshold: 0.01,
  },
} as const;

type SpringCfg = { stiffness: number; damping: number; mass: number };

type TabRoute = {
  key: string;
  name: string;
  params?: object;
};

export type GlassTabIconState = { active: boolean; color: string };

/**
 * 单个 Tab 的图标与文案。
 * 默认走 Ionicons 描边/填充对；也可以用 renderIcon 接入 AppIcon 等自定义图标。
 */
export type GlassTabMeta = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconActive?: keyof typeof Ionicons.glyphMap;
  renderIcon?: (state: GlassTabIconState) => React.ReactNode;
};

/** 与 Expo Router / React Navigation 自定义 tabBar 入参对齐的最小类型 */
export type RecipeGlassTabBarProps = {
  state: {
    index: number;
    routes: TabRoute[];
  };
  descriptors: Record<
    string,
    {
      options: {
        title?: string;
        tabBarLabel?: string;
        tabBarAccessibilityLabel?: string;
        /** 数字角标（0 / 空不显示） */
        tabBarBadge?: string | number;
      };
    }
  >;
  /** Expo Router 新 API：替代旧的 navigation.emit */
  emitter: {
    emit: (event: {
      type: string;
      target?: string;
      canPreventDefault?: boolean;
    }) => { defaultPrevented: boolean };
  };
  /** Expo Router 新 API：按 route.key 切 Tab（替代 navigation.navigate） */
  navigateToTab: (routeKey: string) => void;
  /** 路由名 → Tab 图标与文案；缺省使用内置菜谱配置 */
  meta?: Record<string, GlassTabMeta>;
  /** 覆盖明暗判定，默认跟随全局色板 */
  isDark?: boolean;
  /** 选中 / 未选中着色覆盖 */
  activeColor?: string;
  idleColor?: string;
  /** 跟随页面滚动自动淡入淡出（下滑隐藏 / 上滑显示） */
  autoHide?: boolean;
};

/** Ionicons：描边 / 填充成对，选中切填充（保留项目原图标） */
const TAB_META: Record<string, GlassTabMeta> = {
  index: { label: '菜谱', icon: 'book-outline', iconActive: 'book' },
  plan: { label: '计划', icon: 'calendar-outline', iconActive: 'calendar' },
  shop: { label: '采购', icon: 'cart-outline', iconActive: 'cart' },
  mine: { label: '我的', icon: 'person-outline', iconActive: 'person' },
};

const HIGHLIGHT_PAD = 4;
/** 胶囊圆角：接近半高，呈长条圆角胶囊 */
const SHELL_RADIUS = RECIPE_GLASS_TAB_BAR_HEIGHT / 2;
const ICON_SIZE = 22;
/** 预留 selectPop 放大空间，布局高度不随 transform 变 */
const ICON_BOX = Math.ceil(ICON_SIZE * RECIPE_TAB_MOTION.selectPop) + 2;
const LABEL_BOX_H = 14;

/** 选中深绿 / 未选中黑（浅色模式验收色） */
const ICON_ACTIVE_LIGHT = '#0F5C38';
const ICON_IDLE_LIGHT = '#111111';
const ICON_ACTIVE_DARK = '#6EE7A8';
const ICON_IDLE_DARK = 'rgba(230,234,240,0.78)';

function springTo(shared: SharedValue<number>, to: number, reduceMotion: boolean, cfg: SpringCfg) {
  if (reduceMotion) {
    shared.value = to;
    return;
  }
  // 直接覆盖 withSpring：从当前值+速度续播，不要先 cancelAnimation
  shared.value = withSpring(to, cfg);
}

function shellTokens(isDark: boolean) {
  if (isDark) {
    return {
      shellBorder: 'rgba(255,255,255,0.16)',
      // 悬浮在滚动内容之上：用带灰度的半透明底色 + 深描边，任何背景上都读得出块面
      shellTint: 'rgba(32,34,40,0.74)',
      innerStroke: 'rgba(255,255,255,0.12)',
      specular: 'rgba(255,255,255,0.24)',
      bevel: 'rgba(0,0,0,0.24)',
      shadowOpacity: 0.45,
      blurIntensity: Platform.OS === 'ios' ? 48 : 64,
      blurTint: 'systemThinMaterialDark' as const,
      webBg: 'rgba(32,34,40,0.78)',
    };
  }
  return {
    shellBorder: 'rgba(15,23,42,0.12)',
    shellTint: 'rgba(240,242,247,0.78)',
    innerStroke: 'rgba(255,255,255,0.65)',
    specular: 'rgba(255,255,255,0.9)',
    bevel: 'rgba(0,0,0,0.05)',
    shadowOpacity: 0.16,
    blurIntensity: Platform.OS === 'ios' ? 42 : 58,
    blurTint: 'systemThinMaterialLight' as const,
    webBg: 'rgba(240,242,247,0.82)',
  };
}

function bubbleTheme(isDark: boolean): BubbleTheme {
  if (isDark) {
    return {
      settleFill: 'rgba(255,255,255,0.12)',
      settleBorder: 'rgba(255,255,255,0.18)',
      glassFill: 'rgba(255,255,255,0.16)',
      highlight: 'rgba(255,255,255,0.42)',
      isDark: true,
    };
  }
  return {
    settleFill: 'rgba(0,0,0,0.07)',
    settleBorder: 'rgba(255,255,255,0.7)',
    glassFill: 'rgba(255,255,255,0.38)',
    highlight: 'rgba(255,255,255,0.85)',
    isDark: false,
  };
}

/**
 * 菜谱模块底部悬浮 Liquid Glass Tab（同时作为主 Tab 栏通用实现）。
 * 结构：BaseGlassBackground + StaticTabItems + AnimatedGlassBubble + TabPressFeedback
 * 导航逻辑与视觉层解耦：只消费 state/emitter/navigateToTab，不改路由表。
 * 图标与配色可由调用方通过 meta / activeColor / idleColor 覆盖。
 */
export function RecipeGlassTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  meta,
  isDark: isDarkOverride,
  activeColor,
  idleColor,
  autoHide = false,
}: RecipeGlassTabBarProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const reduceMotion = useReducedMotion();
  const p = getRecipePalette(colorScheme);

  useEffect(() => {
    void hydrateRecipeHaptic();
  }, []);
  const isDark = isDarkOverride ?? p.isDark;
  const tabMeta = meta ?? TAB_META;
  const shell = shellTokens(isDark);
  const bubble = useMemo(() => bubbleTheme(isDark), [isDark]);
  const bottomPad = Math.max(insets.bottom, 10);
  const motion = RECIPE_TAB_MOTION;

  const iconActive = activeColor ?? (isDark ? ICON_ACTIVE_DARK : ICON_ACTIVE_LIGHT);
  const iconIdle = idleColor ?? (isDark ? ICON_IDLE_DARK : ICON_IDLE_LIGHT);

  // —— 滚动淡出淡入（主 Tab 悬浮栏）——
  const barHidden = useTabBarHidden();
  const autoHideStyle = useAnimatedStyle(() => ({
    opacity: tabBarVisibility.value,
  }));
  useEffect(() => {
    if (!autoHide) return;
    resetTabBarAutoHide();
  }, [autoHide, state.index]);

  const [layouts, setLayouts] = useState<Array<{ x: number; width: number } | null>>(
    () => state.routes.map(() => null),
  );
  const [barWidth, setBarWidth] = useState(0);

  // —— 共享动态选中指示器（单一气泡，禁止每 Tab 各挂一份再显隐）——
  const bubbleX = useSharedValue(0);
  const bubbleW = useSharedValue(0);
  const targetX = useSharedValue(0);
  const targetW = useSharedValue(0);
  const glassProgress = useSharedValue(0);
  const bubbleOpacity = useSharedValue(0);
  /** 整条胶囊底栏缩放：切换 Tab 时弹性放大再回落 */
  const shellScale = useSharedValue(1);

  /** 已提交的高亮目标，避免 layouts 抖动重复触发弹簧 */
  const committedHlRef = useRef<{ index: number; x: number; w: number } | null>(null);
  const hlReadyRef = useRef(false);
  /** 用于判断是否真正切换了 Tab（跳过首次挂载） */
  const prevTabIndexRef = useRef<number | null>(null);

  const onShellLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== barWidth) setBarWidth(w);
  };

  const onItemLayout = (index: number, e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts(prev => {
      const next = [...prev];
      const cur = next[index];
      if (cur && cur.x === x && cur.width === width) return prev;
      next[index] = { x, width };
      return next;
    });
  };

  const moveBubbleTo = useCallback(
    (index: number) => {
      const layout = layouts[index];
      if (!layout || layout.width <= 0) return;

      const nextX = layout.x + HIGHLIGHT_PAD;
      const nextW = Math.max(layout.width - HIGHLIGHT_PAD * 2, 44);
      const prev = committedHlRef.current;
      if (prev && prev.index === index && prev.x === nextX && prev.w === nextW) {
        return;
      }

      const dx = prev ? Math.abs(nextX - prev.x) : 0;
      committedHlRef.current = { index, x: nextX, w: nextW };
      targetX.value = nextX;
      targetW.value = nextW;

      if (reduceMotion) {
        cancelAnimation(bubbleX);
        cancelAnimation(bubbleW);
        cancelAnimation(glassProgress);
        cancelAnimation(bubbleOpacity);
        bubbleX.value = nextX;
        bubbleW.value = nextW;
        glassProgress.value = 0;
        bubbleOpacity.value = 1;
        hlReadyRef.current = true;
        return;
      }

      // 首次出现：淡入浅灰选中底，不播液态行程
      if (!hlReadyRef.current) {
        bubbleX.value = nextX;
        bubbleW.value = nextW;
        glassProgress.value = 0;
        bubbleOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
        hlReadyRef.current = true;
        return;
      }

      // 阶段 A→B：玻璃显现 + 连续弹簧位移（可打断衔接）
      if (dx > 4) {
        glassProgress.value = withSpring(1, motion.glass);
      }
      springTo(bubbleX, nextX, false, motion.travel);
      springTo(bubbleW, nextW, false, motion.travel);
    },
    [
      bubbleOpacity,
      bubbleW,
      bubbleX,
      glassProgress,
      layouts,
      motion.glass,
      motion.travel,
      reduceMotion,
      targetW,
      targetX,
    ],
  );

  // 阶段 C：接近目标后玻璃收敛为浅灰选中底（连续弹簧，非割裂三段）
  useAnimatedReaction(
    () => {
      const dx = Math.abs(bubbleX.value - targetX.value);
      const dw = Math.abs(bubbleW.value - targetW.value);
      return dx < 1.2 && dw < 1.2;
    },
    (near, prev) => {
      if (near && prev === false && glassProgress.value > 0.05) {
        glassProgress.value = withSpring(0, motion.glass);
      }
    },
    [motion.glass],
  );

  const selectedLayout = layouts[state.index];
  useEffect(() => {
    moveBubbleTo(state.index);
  }, [moveBubbleTo, selectedLayout?.x, selectedLayout?.width, state.index]);

  // 切换 Tab：整条胶囊栏弹性放大再回落（用户可感知的「整栏」动效）
  useEffect(() => {
    const prev = prevTabIndexRef.current;
    prevTabIndexRef.current = state.index;
    if (prev === null || prev === state.index) return;
    if (reduceMotion) {
      shellScale.value = 1;
      return;
    }
    shellScale.value = withSequence(
      withTiming(motion.barPop, {
        duration: motion.barPopMs,
        easing: Easing.out(Easing.cubic),
      }),
      withSpring(1, motion.settle),
    );
  }, [motion.barPop, motion.barPopMs, motion.settle, reduceMotion, shellScale, state.index]);

  const shellScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shellScale.value }],
  }));

  return (
    <Animated.View
      pointerEvents={autoHide && barHidden ? 'none' : 'box-none'}
      style={[
        styles.wrap,
        { paddingBottom: bottomPad },
        autoHide ? autoHideStyle : null,
      ]}>
      <View onLayout={onShellLayout} style={styles.shell}>
        {/* 背景层独立承接整栏弹跳缩放：文字不参与 transform，避免动画期间发虚 */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shellBg,
            {
              borderColor: shell.shellBorder,
              shadowColor: isDark ? '#000' : '#1c2430',
              ...Platform.select({
                ios: { shadowOpacity: shell.shadowOpacity },
                default: {},
              }),
            },
            shellScaleStyle,
          ]}>
          {/* BaseGlassBackground：模糊与描边裁剪在内层，外壳 overflow 可见以容纳凸起气泡 */}
          <View style={styles.shellClip} pointerEvents="none">
            {Platform.OS === 'web' ? (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: shell.webBg,
                    ...({ backdropFilter: 'blur(24px) saturate(1.25)' } as object),
                  },
                ]}
              />
            ) : (
              <BlurView
                intensity={shell.blurIntensity}
                tint={shell.blurTint}
                blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
                style={StyleSheet.absoluteFill}
              />
            )}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: shell.shellTint }]} />
            <View style={[styles.innerStroke, { borderColor: shell.innerStroke }]} />
            <View style={[styles.specular, { backgroundColor: shell.specular }]} />
            <View style={[styles.bevel, { backgroundColor: shell.bevel }]} />
          </View>

          {/* AnimatedGlassBubble：共享动态指示器 */}
          {barWidth > 0 ? (
            <AnimatedGlassBubble
              barWidth={barWidth}
              barHeight={RECIPE_GLASS_TAB_BAR_HEIGHT}
              bubbleX={bubbleX}
              bubbleW={bubbleW}
              targetX={targetX}
              glassProgress={glassProgress}
              opacity={bubbleOpacity}
              theme={bubble}
            />
          ) : null}
        </Animated.View>

        {/* StaticTabItems + TabPressFeedback */}
        <View style={styles.row}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const { options } = descriptors[route.key];
            const entry = tabMeta[route.name];
            const label =
              options.tabBarLabel !== undefined
                ? String(options.tabBarLabel)
                : options.title !== undefined
                  ? options.title
                  : (entry?.label ?? route.name);
            const badge = normalizeTabBadge(options.tabBarBadge);

            const renderIcon = (s: GlassTabIconState) => {
              if (entry?.renderIcon) return entry.renderIcon(s);
              const name = s.active
                ? (entry?.iconActive ?? 'ellipse')
                : (entry?.icon ?? 'ellipse-outline');
              return <Ionicons name={name} size={ICON_SIZE} color={s.color} />;
            };

            const onPress = () => {
              const event = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                recipeSelectionHaptic();
                navigateToTab(route.key);
              }
            };

            return (
              <TabItem
                key={route.key}
                focused={focused}
                label={label}
                renderIcon={renderIcon}
                badge={badge}
                activeColor={iconActive}
                idleColor={iconIdle}
                labelActive={iconActive}
                labelIdle={iconIdle}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                reduceMotion={reduceMotion}
                onPress={onPress}
                onLayout={e => onItemLayout(index, e)}
              />
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

/** 通用玻璃底栏：菜谱模块与主 Tab 共用同一套实现 */
export const GlassTabBar = RecipeGlassTabBar;

type TabItemProps = {
  focused: boolean;
  label: string;
  renderIcon: (state: GlassTabIconState) => React.ReactNode;
  badge?: string;
  activeColor: string;
  idleColor: string;
  labelActive: string;
  labelIdle: string;
  accessibilityLabel: string;
  reduceMotion: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
};

/** 图标按压反馈 + 选中色过渡（与玻璃气泡同步，幅度克制） */
function TabItem({
  focused,
  label,
  renderIcon,
  badge,
  activeColor,
  idleColor,
  labelActive,
  labelIdle,
  accessibilityLabel,
  reduceMotion,
  onPress,
  onLayout,
}: TabItemProps) {
  const motion = RECIPE_TAB_MOTION;
  const progress = useSharedValue(focused ? 1 : 0);
  /** 整项（图标+文字）统一缩放，选中时弹性放大再回落 */
  const tabScale = useSharedValue(1);
  const wasFocusedRef = useRef(focused);

  useEffect(() => {
    const wasFocused = wasFocusedRef.current;
    wasFocusedRef.current = focused;

    if (reduceMotion) {
      cancelAnimation(progress);
      cancelAnimation(tabScale);
      progress.value = focused ? 1 : 0;
      tabScale.value = 1;
      return;
    }

    progress.value = withSpring(focused ? 1 : 0, motion.settle);

    // 选中弹起由 handlePress 立即触发；此处只处理失焦回落，避免连播两次
    if (!focused && wasFocused) {
      tabScale.value = withSpring(motion.idleScale, motion.settle);
    }
  }, [focused, tabScale, motion, progress, reduceMotion]);

  const playSelectPop = () => {
    if (reduceMotion) return;
    // 点击当下就播弹起，不等导航 state 回传，避免「点了没动」
    tabScale.value = withSequence(
      withTiming(motion.selectPop, {
        duration: motion.popUpMs,
        easing: Easing.out(Easing.cubic),
      }),
      withSpring(motion.selectRest, motion.settle),
    );
  };

  const onPressIn = () => {
    if (reduceMotion) return;
    tabScale.value = withSpring(motion.pressScale, motion.settle);
  };

  const onPressOut = () => {
    if (reduceMotion) return;
    // 已选中项松开：回到静止；切换中的项由 playSelectPop / focused effect 接管，勿打断
    if (focused) {
      tabScale.value = withSpring(motion.selectRest, motion.settle);
    }
  };

  const handlePress = () => {
    if (!focused) playSelectPop();
    onPress();
  };

  const tabScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tabScale.value }],
  }));

  const outlineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0]),
  }));

  const filledStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
  }));

  const labelStyle = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: interpolate(t, [0, 1], [motion.labelIdleOpacity, motion.labelActiveOpacity]),
      color: interpolateColor(t, [0, 1], [labelIdle, labelActive]),
    };
  });

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onLayout={onLayout}
      style={styles.item}>
      <View style={styles.itemInner}>
        <View style={styles.iconBox}>
          <Animated.View style={[styles.iconGlyph, tabScaleStyle]}>
            <Animated.View style={[styles.iconLayer, outlineStyle]}>
              {renderIcon({ active: false, color: idleColor })}
            </Animated.View>
            <Animated.View style={[styles.iconLayer, filledStyle]}>
              {renderIcon({ active: true, color: activeColor })}
            </Animated.View>
          </Animated.View>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.labelBox}>
          <AnimatedText style={[styles.label, labelStyle]} numberOfLines={1}>
            {label}
          </AnimatedText>
        </View>
      </View>
    </AnimatedPressable>
  );
}

/** 列表等内容区底部预留，避免被悬浮栏挡住 */
export function recipeGlassTabBarContentInset(bottomInset: number): number {
  return RECIPE_GLASS_TAB_BAR_HEIGHT + RECIPE_GLASS_TAB_BAR_GAP + Math.max(bottomInset, 10) + 8;
}

/** 通用别名：悬浮底栏的内容区底部预留 */
export const glassTabBarContentInset = recipeGlassTabBarContentInset;

/** 悬浮栏从屏幕底边算起的总高度（供抽屉手势区等外部避让） */
export function glassTabBarFloatHeight(bottomInset: number): number {
  return RECIPE_GLASS_TAB_BAR_HEIGHT + Math.max(bottomInset, 10);
}

/** tabBarBadge → 展示文案；0 / 空串 / NaN 视为无角标 */
function normalizeTabBadge(raw: string | number | undefined): string | undefined {
  if (typeof raw === 'number') return raw > 0 ? String(raw) : undefined;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  return text ? text : undefined;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  shell: {
    width: '100%',
    maxWidth: 400,
    height: RECIPE_GLASS_TAB_BAR_HEIGHT,
    borderRadius: SHELL_RADIUS,
    // 外壳不裁剪，允许玻璃气泡向上凸起
    overflow: 'visible',
  },
  /** 玻璃背景层：单独承接整栏缩放，文字不参与 transform */
  shellBg: {
    ...StyleSheet.absoluteFill,
    borderRadius: SHELL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'visible',
    // 注意：不要在这里加 Android elevation，否则玻璃层会盖到上方文字行
    ...Platform.select({
      ios: {
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
      },
      default: {},
    }),
  },
  shellClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: SHELL_RADIUS,
    overflow: 'hidden',
  },
  innerStroke: {
    ...StyleSheet.absoluteFill,
    borderRadius: SHELL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    margin: 0.5,
  },
  specular: {
    position: 'absolute',
    top: 1,
    left: 14,
    right: 14,
    height: StyleSheet.hairlineWidth,
    borderRadius: 999,
    opacity: 0.7,
  },
  bevel: {
    position: 'absolute',
    bottom: 1,
    left: 18,
    right: 18,
    height: StyleSheet.hairlineWidth,
    borderRadius: 999,
    opacity: 0.55,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    zIndex: 2,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  itemInner: {
    minWidth: 56,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  iconBox: {
    width: ICON_BOX,
    height: ICON_BOX,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -12,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
    includeFontPadding: false,
  },
  iconGlyph: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelBox: {
    height: LABEL_BOX_H,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.12,
    fontWeight: '600',
    lineHeight: LABEL_BOX_H,
    textAlign: 'center',
    includeFontPadding: false,
  },
});
