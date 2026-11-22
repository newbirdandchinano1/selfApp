/**
 * 通用粒子数据与预设类型。
 */

export type ParticleKind = 'rain' | 'snow';

export type RainIntensity = 'light' | 'moderate' | 'heavy';

/** 景深：远景小慢淡，近景大快稍亮 */
export type ParticleDepth = 'far' | 'near';

export type AtmosphereParticle = {
  x: number;
  y: number;
  /** 视觉尺寸（雨=线宽/长度基准，雪=半径） */
  size: number;
  /** 水平固有速度（px/s），再叠加 windSpeed */
  vx: number;
  /** 垂直速度（px/s，向下为正） */
  vy: number;
  opacity: number;
  depth: ParticleDepth;
  /** 风向响应系数：近景更大 */
  windFactor: number;
  /** 雪花漂移相位 */
  phase: number;
  /** 雪花自旋（度/s 的积分用） */
  rotation: number;
  spin: number;
  /** 雨丝长度抖动（相对 streakLength） */
  streakJitter: number;
};

export type ParticlePreset = {
  kind: ParticleKind;
  count: number;
  /** 近景占比 0～1 */
  nearRatio: number;
  far: {
    size: [number, number];
    vy: [number, number];
    vx: [number, number];
    opacity: [number, number];
  };
  near: {
    size: [number, number];
    vy: [number, number];
    vx: [number, number];
    opacity: [number, number];
  };
  /** 雨丝长度相对 size 的倍数 */
  streakLength?: number;
  /** 远/近景描边宽度 */
  strokeFar?: number;
  strokeNear?: number;
  colorFar: string;
  colorNear: string;
  /** 夜间色（更暗、更冷，避免透出卡片过亮） */
  colorFarNight?: string;
  colorNearNight?: string;
};
