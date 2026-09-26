/**
 * API 请求入队入口（当前完全放开：不做全局并发限制）。
 * 保留函数与 `kind` 参数以兼容调用方；写安全仍由 withApiTableSyncLock / pushChain 负责。
 */

export type ApiRequestKind = 'read' | 'write';

export type EnqueueApiRequestOptions = {
  /** 保留兼容；当前忽略 */
  kind?: ApiRequestKind;
};

export function enqueueApiRequest<T>(
  fn: () => Promise<T>,
  _options?: EnqueueApiRequestOptions,
): Promise<T> {
  return fn();
}

/** @internal 仅供自测 */
export function __resetApiRequestQueueForTest(): void {
  /* no-op：无队列状态 */
}

/** @internal 仅供自测 */
export function __getApiRequestQueueStatsForTest(): {
  inFlight: number;
  waiting: number;
  maxInFlight: number | null;
} {
  return { inFlight: 0, waiting: 0, maxInFlight: null };
}
