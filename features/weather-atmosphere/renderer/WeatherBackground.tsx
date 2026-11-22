/**
 * 天气氛围全屏容器。
 * 层序：天空/星/日月 → 摄影云雾 → 雨雪/闪电/遮罩 → 业务 UI。
 * 云雾用实拍动图，避免椭圆手绘质感。
 */
import {
  resolveAtmospherePeriod,
  type AtmospherePeriod,
} from '@/features/weather-atmosphere/config/sky-palette';
import { useAnimatedSkyTransition } from '@/features/weather-atmosphere/hooks/useAnimatedSkyTransition';
import { useBreathingClock } from '@/features/weather-atmosphere/hooks/useBreathingClock';
import { useGyroParallax } from '@/features/weather-atmosphere/hooks/useGyroParallax';
import { useParticleField } from '@/features/weather-atmosphere/hooks/useParticleField';
import type { ParticleKind } from '@/features/weather-atmosphere/particles/ParticleTypes';
import type {
  CelestialKind,
  RainIntensity,
} from '@/lib/weather-atmosphere-effects';
import { CelestialLayer } from '@/features/weather-atmosphere/renderer/CelestialLayer';
import { LightningLayer } from '@/features/weather-atmosphere/renderer/LightningLayer';
import { ParticleLayer } from '@/features/weather-atmosphere/renderer/ParticleLayer';
import {
  PhotoMistOverlay,
  type CloudDensity,
} from '@/features/weather-atmosphere/renderer/PhotoMistOverlay';
import { SkyBreathingLayer } from '@/features/weather-atmosphere/renderer/SkyBreathingLayer';
import { StarFieldLayer } from '@/features/weather-atmosphere/renderer/StarFieldLayer';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import type { WeatherSceneKey } from '@/lib/weather-scene';
import { BlurView } from 'expo-blur';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import React, { memo, useMemo } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function particleKindForScene(scene: WeatherSceneKey): ParticleKind | null {
  if (scene === 'rain') return 'rain';
  if (scene === 'snow') return 'snow';
  return null;
}

export type WeatherBackgroundProps = {
  children?: React.ReactNode;
  scene?: WeatherSceneKey;
  period?: AtmospherePeriod;
  isDark?: boolean;
  windSpeed?: number;
  particlesEnabled?: boolean;
  gyroParallax?: boolean;
  rainIntensity?: RainIntensity | null;
  thunderstorm?: boolean;
  celestial?: CelestialKind;
  showStars?: boolean;
  mistKind?: 'cloud' | 'fog' | null;
  readabilityMask?: boolean | { heightRatio?: number };
  style?: StyleProp<ViewStyle>;
  debugShowSize?: boolean;
};

