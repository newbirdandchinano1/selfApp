/**
 * 天空渐变 + 柔光光斑色板。
 * 按时段（day / dusk / night）× 天气场景配置；
 * 时段默认跟 App 主题（light→day，dark→night），dusk 仅作显式视觉方案，不跟日出日落。
 */
import type { WeatherSceneKey } from '@/lib/weather-scene';

export type AtmospherePeriod = 'day' | 'dusk' | 'night';

/** 单个柔光光斑：归一化坐标 + 呼吸参数 */
export type SoftGlowSpotConfig = {
  /** 圆心 x，相对画布宽 0～1 */
  nx: number;
  /** 圆心 y，相对画布高 0～1 */
  ny: number;
  /** 基础半径，相对 min(宽,高) */
  radiusRatio: number;
  color: string;
  opacity: number;
  blur: number;
  /** 相位偏移（弧度），避免多光斑同相位 */
  phase: number;
  /** 角速度（rad/s），越小越慢 */
  speed: number;
  /** 水平位移振幅（相对宽） */
  ampX: number;
  /** 垂直位移振幅（相对高） */
  ampY: number;
  /** 缩放振幅（相对半径） */
  scaleAmp: number;
};

export type SkyPalette = {
  /** 垂直天空渐变，顶 → 底，≥2 色 */
  sky: readonly string[];
  spots: readonly SoftGlowSpotConfig[];
};

const clearDay: SkyPalette = {
  sky: ['#3B98DE', '#8EC8F0', '#F2E6C9'],
  spots: [
    {
      nx: 0.72,
      ny: 0.16,
      radiusRatio: 0.46,
      color: '#FFE29A',
      opacity: 0.62,
      blur: 76,
      phase: 0.2,
      speed: 0.11,
      ampX: 0.035,
      ampY: 0.02,
      scaleAmp: 0.08,
    },
    {
      nx: 0.55,
      ny: 0.26,
      radiusRatio: 0.3,
      color: '#FFC978',
      opacity: 0.36,
      blur: 56,
      phase: 1.7,
      speed: 0.08,
      ampX: 0.04,
      ampY: 0.025,
      scaleAmp: 0.1,
    },
    {
      nx: 0.22,
      ny: 0.55,
      radiusRatio: 0.34,
      color: '#B8DCF4',
      opacity: 0.22,
      blur: 64,
      phase: 2.8,
      speed: 0.06,
      ampX: 0.03,
      ampY: 0.018,
      scaleAmp: 0.07,
    },
  ],
};

const clearDusk: SkyPalette = {
  sky: ['#2A3A6E', '#C45C4A', '#F0B27A'],
  spots: [
    {
      nx: 0.78,
      ny: 0.42,
      radiusRatio: 0.38,
      color: '#FFB06B',
      opacity: 0.5,
      blur: 68,
      phase: 0.4,
      speed: 0.09,
      ampX: 0.03,
      ampY: 0.018,
      scaleAmp: 0.07,
    },
    {
      nx: 0.4,
      ny: 0.22,
      radiusRatio: 0.3,
      color: '#E889A8',
      opacity: 0.28,
      blur: 60,
      phase: 2.1,
      speed: 0.07,
      ampX: 0.045,
      ampY: 0.02,
      scaleAmp: 0.09,
    },
  ],
};

const clearNight: SkyPalette = {
  sky: ['#050B16', '#0E1A32', '#1A3050'],
  spots: [
    {
      nx: 0.78,
      ny: 0.14,
      radiusRatio: 0.2,
      color: '#E4ECFF',
      opacity: 0.34,
      blur: 40,
      phase: 0.6,
      speed: 0.05,
      ampX: 0.015,
      ampY: 0.01,
      scaleAmp: 0.05,
    },
    {
      nx: 0.28,
      ny: 0.38,
      radiusRatio: 0.38,
      color: '#2E4A78',
      opacity: 0.24,
      blur: 72,
      phase: 2.4,
      speed: 0.05,
      ampX: 0.035,
      ampY: 0.022,
      scaleAmp: 0.08,
    },
    {
      nx: 0.55,
      ny: 0.62,
      radiusRatio: 0.28,
      color: '#1A3058',
      opacity: 0.16,
      blur: 64,
      phase: 1.2,
      speed: 0.04,
      ampX: 0.025,
      ampY: 0.016,
      scaleAmp: 0.06,
    },
  ],
};

