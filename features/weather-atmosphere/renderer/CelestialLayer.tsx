/**
 * 天体层：太阳（实心圆 + 径向光晕）/ 月牙（dstOut 缺口 + 径向光晕）。
 * 光晕用 RadialGradient，避免大 Blur + 半径脉冲出现马赛克。
 * 呼吸只调光晕透明度，不缩放模糊半径。
 */
import type { AtmospherePeriod } from '@/features/weather-atmosphere/config/sky-palette';
import type { CelestialKind } from '@/lib/weather-atmosphere-effects';
import { Circle, Group, RadialGradient, vec } from '@shopify/react-native-skia';
import React, { memo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

export type CelestialLayerProps = {
  width: number;
  height: number;
  kind: Exclude<CelestialKind, null>;
  period: AtmospherePeriod;
  clock: SharedValue<number>;
  opacity?: SharedValue<number>;
  parallaxX?: SharedValue<number>;
  parallaxY?: SharedValue<number>;
  /** 多云时太阳略收，避免压过云层 */
  behindClouds?: boolean;
};

function CelestialLayerInner({
  width,
  height,
  kind,
  period,
  clock,
  opacity,
  parallaxX,
  parallaxY,
  behindClouds = false,
}: CelestialLayerProps) {
  const isMoon = kind === 'moon';
  const isDusk = period === 'dusk';

  const cx = useDerivedValue(() => {
    const base = width * (isMoon ? 0.78 : behindClouds ? 0.72 : 0.74);
    const drift = Math.sin(clock.value * 0.04) * width * 0.01;
    return base + drift + (parallaxX?.value ?? 0) * 20;
  });

  const cy = useDerivedValue(() => {
    const base = height * (isMoon ? 0.15 : isDusk ? 0.28 : behindClouds ? 0.15 : 0.13);
    const drift = Math.cos(clock.value * 0.035) * height * 0.006;
    return base + drift + (parallaxY?.value ?? 0) * 12;
  });

  const minSide = Math.min(width, height);

  // 光晕半径固定；呼吸只改透明度，避免 Blur/渐变重采样马赛克
  const rHalo = minSide * (isMoon ? 0.2 : behindClouds ? 0.22 : 0.26);
  const rMid = rHalo * 0.55;
  const rBridge = rHalo * 0.32;
  const rBody = useDerivedValue(() => {
    const pulse = 1 + Math.sin(clock.value * 0.5) * 0.015;
    const base = isMoon ? 0.052 : behindClouds ? 0.068 : 0.072;
    return minSide * base * pulse;
  });

  const haloCenter = useDerivedValue(() => vec(cx.value, cy.value));

  // 月牙缺口：dstOut 抠掉，不再画死黑圆（消除月牙旁黑坨）
  const craterCx = useDerivedValue(() => cx.value + rBody.value * 0.42);
  const craterCy = useDerivedValue(() => cy.value - rBody.value * 0.18);
  const craterR = useDerivedValue(() => rBody.value * 0.88);

  const rootOpacity = useDerivedValue(() => {
    const mul = behindClouds ? 0.92 : 1;
    return (opacity?.value ?? 1) * mul;
  });

  const haloBreath = useDerivedValue(() => 0.88 + Math.sin(clock.value * 0.35) * 0.12);
  const midBreath = useDerivedValue(() => 0.9 + Math.sin(clock.value * 0.4 + 0.6) * 0.1);

  // Hooks must stay unconditional — moon/sun only differ in base multipliers.
  const outerBase = isMoon ? 0.2 : isDusk ? 0.42 : 0.5;
  const midBase = isMoon ? 0.32 : 0.4;
  const bridgeBase = isMoon ? 0.4 : 0.55;

  const haloOuter = useDerivedValue(() => outerBase * haloBreath.value);
  const haloMid = useDerivedValue(() => midBase * midBreath.value);
  const bridgeOp = useDerivedValue(() => bridgeBase * midBreath.value);

  if (isMoon) {
    return (
      <Group opacity={rootOpacity}>
        <Circle cx={cx} cy={cy} r={rHalo} opacity={haloOuter}>
          <RadialGradient
            c={haloCenter}
            r={rHalo}
            colors={['rgba(196, 208, 234, 0.55)', 'rgba(196, 208, 234, 0.18)', 'rgba(196, 208, 234, 0)']}
            positions={[0, 0.45, 1]}
          />
        </Circle>
        <Circle cx={cx} cy={cy} r={rMid} opacity={haloMid}>
          <RadialGradient
            c={haloCenter}
            r={rMid}
            colors={['rgba(216, 226, 242, 0.7)', 'rgba(216, 226, 242, 0.22)', 'rgba(216, 226, 242, 0)']}
            positions={[0, 0.5, 1]}
          />
        </Circle>
        <Circle cx={cx} cy={cy} r={rBridge} opacity={bridgeOp}>
          <RadialGradient
            c={haloCenter}
            r={rBridge}
            colors={['rgba(232, 238, 248, 0.85)', 'rgba(232, 238, 248, 0.25)', 'rgba(232, 238, 248, 0)']}
            positions={[0, 0.55, 1]}
          />
        </Circle>
        {/* 月牙：本体 + dstOut 缺口，无黑色遮罩残留 */}
        <Group layer>
          <Circle cx={cx} cy={cy} r={rBody} color="#EEF2FA" opacity={0.96} />
          <Circle
            cx={craterCx}
            cy={craterCy}
            r={craterR}
            color="#000000"
            blendMode="dstOut"
          />
        </Group>
      </Group>
    );
  }

  const glow = isDusk ? '255, 154, 92' : '255, 213, 106';
  const warm = isDusk ? '255, 184, 107' : '255, 224, 138';
  const disc = isDusk ? '#FFC078' : '#FFEB9A';

  return (
    <Group opacity={rootOpacity}>
      <Circle cx={cx} cy={cy} r={rHalo} opacity={haloOuter}>
        <RadialGradient
          c={haloCenter}
          r={rHalo}
          colors={[`rgba(${glow}, 0.65)`, `rgba(${glow}, 0.22)`, `rgba(${glow}, 0)`]}
          positions={[0, 0.42, 1]}
        />
      </Circle>
      <Circle cx={cx} cy={cy} r={rMid} opacity={haloMid}>
        <RadialGradient
          c={haloCenter}
          r={rMid}
          colors={[`rgba(${glow}, 0.75)`, `rgba(${glow}, 0.25)`, `rgba(${glow}, 0)`]}
          positions={[0, 0.48, 1]}
        />
      </Circle>
      <Circle cx={cx} cy={cy} r={rBridge} opacity={bridgeOp}>
        <RadialGradient
          c={haloCenter}
          r={rBridge}
          colors={[`rgba(${warm}, 0.9)`, `rgba(${warm}, 0.3)`, `rgba(${warm}, 0)`]}
          positions={[0, 0.55, 1]}
        />
      </Circle>
      <Circle cx={cx} cy={cy} r={rBody} color={disc} opacity={0.96} />
    </Group>
  );
}

export const CelestialLayer = memo(CelestialLayerInner);
