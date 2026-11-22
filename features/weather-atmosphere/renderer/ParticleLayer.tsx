/**
 * 雨丝 / 雪花。
 * - 路径按 ~30fps 量化时钟重建，减轻每帧 Path 开销
 * - 雪去掉 Blur / 外晕双路径（GPU 重采样是卡顿主因）
 */
import type { AtmospherePeriod } from '@/features/weather-atmosphere/config/sky-palette';
import {
  particlePositionAt,
  type ParticleFieldHandle,
} from '@/features/weather-atmosphere/hooks/useParticleField';
import { rainStreakEnd } from '@/features/weather-atmosphere/particles/ParticleSystem';
import { Group, Path, usePathValue } from '@shopify/react-native-skia';
import React, { memo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

/** 粒子路径刷新约 30fps，观感足够且明显减负 */
const PARTICLE_FPS = 30;

export type ParticleLayerProps = {
  field: ParticleFieldHandle;
  width: number;
  height: number;
  clock: SharedValue<number>;
  period?: AtmospherePeriod;
  opacity?: SharedValue<number>;
  parallaxX?: SharedValue<number>;
  parallaxY?: SharedValue<number>;
};

function ParticleLayerInner({
  field,
  width,
  height,
  clock,
  period = 'day',
  opacity,
  parallaxX,
  parallaxY,
}: ParticleLayerProps) {
  const { seeds, kind, preset, windSpeed, hasParticles, strokeFar, strokeNear } = field;
  const isNight = period === 'night';

  const tick = useDerivedValue(() => Math.floor(clock.value * PARTICLE_FPS) / PARTICLE_FPS);

  const farPath = usePathValue(builder => {
    'worklet';
    const k = kind.value;
    const pset = preset.value;
    const list = seeds.value;
    if (!k || !pset || list.length === 0) return;

    const t = tick.value;
    const wind = windSpeed.value;
    const streak = pset.streakLength ?? 16;
    const ox = parallaxX ? parallaxX.value * 10 : 0;
    const oy = parallaxY ? parallaxY.value * 6 : 0;

    for (let i = 0; i < list.length; i++) {
      const seed = list[i]!;
      if (seed.depth !== 'far') continue;
      const pos = particlePositionAt(seed, width, height, t, wind, k);
      const x = pos.x + ox * 0.55;
      const y = pos.y + oy * 0.55;
      if (k === 'rain') {
        const end = rainStreakEnd(
          x,
          y,
          seed.vx,
          seed.vy,
          seed.size,
          streak,
          wind,
          seed.windFactor,
          seed.streakJitter,
        );
        builder.moveTo(x, y);
        builder.lineTo(end.x2, end.y2);
      } else {
        // 雪：略大一圈半透明核，代替外晕 Blur
        builder.addCircle(x, y, seed.size * 1.15);
      }
    }
  });

  const nearPath = usePathValue(builder => {
    'worklet';
    const k = kind.value;
    const pset = preset.value;
    const list = seeds.value;
    if (!k || !pset || list.length === 0) return;

    const t = tick.value;
    const wind = windSpeed.value;
    const streak = pset.streakLength ?? 16;
    const ox = parallaxX ? parallaxX.value * 16 : 0;
    const oy = parallaxY ? parallaxY.value * 10 : 0;

    for (let i = 0; i < list.length; i++) {
      const seed = list[i]!;
      if (seed.depth !== 'near') continue;
      const pos = particlePositionAt(seed, width, height, t, wind, k);
      const x = pos.x + ox;
      const y = pos.y + oy;
      if (k === 'rain') {
        const end = rainStreakEnd(
          x,
          y,
          seed.vx,
          seed.vy,
          seed.size,
          streak,
          wind,
          seed.windFactor,
          seed.streakJitter,
        );
        builder.moveTo(x, y);
        builder.lineTo(end.x2, end.y2);
      } else {
        builder.addCircle(x, y, seed.size * 1.1);
      }
    }
  });

  const farColor = useDerivedValue(() => {
    const p = preset.value;
    if (!p) return 'rgba(255,255,255,0.35)';
    if (isNight && p.colorFarNight) return p.colorFarNight;
    return p.colorFar;
  });
  const nearColor = useDerivedValue(() => {
    const p = preset.value;
    if (!p) return 'rgba(255,255,255,0.7)';
    if (isNight && p.colorNearNight) return p.colorNearNight;
    return p.colorNear;
  });
  const rainOpacity = useDerivedValue(() => (kind.value === 'rain' ? 1 : 0));
  const snowOpacity = useDerivedValue(() => (kind.value === 'snow' ? 1 : 0));
  const rootOpacity = useDerivedValue(() => opacity?.value ?? 1);

  if (!hasParticles) return null;

  return (
    <Group opacity={rootOpacity}>
      <Group opacity={rainOpacity}>
        <Path
          path={farPath}
          style="stroke"
          strokeWidth={strokeFar}
          strokeCap="round"
          color={farColor}
        />
        <Path
          path={nearPath}
          style="stroke"
          strokeWidth={strokeNear}
          strokeCap="round"
          color={nearColor}
        />
      </Group>
      <Group opacity={snowOpacity}>
        <Path path={farPath} style="fill" color={farColor} />
        <Path path={nearPath} style="fill" color={nearColor} />
      </Group>
    </Group>
  );
}

export const ParticleLayer = memo(ParticleLayerInner);