const cloudyDay: SkyPalette = {
  sky: ['#7AA7C4', '#A8C4D6', '#D5E0E8'],
  spots: [
    {
      nx: 0.35,
      ny: 0.2,
      radiusRatio: 0.4,
      color: '#F5F7FA',
      opacity: 0.34,
      blur: 64,
      phase: 0.3,
      speed: 0.07,
      ampX: 0.05,
      ampY: 0.02,
      scaleAmp: 0.09,
    },
    {
      nx: 0.75,
      ny: 0.3,
      radiusRatio: 0.32,
      color: '#E8F0F6',
      opacity: 0.26,
      blur: 58,
      phase: 1.9,
      speed: 0.09,
      ampX: 0.04,
      ampY: 0.025,
      scaleAmp: 0.08,
    },
  ],
};

const cloudyDusk: SkyPalette = {
  sky: ['#3D4A62', '#7A6B78', '#C9A992'],
  spots: [
    {
      nx: 0.68,
      ny: 0.36,
      radiusRatio: 0.34,
      color: '#E8B896',
      opacity: 0.3,
      blur: 62,
      phase: 0.5,
      speed: 0.08,
      ampX: 0.035,
      ampY: 0.02,
      scaleAmp: 0.07,
    },
  ],
};

const cloudyNight: SkyPalette = {
  sky: ['#0A1220', '#152033', '#1E2C40'],
  spots: [
    {
      nx: 0.42,
      ny: 0.24,
      radiusRatio: 0.38,
      color: '#4A6080',
      opacity: 0.2,
      blur: 72,
      phase: 1.1,
      speed: 0.05,
      ampX: 0.04,
      ampY: 0.02,
      scaleAmp: 0.07,
    },
  ],
};

const overcastDay: SkyPalette = {
  sky: ['#6B7A88', '#8A97A3', '#B0B8C0'],
  spots: [
    {
      nx: 0.5,
      ny: 0.18,
      radiusRatio: 0.45,
      color: '#C5CCD3',
      opacity: 0.28,
      blur: 70,
      phase: 0.8,
      speed: 0.06,
      ampX: 0.03,
      ampY: 0.015,
      scaleAmp: 0.06,
    },
  ],
};

const overcastDusk: SkyPalette = {
  sky: ['#3A424C', '#5A616A', '#7E858E'],
  spots: [
    {
      nx: 0.55,
      ny: 0.28,
      radiusRatio: 0.4,
      color: '#9AA3AC',
      opacity: 0.22,
      blur: 66,
      phase: 1.2,
      speed: 0.055,
      ampX: 0.028,
      ampY: 0.016,
      scaleAmp: 0.06,
    },
  ],
};

const overcastNight: SkyPalette = {
  sky: ['#0C1016', '#161C24', '#222830'],
  spots: [
    {
      nx: 0.48,
      ny: 0.22,
      radiusRatio: 0.4,
      color: '#3A4552',
      opacity: 0.18,
      blur: 68,
      phase: 1.5,
      speed: 0.045,
      ampX: 0.025,
      ampY: 0.014,
      scaleAmp: 0.05,
    },
  ],
};

const rainDay: SkyPalette = {
  sky: ['#5A738A', '#6F8699', '#8FA0AE'],
  spots: [
    {
      nx: 0.3,
      ny: 0.25,
      radiusRatio: 0.36,
      color: '#A8B8C6',
      opacity: 0.24,
      blur: 64,
      phase: 0.7,
      speed: 0.07,
      ampX: 0.04,
      ampY: 0.02,
      scaleAmp: 0.07,
    },
    {
      nx: 0.8,
      ny: 0.4,
      radiusRatio: 0.3,
      color: '#7E95A8',
      opacity: 0.2,
      blur: 58,
      phase: 2.2,
      speed: 0.085,
      ampX: 0.045,
      ampY: 0.022,
      scaleAmp: 0.08,
    },
  ],
};

const rainDusk: SkyPalette = {
  sky: ['#2E3A4A', '#455566', '#5C6B7A'],
  spots: [
    {
      nx: 0.62,
      ny: 0.3,
      radiusRatio: 0.34,
      color: '#6E8092',
      opacity: 0.22,
      blur: 60,
      phase: 0.9,
      speed: 0.065,
      ampX: 0.035,
      ampY: 0.018,
      scaleAmp: 0.07,
    },
  ],
};

