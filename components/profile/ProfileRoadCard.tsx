/**
 * 我的页「我的道路」摘要卡：对齐奶油松墨高定版 `renderProfile` filled / empty。
 */
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import { MotionPressable } from '@/components/ui/motion-pressable';
import { getMinTouchTarget, Motion } from '@/constants/design-tokens';
import { lifeRoadType } from '@/constants/life-road-theme';
import { useWeatherAwareLifeRoadTheme } from '@/hooks/use-weather-aware-fold-theme';
import type { ProfileRoadHub } from '@/lib/profile-hub-stats';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

export type ProfileRoadCardProps = {
  road: ProfileRoadHub | null | undefined;
  /** hub 仍在首屏加载时显示骨架 */
  loading?: boolean;
  onOpen: () => void;
  onRetry?: () => void;
  onWriteDirection?: () => void;
};

function RefreshIcon({ color }: { color: string }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 11a8 8 0 1 0-2.3 5.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M20 5v6h-6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function HorizonDecor({
  beaconAnim,
  width,
  height,
}: {
  beaconAnim: Animated.Value;
  width: number;
  height: number;
}) {
  const scale = beaconAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.18],
  });
  const opacity = beaconAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });

  // 对齐原型 viewBox 400×220 中 beacon (340, 52)
  const beaconLeft = Math.max(0, width * (340 / 400) - 7);
  const beaconTop = Math.max(0, height * (52 / 220) - 7);

  return (
    <View style={styles.horizonWrap} pointerEvents="none">
      {width > 0 && height > 0 ? (
        <Svg width={width} height={height} viewBox="0 0 400 220" preserveAspectRatio="none">
          <Path
            d="M-10 195 C 110 135, 210 165, 410 35"
            fill="none"
            stroke="#A9C7B9"
            strokeWidth={1.2}
            opacity={0.55}
          />
        </Svg>
      ) : null}
      <Animated.View
        style={[
          styles.beacon,
          {
            left: beaconLeft,
            top: beaconTop,
            opacity,
            transform: [{ scale }],
          },
        ]}>
        <View style={styles.beaconDot} />
      </Animated.View>
    </View>
  );
}

function HeroGradientBg({
  width,
  height,
  from,
  to,
}: {
  width: number;
  height: number;
  from: string;
  to: string;
}) {
  if (width <= 0 || height <= 0) return null;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width={width}
      height={height}
      preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="roadHero" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill="url(#roadHero)" />
    </Svg>
  );
}

function useBeaconBreath() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 2100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 2100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return anim;
}

/** 对齐 HTML：有总方向或任一道路节点即视为「有数据」 */
function roadHasContent(road: ProfileRoadHub): boolean {
  return (
    Boolean(road.direction?.trim()) ||
    Boolean(road.yearFocus?.trim()) ||
    (road.yearNodeCount ?? 0) > 0 ||
    (road.aboveYearCount ?? 0) > 0 ||
    (road.monthsWithContent?.length ?? 0) > 0
  );
}