function WeatherBackgroundInner({
  children,
  scene = 'cloudy',
  period: periodProp,
  isDark = false,
  windSpeed = 0,
  particlesEnabled = true,
  gyroParallax = true,
  rainIntensity = null,
  thunderstorm = false,
  celestial = null,
  showStars = false,
  mistKind = null,
  readabilityMask = true,
  style,
  debugShowSize = __DEV__,
}: WeatherBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const clock = useBreathingClock();
  const { enabled: reduceMotion } = useReducedMotionState();

  const scheme = isDark ? 'dark' : 'light';
  const period = resolveAtmospherePeriod(scheme, periodProp);

  const transition = useAnimatedSkyTransition(scene, period, reduceMotion);

  // 雨 / 雪 / 雷暴：重特效档，关掉陀螺仪与天空光斑等次要开销
  const heavyFx =
    particlesEnabled && (scene === 'rain' || scene === 'snow' || thunderstorm);
  const gyro = useGyroParallax(gyroParallax && !heavyFx);

  const particleKind = particleKindForScene(transition.particleScene);
  const activeRainIntensity = rainIntensity ?? 'moderate';
  const particleField = useParticleField({
    kind: particleKind,
    rainIntensity: activeRainIntensity,
    width,
    height,
    windSpeed,
    enabled: particlesEnabled,
  });

  const maskEnabled = readabilityMask !== false;
  const heightRatio =
    typeof readabilityMask === 'object' && readabilityMask.heightRatio != null
      ? Math.min(0.55, Math.max(0.12, readabilityMask.heightRatio))
      : 0.28;

  const maskHeight = Math.round(insets.top + height * heightRatio);
  const blurTint = period === 'night' ? 'dark' : 'light';
  const washColors =
    period === 'night'
      ? ['rgba(8, 14, 24, 0.55)', 'rgba(8, 14, 24, 0.28)', 'rgba(8, 14, 24, 0)']
      : ['rgba(255, 255, 255, 0.52)', 'rgba(255, 255, 255, 0.26)', 'rgba(255, 255, 255, 0)'];

  const canvasW = Math.max(1, width);
  const canvasH = Math.max(1, height);

  // 摄影云雾：减弱动效时仍显示静帧（比手绘椭圆真实）
  const showMist = mistKind != null;
  const showCelestialLayer = celestial != null && !reduceMotion;
  const showStarField = showStars && period === 'night' && !reduceMotion && !heavyFx;
  const showLightning = thunderstorm && particlesEnabled && !reduceMotion;
  const starDensity = scene === 'clear' ? 'clear' : 'cloudy';
  // 重特效时跳过顶部 BlurView（Android 很贵），只留渐变洗白
  const showReadabilityBlur = maskEnabled && !heavyFx;

  const cloudDensity: CloudDensity = useMemo(() => {
    if (scene === 'cloudy') return 'partly';
    if (scene === 'rain' || thunderstorm) return 'storm';
    return 'overcast';
  }, [scene, thunderstorm]);

  const contentVeilColors = useMemo(() => {
    const raining = particleKind === 'rain' || thunderstorm;
    if (period === 'night') {
      if (raining) {
        return ['rgba(6, 10, 18, 0.42)', 'rgba(6, 10, 18, 0.5)', 'rgba(6, 10, 18, 0.58)'];
      }
      return ['rgba(6, 10, 18, 0.18)', 'rgba(6, 10, 18, 0.22)', 'rgba(6, 10, 18, 0.28)'];
    }
    if (raining) {
      return ['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.14)', 'rgba(255, 255, 255, 0.18)'];
    }
    return null;
  }, [period, particleKind, thunderstorm]);

  const fxOpacity = useDerivedValue(() => transition.particleOpacity.value);

  const debugLabel = [
    scene,
    period,
    particleKind ?? '',
    particleKind === 'rain' ? activeRainIntensity : '',
    thunderstorm ? '⚡' : '',
    mistKind ? `photo:${mistKind}` : '',
    celestial ?? '',
    showStarField ? '★' : '',
  ]
    .filter(Boolean)
    .join('/');

  const showFxCanvas =
    !!particleKind || showLightning || !!contentVeilColors || maskEnabled;

  return (
    <View style={[styles.root, style]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
        {/* 底层：天空 / 星 / 日月 */}
        <Canvas style={{ width: canvasW, height: canvasH }}>
          <SkyBreathingLayer
            width={canvasW}
            height={canvasH}
            clock={clock}
            skyColors={transition.skyColors}
            fromSpots={transition.fromSpots}
            toSpots={transition.toSpots}
            fromSpotOpacity={transition.fromSpotOpacity}
            toSpotOpacity={transition.toSpotOpacity}
            parallaxX={gyro.x}
            parallaxY={gyro.y}
            spotsEnabled={!heavyFx}
          />

          {showStarField ? (
            <StarFieldLayer
              width={canvasW}
              height={canvasH}
              clock={clock}
              opacity={fxOpacity}
              density={starDensity}
            />
          ) : null}

          {showCelestialLayer && celestial ? (
            <CelestialLayer
              width={canvasW}
              height={canvasH}
              kind={celestial}
              period={period}
              clock={clock}
              opacity={fxOpacity}
              parallaxX={gyro.x}
              parallaxY={gyro.y}
              behindClouds={celestial === 'sun' && mistKind === 'cloud'}
            />
          ) : null}
        </Canvas>

        {/* 中层：实拍云/雾（盖在日月上，透出天空） */}
        {showMist && mistKind ? (
          <PhotoMistOverlay
            mistKind={mistKind}
            cloudDensity={mistKind === 'cloud' ? cloudDensity : undefined}
            period={period}
            opacity={fxOpacity}
            reduceMotion={reduceMotion}
            preferStatic={heavyFx}
          />
        ) : null}

        {/* 上层：雨雪 / 闪电 / 可读性遮罩（透明底） */}
        {showFxCanvas ? (
          <Canvas style={[StyleSheet.absoluteFill, { width: canvasW, height: canvasH }]}>
            {particleKind ? (
              <ParticleLayer
                field={particleField}
                width={canvasW}
                height={canvasH}
                clock={clock}
                period={period}
                opacity={transition.particleOpacity}
                parallaxX={gyro.x}
                parallaxY={gyro.y}
              />
            ) : null}

            {showLightning ? (
              <LightningLayer
                width={canvasW}
                height={canvasH}
                enabled
                opacity={transition.particleOpacity}
              />
            ) : null}

            {contentVeilColors ? (
              <Rect x={0} y={0} width={canvasW} height={canvasH}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, canvasH)}
                  colors={contentVeilColors}
                />
              </Rect>
            ) : null}

            {maskEnabled ? (
              <Rect x={0} y={0} width={canvasW} height={maskHeight}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, maskHeight)}
                  colors={washColors}
                />
              </Rect>
            ) : null}
          </Canvas>
        ) : null}

        {showReadabilityBlur ? (
          <View style={[styles.readabilityBand, { height: Math.round(maskHeight * 0.72) }]}>
            <BlurView
              intensity={period === 'night' ? 22 : 30}
              tint={blurTint}
              blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.content}>{children}</View>

      {debugShowSize ? (
        <View pointerEvents="none" style={[styles.debugBadge, { top: insets.top + 6 }]}>
          <Text style={styles.debugText}>
            {Math.round(width)}×{Math.round(height)} · {debugLabel}
            {gyro.active ? ' · gyro' : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export const WeatherBackground = memo(WeatherBackgroundInner);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
  readabilityBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  debugBadge: {
    position: 'absolute',
    right: 10,
    zIndex: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  debugText: {
    color: '#fff',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
