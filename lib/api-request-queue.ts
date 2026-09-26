/**
 * 全局 API 软限流：读写共用同一并发池。
 *
 * 背景：曾拆成「读 6 / 写 1~2」分车道——一级 Tab 容易占满读槽，
 * 二三级页入队排队体感 7–10s；写全局串行也多余（已有 withApiTableSyncLock + pushChain）。
 *
 * 现恢复共用池，上限 24（接近放开，仅防极端打爆）；`kind` 兼容保留但不分槽。
 */

export type ApiRequestKind = 'read' | 'write';

export type EnqueueApiRequestOptions = {
  /** 保留兼容；当前与共享池无关 */
  kind?: ApiRequestKind;
};

/** 软上限：24 ≈ 接近放开，仅防极端打爆 */
const MAX_IN_FLIGHT = 24;

let inFlight = 0;
const waiters: Array<() => void> = [];

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && waiters.length > 0) {
    const next = waiters.shift();
    if (next) next();
  }
}

export function enqueueApiRequest<T>(
  fn: () => Promise<T>,
  _options?: EnqueueApiRequestOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      inFlight += 1;
      fn().then(resolve, reject).finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        pump();
      });
    };
    waiters.push(start);
    pump();
  });
}

/** @internal 仅供自测 */
export function __resetApiRequestQueueForTest(): void {
  inFlight = 0;
  waiters.length = 0;
}

/** @internal 仅供自测 */
export function __getApiRequestQueueStatsForTest(): {
  inFlight: number;
  waiting: number;
  maxInFlight: number;
} {
  return { inFlight, waiting: waiters.length, maxInFlight: MAX_IN_FLIGHT };
}
