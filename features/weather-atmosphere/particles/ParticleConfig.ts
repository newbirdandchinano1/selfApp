/**
 * 雨（小/中/暴）与雪预设。
 * 数量按观感够用、帧率优先下调；密感靠丝更长/稍粗补偿。
 */
import type { ParticleKind, ParticlePreset, RainIntensity } from './ParticleTypes';

/** 小雨 */
export const RAIN_LIGHT_PRESET: ParticlePreset = {
  kind: 'rain',
  count: 42,
  nearRatio: 0.32,
  far: {
    size: [0.55, 0.95],
    vy: [220, 320],
    vx: [-18, 6],
    opacity: [0.08, 0.16],
  },
  near: {
    size: [0.9, 1.35],
    vy: [340, 460],
    vx: [-28, 10],
    opacity: [0.18, 0.32],
  },
  streakLength: 15,
  strokeFar: 0.75,
  strokeNear: 1.1,
  colorFar: 'rgba(186, 204, 220, 0.55)',
  colorNear: 'rgba(214, 228, 240, 0.72)',
  colorFarNight: 'rgba(120, 148, 176, 0.28)',
  colorNearNight: 'rgba(160, 186, 210, 0.38)',
};

/** 中雨 */
export const RAIN_MODERATE_PRESET: ParticlePreset = {
  kind: 'rain',
  count: 64,
  nearRatio: 0.36,
  far: {
    size: [0.65, 1.1],
    vy: [320, 440],
    vx: [-28, 8],
    opacity: [0.1, 0.2],
  },
  near: {
    size: [1.05, 1.55],
    vy: [480, 640],
    vx: [-40, 12],
    opacity: [0.22, 0.4],
  },
  streakLength: 19,
  strokeFar: 0.9,
  strokeNear: 1.3,
  colorFar: 'rgba(176, 196, 214, 0.6)',
  colorNear: 'rgba(220, 232, 242, 0.78)',
  colorFarNight: 'rgba(110, 138, 168, 0.3)',
  colorNearNight: 'rgba(150, 178, 204, 0.42)',
};

/** 暴雨 / 雷暴：数量封顶，靠更长丝补偿密度感 */
export const RAIN_HEAVY_PRESET: ParticlePreset = {
  kind: 'rain',
  count: 88,
  nearRatio: 0.4,
  far: {
    size: [0.75, 1.25],
    vy: [420, 580],
    vx: [-42, 10],
    opacity: [0.12, 0.24],
  },
  near: {
    size: [1.2, 1.85],
    vy: [620, 820],
    vx: [-55, 14],
    opacity: [0.28, 0.48],
  },
  streakLength: 26,
  strokeFar: 1.05,
  strokeNear: 1.5,
  colorFar: 'rgba(168, 188, 208, 0.65)',
  colorNear: 'rgba(228, 238, 248, 0.85)',
  colorFarNight: 'rgba(100, 128, 158, 0.34)',
  colorNearNight: 'rgba(148, 176, 204, 0.48)',
};

/** 飘雪：少而软，无 Blur 路径（Blur 是卡顿主因） */
export const SNOW_PRESET: ParticlePreset = {
  kind: 'snow',
  count: 36,
  nearRatio: 0.3,
  far: {
    size: [0.9, 1.8],
    vy: [16, 32],
    vx: [-6, 6],
    opacity: [0.14, 0.28],
  },
  near: {
    size: [2.0, 3.6],
    vy: [36, 58],
    vx: [-12, 12],
    opacity: [0.3, 0.5],
  },
  colorFar: 'rgba(248, 252, 255, 0.5)',
  colorNear: 'rgba(255, 255, 255, 0.72)',
  colorFarNight: 'rgba(210, 222, 238, 0.36)',
  colorNearNight: 'rgba(228, 238, 252, 0.52)',
};

export function getParticlePreset(
  kind: ParticleKind,
  rainIntensity: RainIntensity = 'moderate',
): ParticlePreset {
  if (kind === 'snow') return SNOW_PRESET;
  if (rainIntensity === 'light') return RAIN_LIGHT_PRESET;
  if (rainIntensity === 'heavy') return RAIN_HEAVY_PRESET;
  return RAIN_MODERATE_PRESET;
}