export function ProfileRoadCard({
  road,
  loading = false,
  onOpen,
  onRetry,
  onWriteDirection,
}: ProfileRoadCardProps) {
  useWardrobeFonts();
  const { lr, isDark, atmosphereActive } = useWeatherAwareLifeRoadTheme();
  /** 日间氛围：米白壳 + 深色字；夜间氛围 / 无氛围有内容时仍用深绿 hero */
  const creamShell = atmosphereActive && !isDark;
  const beaconAnim = useBeaconBreath();
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) {
      setSize({ w: width, h: height });
    }
  };

  if (loading || road == null) {
    return (
      <View
        style={[
          styles.lightCard,
          { backgroundColor: lr.card, borderColor: lr.line },
        ]}
        accessibilityState={{ busy: true }}>
        <View style={styles.rcTop}>
          <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
            MY ROAD · 我的道路
          </Text>
          <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>正在同步</Text>
        </View>
        <View style={styles.skeleton}>
          <View style={[styles.skTall, { backgroundColor: lr.paper2 }]} />
          <View style={[styles.skMid, { backgroundColor: lr.paper2 }]} />
          <View style={[styles.skShort, { backgroundColor: lr.paper2 }]} />
        </View>
      </View>
    );
  }

  if (road.error) {
    return (
      <View
        style={[
          styles.lightCard,
          { backgroundColor: lr.card, borderColor: lr.line },
        ]}>
        <View style={styles.rcTop}>
          <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
            MY ROAD · 我的道路
          </Text>
          <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>本地缓存</Text>
        </View>
        <View
          style={[
            styles.errIco,
            { backgroundColor: lr.clay2, borderColor: 'rgba(191,111,82,0.2)' },
          ]}>
          <Text style={{ color: lr.clay, fontSize: 18, fontWeight: '700' }}>!</Text>
        </View>
        <Text style={[lifeRoadType.serifEmpty, { color: lr.ink }]}>
          道路暂时没有加载出来
        </Text>
        <Text style={[styles.lightCopy, { color: lr.muted }]}>
          {road.error || '网络抖动，或云端还没准备好。可先重试，或稍后再看。'}
        </Text>
        <View style={styles.errActions}>
          {onRetry ? (
            <MotionPressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="重试加载道路"
              pressScale={Motion.pressScaleButton}
              pressOpacity={Motion.pressOpacityButton}
              style={[
                styles.retryBtn,
                {
                  borderColor: lr.line2,
                  backgroundColor: lr.paper2,
                  minHeight: MIN_TOUCH,
                },
              ]}>
              <RefreshIcon color={lr.pine} />
              <Text style={[lifeRoadType.cta, { color: lr.pine }]}>重试</Text>
            </MotionPressable>
          ) : null}
        </View>
      </View>
    );
  }

  if (!roadHasContent(road)) {
    return (
      <View
        style={[
          styles.lightCard,
          { backgroundColor: lr.card, borderColor: lr.line },
        ]}>
        <View style={styles.rcTop}>
          <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>MY ROAD</Text>
          <MotionPressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel="进入道路工作台"
            pressScale={Motion.pressScaleButton}
            pressOpacity={Motion.pressOpacityButton}
            hitSlop={8}>
            <Text style={[lifeRoadType.monoTiny, { color: lr.sage }]}>进入 →</Text>
          </MotionPressable>
        </View>
        <Text style={[lifeRoadType.serifEmpty, { color: lr.ink, marginTop: 10 }]}>
          写下你的长期北极星
        </Text>
        <Text style={[styles.lightCopy, { color: lr.sage }]}>
          不急于拆分任务，先确立年、季、月的时间坐标。
        </Text>
        <MotionPressable
          onPress={onWriteDirection ?? onOpen}
          accessibilityRole="button"
          accessibilityLabel="写下总方向"
          pressScale={Motion.pressScaleButton}
          pressOpacity={Motion.pressOpacityButton}
          style={[
            styles.ctaFull,
            { backgroundColor: lr.ink, minHeight: MIN_TOUCH },
          ]}>
          <Text style={[lifeRoadType.cta, { color: lr.onRoad }]}>写下总方向</Text>
        </MotionPressable>
      </View>
    );
  }

  const kickerColor = creamShell ? lr.sage : '#E0B072';
  const linkColor = creamShell ? lr.muted : '#A9C7B9';
  const footBorder = creamShell ? lr.line : 'rgba(255,255,255,0.1)';
  const focusColor = creamShell ? lr.onRoadFocus : 'rgba(255,255,255,0.9)';

  return (
    <MotionPressable
      onPress={onOpen}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel="我的道路，打开工作台"
      pressScale={Motion.pressScaleCard}
      pressOpacity={1}
      style={[
        styles.contentCard,
        {
          backgroundColor: creamShell ? lr.card : lr.roadDeep,
          borderWidth: creamShell ? StyleSheet.hairlineWidth : 0,
          borderColor: creamShell ? lr.line : 'transparent',
        },
      ]}>
      {creamShell ? null : (
        <HeroGradientBg
          width={size.w}
          height={size.h}
          from={lr.roadDeep}
          to={lr.roadDeepMid}
        />
      )}
      <HorizonDecor beaconAnim={beaconAnim} width={size.w} height={size.h} />

      <View style={styles.rcTop}>
        <Text style={[lifeRoadType.kickerTiny, { color: kickerColor }]}>
          MY ROAD · 我的道路
        </Text>
        <Text style={{ fontSize: 11, color: linkColor }}>工作台 →</Text>
      </View>

      <Text
        style={[lifeRoadType.serifDir, styles.rcDir, { color: lr.onRoadDir }]}
        numberOfLines={3}>
        {road.direction?.trim() || '暂未写下总方向，点击开启本月工作台。'}
      </Text>

      {road.focusTag || road.yearFocus ? (
        <View style={[styles.rcFoot, { borderTopColor: footBorder }]}>
          <Text
            style={[lifeRoadType.kickerTiny, { color: kickerColor, flexShrink: 0 }]}
            numberOfLines={1}>
            {road.focusTag ?? 'FOCUS'}
          </Text>
          <Text
            style={{
              flex: 1,
              fontSize: 12,
              fontWeight: '500',
              color: focusColor,
              textAlign: 'right',
            }}
            numberOfLines={1}>
            {road.yearFocus ?? ''}
          </Text>
        </View>
      ) : null}
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  lightCard: {
    marginTop: 2,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    overflow: 'hidden',
  },
  contentCard: {
    marginTop: 2,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
    overflow: 'hidden',
    minHeight: 148,
  },
  horizonWrap: {
    ...StyleSheet.absoluteFill,
    opacity: 0.35,
  },
  beacon: {
    position: 'absolute',
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#E0B072',
  },
  rcTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    zIndex: 2,
  },
  rcDir: {
    marginTop: 14,
    zIndex: 2,
  },
  rcFoot: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    zIndex: 2,
  },
  lightCopy: {
    fontSize: 12,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 14,
    maxWidth: 300,
  },
  ctaFull: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  errIco: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 4,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  skeleton: {
    marginTop: 12,
    gap: 6,
  },
  skTall: {
    height: 24,
    borderRadius: 12,
    width: '100%',
  },
  skMid: {
    height: 8,
    borderRadius: 999,
    width: '76%',
  },
  skShort: {
    height: 8,
    borderRadius: 999,
    width: '54%',
  },
});
