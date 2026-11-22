/**
 * 天气切换过渡时长与策略（对齐文档 §9.2）。
 */

export const WEATHER_TRANSITION_MS = {
  /** 天空颜色 */
  sky: 2500,
  /** 光斑交叠 */
  spots: 2200,
  /** 粒子淡出 / 淡入各一段 */
  particlesOut: 700,
  particlesIn: 1100,
  /** 主题 day↔night 可略短 */
  theme: 1800,
} as const;

export type SceneTransitionKey = string;

export function sceneTransitionKey(
  scene: string,
  period: string,
): SceneTransitionKey {
  return `${scene}::${period}`;
}
