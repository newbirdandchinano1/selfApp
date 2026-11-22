/**
 * 固定粒子场：JS 生成种子写入 SharedValue；绘制侧只读 clock 推导坐标。
 */
import { getParticlePreset } from '@/features/weather-atmosphere/particles/ParticleConfig';
import type {
  ParticleDepth,
  ParticleKind,
  ParticlePreset,
  RainIntensity,
} from '@/features/weather-atmosphere/particles/ParticleTypes';
import { useEffect, useMemo } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

export type ParticleSeed = {
  depth: ParticleDepth;
  size: number;
  vx: number;
  vy: number;
  opacity: number;
  windFactor: number;
  phase: number;
  streakJitter: number;
  x0: number;
  y0: number;
};

export type ParticleFieldHandle = {
  seeds: SharedValue<ParticleSeed[]>;
  kind: SharedValue<ParticleKind | null>;
  preset: SharedValue<ParticlePreset | null>;
  windSpeed: SharedValue<number>;
  strokeFar: number;
  strokeNear: number;
  /** 供调试：当前是否有粒子 */
  hasParticles: boolean;
};

export type UseParticleFieldParams = {
  kind: ParticleKind | null;
  rainIntensity?: RainIntensity;
  width: number;
  height: number;
  windSpeed?: number;
  enabled?: boolean;
};

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createSeeds(preset: ParticlePreset): ParticleSeed[] {
  const seeds: ParticleSeed[] = [];
  const nearStart = Math.round(preset.count * (1 - preset.nearRatio));
  for (let i = 0; i < preset.count; i++) {
    const depth: ParticleDepth = i < nearStart ? 'far' : 'near';
    const band = depth === 'far' ? preset.far : preset.near;
    seeds.push({
      depth,
      size: rand(band.size[0], band.size[1]),
      vx: rand(band.vx[0], band.vx[1]),
      vy: rand(band.vy[0], band.vy[1]),
      opacity: rand(band.opacity[0], band.opacity[1]),
      windFactor: depth === 'near' ? 1 : 0.55,
      phase: rand(0, Math.PI * 2),
      streakJitter: rand(0.75, 1.28),
      x0: Math.random(),
      y0: Math.random(),
    });
  }
  return seeds;
}

export function useParticleField({
  kind,
  rainIntensity = 'moderate',
  width: _width,
  height: _height,
  windSpeed = 0,
  enabled = true,
}: UseParticleFieldParams): ParticleFieldHandle {
  const seedsSV = useSharedValue<ParticleSeed[]>([]);
  const kindSV = useSharedValue<ParticleKind | null>(null);
  const presetSV = useSharedValue<ParticlePreset | null>(null);
  const windSV = useSharedValue(windSpeed);

  const activeKind = enabled ? kind : null;
  const preset = useMemo(
    () => (activeKind ? getParticlePreset(activeKind, rainIntensity) : null),
    [activeKind, rainIntensity],
  );

  useEffect(() => {
    windSV.value = windSpeed;
    kindSV.value = activeKind;
    presetSV.value = preset;
    seedsSV.value = preset ? createSeeds(preset) : [];
  }, [activeKind, preset, windSpeed, windSV, kindSV, presetSV, seedsSV]);

  return {
    seeds: seedsSV,
    kind: kindSV,
    preset: presetSV,
    windSpeed: windSV,
    strokeFar: preset?.strokeFar ?? 0.85,
    strokeNear: preset?.strokeNear ?? 1.25,
    hasParticles: !!preset,
  };
}

/** 由 clock 推导粒子当前坐标（worklet 内调用） */
export function particlePositionAt(
  seed: ParticleSeed,
  width: number,
  height: number,
  timeSec: number,
  windSpeed: number,
  kind: ParticleKind,
): { x: number; y: number } {
  'worklet';
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const margin = 40;
  const spanY = h + margin * 2;
  const spanX = w + margin * 2;

  // 雪：单频横飘（双频 sin 对每粒子每帧偏贵）
  let swayX = 0;
  if (kind === 'snow') {
    const amp = seed.depth === 'near' ? 20 : 11;
    swayX = Math.sin(timeSec * 0.6 + seed.phase) * amp;
  }

  const yRaw = seed.y0 * h + seed.vy * timeSec;
  const y = ((yRaw % spanY) + spanY) % spanY - margin;

  const xRaw =
    seed.x0 * w + (seed.vx + windSpeed * seed.windFactor) * timeSec + swayX;
  const x = ((xRaw % spanX) + spanX) % spanX - margin;

  return { x, y };
}
