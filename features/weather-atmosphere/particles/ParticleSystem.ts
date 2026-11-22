/**
 * 固定数量粒子：初始化 + 按帧推进 + 边界循环复用。
 * 函数可在 worklet 中调用（避免每帧 alloc 配置对象）。
 */
import type { AtmosphereParticle, ParticleDepth, ParticlePreset } from './ParticleTypes';

function lerp(a: number, b: number, t: number): number {
  'worklet';
  return a + (b - a) * t;
}

function rand(min: number, max: number): number {
  'worklet';
  return min + Math.random() * (max - min);
}

function pickDepth(index: number, count: number, nearRatio: number): ParticleDepth {
  'worklet';
  return index < Math.round(count * (1 - nearRatio)) ? 'far' : 'near';
}

function spawnParticle(
  preset: ParticlePreset,
  depth: ParticleDepth,
  width: number,
  height: number,
  anywhere: boolean,
): AtmosphereParticle {
  'worklet';
  const band = depth === 'far' ? preset.far : preset.near;
  const size = rand(band.size[0], band.size[1]);
  return {
    x: rand(-20, width + 20),
    y: anywhere ? rand(-30, height + 30) : rand(-80, -10),
    size,
    vx: rand(band.vx[0], band.vx[1]),
    vy: rand(band.vy[0], band.vy[1]),
    opacity: rand(band.opacity[0], band.opacity[1]),
    depth,
    windFactor: depth === 'near' ? 1 : 0.55,
    phase: rand(0, Math.PI * 2),
    rotation: rand(0, 360),
    spin: rand(-40, 40),
    streakJitter: rand(0.75, 1.28),
  };
}

export function createParticleField(
  preset: ParticlePreset,
  width: number,
  height: number,
): AtmosphereParticle[] {
  'worklet';
  const list: AtmosphereParticle[] = [];
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  for (let i = 0; i < preset.count; i++) {
    const depth = pickDepth(i, preset.count, preset.nearRatio);
    list.push(spawnParticle(preset, depth, w, h, true));
  }
  return list;
}

/**
 * 就地更新粒子并返回同一数组引用的浅拷贝触发 SharedValue 订阅。
 * windSpeed：水平附加速度（px/s），再乘各粒子 windFactor。
 */
export function stepParticleField(
  list: AtmosphereParticle[],
  preset: ParticlePreset,
  width: number,
  height: number,
  dt: number,
  windSpeed: number,
  timeSec: number,
): AtmosphereParticle[] {
  'worklet';
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const safeDt = Math.min(0.05, Math.max(0, dt));
  const wind = windSpeed;

  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    let swayX = 0;
    let swayY = 0;
    if (preset.kind === 'snow') {
      const near = p.depth === 'near';
      const amp = near ? 22 : 12;
      swayX =
        Math.sin(timeSec * 0.55 + p.phase) * amp * 0.08 +
        Math.sin(timeSec * 1.15 + p.phase * 1.7) * amp * 0.03;
      swayY = Math.sin(timeSec * 0.9 + p.phase * 0.6) * (near ? 0.35 : 0.18);
    }

    p.x += (p.vx + wind * p.windFactor + swayX) * safeDt;
    p.y += (p.vy + swayY) * safeDt;
    p.rotation += p.spin * safeDt;

    const margin = 36;
    let recycled = false;

    if (p.y > h + margin) {
      const fresh = spawnParticle(preset, p.depth, w, h, false);
      fresh.depth = p.depth;
      fresh.windFactor = p.windFactor;
      list[i] = fresh;
      recycled = true;
    } else if (p.y < -margin * 2) {
      p.y = h + margin * 0.5;
      recycled = true;
    }

    if (!recycled) {
      if (p.x < -margin) p.x = w + margin * 0.5;
      else if (p.x > w + margin) p.x = -margin * 0.5;
    }
  }

  return list.slice();
}

/** 供绘制读取雨丝终点 */
export function rainStreakEnd(
  x: number,
  y: number,
  vx: number,
  vy: number,
  size: number,
  streakLength: number,
  windSpeed: number,
  windFactor: number,
  streakJitter = 1,
): { x2: number; y2: number } {
  'worklet';
  const len = size * streakLength * streakJitter;
  const speed = Math.max(1, Math.hypot(vx + windSpeed * windFactor, vy));
  const x2 = x + ((vx + windSpeed * windFactor) / speed) * len;
  const y2 = y + (vy / speed) * len;
  return { x2, y2 };
}

export function mixRange(range: [number, number], t: number): number {
  'worklet';
  return lerp(range[0], range[1], t);
}
