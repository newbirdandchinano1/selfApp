/**
 * API 请求队列：读宽写严
 * - read（GET）：默认最多 6 并发，冷启动多 Tab 并行拉数更快
 * - write（POST/PUT/PATCH/DELETE）：严格串行（同时最多 1），避免写乱序
 * 读/写独立计数与等待队列，互不抢对方名额（写串行时读仍可继续）。
 */

export type ApiRequestKind = 'read' | 'write';

export type EnqueueApiRequestOptions = {
  /** 缺省按 write（安全默认：非显式 read 一律当写） */
  kind?: ApiRequestKind;
};

const MAX_READ_IN_FLIGHT = 6;
const MAX_WRITE_IN_FLIGHT = 1;

let readInFlight = 0;
let writeInFlight = 0;
const readWaiters: Array<() => void> = [];
const writeWaiters: Array<() => void> = [];

function pumpRead(): void {
  while (readInFlight < MAX_READ_IN_FLIGHT && readWaiters.length > 0) {
    const next = readWaiters.shift();
    if (next) next();
  }
}

function pumpWrite(): void {
  while (writeInFlight < MAX_WRITE_IN_FLIGHT && writeWaiters.length > 0) {
    const next = writeWaiters.shift();
    if (next) next();
  }
}

export function enqueueApiRequest<T>(
  fn: () => Promise<T>,
  options?: EnqueueApiRequestOptions,
): Promise<T> {
  const kind: ApiRequestKind = options?.kind === 'read' ? 'read' : 'write';
  const isRead = kind === 'read';

  return new Promise<T>((resolve, reject) => {
    const start = () => {
      if (isRead) readInFlight += 1;
      else writeInFlight += 1;
      fn().then(resolve, reject).finally(() => {
        if (isRead) {
          readInFlight = Math.max(0, readInFlight - 1);
          pumpRead();
        } else {
          writeInFlight = Math.max(0, writeInFlight - 1);
          pumpWrite();
        }
      });
    };
    if (isRead) {
      readWaiters.push(start);
      pumpRead();
    } else {
      writeWaiters.push(start);
      pumpWrite();
    }
  });
}

/** @internal 仅供自测脚本重置队列状态 */
export function __resetApiRequestQueueForTest(): void {
  readInFlight = 0;
  writeInFlight = 0;
  readWaiters.length = 0;
  writeWaiters.length = 0;
}

/** @internal 仅供自测脚本观测在途峰值 */
export function __getApiRequestQueueStatsForTest(): {
  readInFlight: number;
  writeInFlight: number;
  readWaiting: number;
  writeWaiting: number;
} {
  return {
    readInFlight,
    writeInFlight,
    readWaiting: readWaiters.length,
    writeWaiting: writeWaiters.length,
  };
}