const rainNight: SkyPalette = {
  sky: ['#081018', '#101A28', '#182636'],
  spots: [
    {
      nx: 0.4,
      ny: 0.28,
      radiusRatio: 0.38,
      color: '#2A4058',
      opacity: 0.2,
      blur: 70,
      phase: 1.3,
      speed: 0.05,
      ampX: 0.03,
      ampY: 0.018,
      scaleAmp: 0.06,
    },
  ],
};

const snowDay: SkyPalette = {
  sky: ['#9BB4C8', '#C5D5E2', '#E8EEF4'],
  spots: [
    {
      nx: 0.65,
      ny: 0.2,
      radiusRatio: 0.34,
      color: '#FFFFFF',
      opacity: 0.4,
      blur: 60,
      phase: 0.4,
      speed: 0.07,
      ampX: 0.035,
      ampY: 0.02,
      scaleAmp: 0.08,
    },
  ],
};

const snowDusk: SkyPalette = {
  sky: ['#4A5568', '#7A8494', '#B8C0CC'],
  spots: [
    {
      nx: 0.7,
      ny: 0.34,
      radiusRatio: 0.32,
      color: '#E4D2C0',
      opacity: 0.28,
      blur: 58,
      phase: 1.0,
      speed: 0.06,
      ampX: 0.03,
      ampY: 0.016,
      scaleAmp: 0.07,
    },
  ],
};

const snowNight: SkyPalette = {
  sky: ['#0C1420', '#182430', '#2A3848'],
  spots: [
    {
      nx: 0.55,
      ny: 0.18,
      radiusRatio: 0.28,
      color: '#C8D8EC',
      opacity: 0.22,
      blur: 52,
      phase: 0.5,
      speed: 0.055,
      ampX: 0.025,
      ampY: 0.015,
      scaleAmp: 0.06,
    },
  ],
};

const fogDay: SkyPalette = {
  sky: ['#A8B2BC', '#C2CAD2', '#DCE1E6'],
  spots: [
    {
      nx: 0.4,
      ny: 0.35,
      radiusRatio: 0.48,
      color: '#EEF1F4',
      opacity: 0.42,
      blur: 80,
      phase: 0.2,
      speed: 0.05,
      ampX: 0.05,
      ampY: 0.02,
      scaleAmp: 0.1,
    },
    {
      nx: 0.75,
      ny: 0.5,
      radiusRatio: 0.4,
      color: '#D8DEE4',
      opacity: 0.35,
      blur: 74,
      phase: 2.0,
      speed: 0.06,
      ampX: 0.045,
      ampY: 0.022,
      scaleAmp: 0.09,
    },
  ],
};

const fogDusk: SkyPalette = {
  sky: ['#6A7078', '#8A9098', '#B0B4BA'],
  spots: [
    {
      nx: 0.5,
      ny: 0.4,
      radiusRatio: 0.46,
      color: '#C8CCD0',
      opacity: 0.36,
      blur: 78,
      phase: 0.8,
      speed: 0.05,
      ampX: 0.04,
      ampY: 0.02,
      scaleAmp: 0.09,
    },
  ],
};

const fogNight: SkyPalette = {
  sky: ['#12161C', '#1C222A', '#2A3038'],
  spots: [
    {
      nx: 0.45,
      ny: 0.38,
      radiusRatio: 0.44,
      color: '#3A424C',
      opacity: 0.3,
      blur: 76,
      phase: 1.4,
      speed: 0.045,
      ampX: 0.035,
      ampY: 0.018,
      scaleAmp: 0.08,
    },
  ],
};

const PALETTES: Record<WeatherSceneKey, Record<AtmospherePeriod, SkyPalette>> = {
  clear: { day: clearDay, dusk: clearDusk, night: clearNight },
  cloudy: { day: cloudyDay, dusk: cloudyDusk, night: cloudyNight },
  overcast: { day: overcastDay, dusk: overcastDusk, night: overcastNight },
  rain: { day: rainDay, dusk: rainDusk, night: rainNight },
  snow: { day: snowDay, dusk: snowDusk, night: snowNight },
  fog: { day: fogDay, dusk: fogDusk, night: fogNight },
};

export function resolveAtmospherePeriod(
  scheme: 'light' | 'dark',
  override?: AtmospherePeriod | null,
): AtmospherePeriod {
  if (override === 'day' || override === 'dusk' || override === 'night') return override;
  return scheme === 'dark' ? 'night' : 'day';
}

export function getSkyPalette(
  scene: WeatherSceneKey = 'cloudy',
  period: AtmospherePeriod = 'day',
): SkyPalette {
  return PALETTES[scene]?.[period] ?? PALETTES.cloudy.day;
}
