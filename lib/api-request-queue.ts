/**
 * API 请求全局并发闸门：避免反复切页时 in-flight 无限堆积打满后端 / SQLite。
 * 写请求优先出队；读/写共享同一上限。
 */

export type ApiRequestKind = 'read' | 'write';

export type EnqueueApiRequestOptions = {
  kind?: ApiRequestKind;
};

/** 同时进行的 HTTP 上限（低于后端 apiMax≈50，留余量给其它客户端） */
const MAX_IN_FLIGHT = 6;
/** 排队上限：超出时拒绝新的读请求，避免内存与延迟无限增长 */
const MAX_WAITING = 48;

type QueueEntry = {
  kind: ApiRequestKind;
  start: () => void;
  reject: (err: unknown) => void;
};

let inFlight = 0;
const waiting: QueueEntry[] = [];

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    const next = waiting.shift();
    if (!next) break;
    inFlight += 1;
    next.start();
  }
}

function enqueueEntry(entry: QueueEntry): void {
  if (entry.kind === 'write') {
    const firstRead = waiting.findIndex(e => e.kind === 'read');
    if (firstRead >= 0) waiting.splice(firstRead, 0, entry);
    else waiting.push(entry);
  } else {
    waiting.push(entry);
  }
  pump();
}

export function enqueueApiRequest<T>(
  fn: () => Promise<T>,
  options?: EnqueueApiRequestOptions,
): Promise<T> {
  const kind: ApiRequestKind = options?.kind === 'write' ? 'write' : 'read';

  return new Promise<T>((resolve, reject) => {
    const start = () => {
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          pump();
        });
    };

    if (inFlight < MAX_IN_FLIGHT && waiting.length === 0) {
      inFlight += 1;
      start();
      return;
    }

    if (waiting.length >= MAX_WAITING) {
      if (kind === 'read') {
        reject(new Error('API 请求排队已满，请稍后重试'));
        return;
      }
      // 写请求：挤掉最旧的读，保证脏数据仍能推送
      const dropIdx = waiting.findIndex(e => e.kind === 'read');
      if (dropIdx >= 0) {
        const dropped = waiting.splice(dropIdx, 1)[0];
        dropped.reject(new Error('API 请求排队已满，请稍后重试'));
      } else {
        reject(new Error('API 请求排队已满，请稍后重试'));
        return;
      }
    }

    enqueueEntry({ kind, start, reject });
  });
}

/** @internal 仅供自测 */
export function __resetApiRequestQueueForTest(): void {
  inFlight = 0;
  waiting.length = 0;
}

/** @internal 仅供自测 */
export function __getApiRequestQueueStatsForTest(): {
  inFlight: number;
  waiting: number;
  maxInFlight: number | null;
} {
  return { inFlight, waiting: waiting.length, maxInFlight: MAX_IN_FLIGHT };
}
