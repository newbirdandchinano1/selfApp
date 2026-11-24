/**
 * 阶段 D3 / E：page API 单次尝试超时（与后端 A2 同灰度）。
 * 禁止只收紧后端并发而不收客户端 timeout。
 */
export const PAGE_API_TIMEOUTS_MS = {
  /** catalog / taskView / projects-list */
  core: 5_000,
  projects: 5_000,
  habits: 3_000,
  heatmap: 8_000,
  /** 后台表同步 / 无 taskView 遗留路径 */
  backgroundSync: 20_000,
} as const;

export type PageApiTimeoutKey = keyof typeof PAGE_API_TIMEOUTS_MS;
