/**
 * 第一层：天空垂直渐变 + 柔光光斑。
 * 支持切换插值色、光斑交叠透明度、陀螺仪视差。
 */
import type { SoftGlowSpotConfig } from '@/features/weather-atmosphere/config/sky-palette';
import {
  Blur,
  Circle,
  Fill,
  Group,
  LinearGradient,
  vec,
} from '@shopify/react-native-skia';
import React, { memo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

type SpotProps = {
  spot: SoftGlowSpotConfig;
  width: number;
  height: number;
  clock: SharedValue<number>;
  opacityMul: SharedValue<number>;
  parallaxX: SharedValue<number>;
  parallaxY: SharedValue<number>;
  /** 近景视差更大 */
  parallaxDepth: number;
};

function SoftGlowSpot({
  spot,
  width,
  height,
  clock,
  opacityMul,
  parallaxX,
  parallaxY,
  parallaxDepth,
}: SpotProps) {
  const minSide = Math.min(width, height);
  const baseR = spot.radiusRatio * minSide;

  const cx = useDerivedValue(() => {
    const t = clock.value * spot.speed + spot.phase;
    const breathe = width * spot.nx + Math.sin(t) * width * spot.ampX;
    return breathe + parallaxX.value * 28 * parallaxDepth;
  });

  const cy = useDerivedValue(() => {
    const t = clock.value * spot.speed + spot.phase;
    const breathe = height * spot.ny + Math.cos(t * 0.85) * height * spot.ampY;
    return breathe + parallaxY.value * 18 * parallaxDepth;
  });

  const r = useDerivedValue(() => {
    const t = clock.value * spot.speed + spot.phase;
    return baseR * (1 + Math.sin(t * 0.7) * spot.scaleAmp);
  });

  const opacity = useDerivedValue(() => {
    const t = clock.value * spot.speed + spot.phase;
    const pulse = spot.opacity * (0.88 + 0.12 * Math.sin(t * 0.55));
    return pulse * opacityMul.value;
  });

  return (
    <Circle cx={cx} cy={cy} r={r} color={spot.color} opacity={opacity}>
      <Blur blur={spot.blur} mode="clamp" />
    </Circle>
  );
}

function SpotGroup({
  spots,
  width,
  height,
  clock,
  opacityMul,
  parallaxX,
  parallaxY,
  keyPrefix,
}: {
  spots: readonly SoftGlowSpotConfig[];
  width: number;
  height: number;
  clock: SharedValue<number>;
  opacityMul: SharedValue<number>;
  parallaxX: SharedValue<number>;
  parallaxY: SharedValue<number>;
  keyPrefix: string;
}) {
  return (
    <Group>
      {spots.map((spot, i) => (
        <SoftGlowSpot
          key={`${keyPrefix}-${spot.color}-${i}`}
          spot={spot}
          width={width}
          height={height}
          clock={clock}
          opacityMul={opacityMul}
          parallaxX={parallaxX}
          parallaxY={parallaxY}
          parallaxDepth={0.55 + (i % 3) * 0.25}
        />
      ))}
    </Group>
  );
}

export type SkyBreathingLayerProps = {
  width: number;
  height: number;
  clock: SharedValue<number>;
  /** 插值后的天空渐变色（通常 3 色） */
  skyColors: SharedValue<string[]>;
  fromSpots: readonly SoftGlowSpotConfig[];
  toSpots: readonly SoftGlowSpotConfig[];
  fromSpotOpacity: SharedValue<number>;
  toSpotOpacity: SharedValue<number>;
  parallaxX: SharedValue<number>;
  parallaxY: SharedValue<number>;
  /**
   * 雨雪雷等重特效时关闭光斑 Blur，只保留天空渐变，显著降 GPU。
   * 默认 true。
   */
  spotsEnabled?: boolean;
};

function SkyBreathingLayerInner({
  width,
  height,
  clock,
  skyColors,
  fromSpots,
  toSpots,
  fromSpotOpacity,
  toSpotOpacity,
  parallaxX,
  parallaxY,
  spotsEnabled = true,
}: SkyBreathingLayerProps) {
  const gradientColors = useDerivedValue(() => {
    const c = skyColors.value;
    if (c.length >= 2) return c;
    return ['#6EB6E8', '#EAF4FC'];
  });

  return (
    <Group>
      <Fill>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height)}
          colors={gradientColors}
        />
      </Fill>
      {spotsEnabled ? (
        <>
          <SpotGroup
            keyPrefix="from"
            spots={fromSpots}
            width={width}
            height={height}
            clock={clock}
            opacityMul={fromSpotOpacity}
            parallaxX={parallaxX}
            parallaxY={parallaxY}
          />
          <SpotGroup
            keyPrefix="to"
            spots={toSpots}
            width={width}
            height={height}
            clock={clock}
            opacityMul={toSpotOpacity}
            parallaxX={parallaxX}
            parallaxY={parallaxY}
          />
        </>
      ) : null}
    </Group>
  );
}

export const SkyBreathingLayer = memo(SkyBreathingLayerInner);
