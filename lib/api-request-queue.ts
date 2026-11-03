/**
 * API 请求全局并发闸门：避免反复切页时 in-flight 无限堆积打满后端 / SQLite。
 *
 * 写仍优先于读（脏数据要尽快上云），但为读保留槽位，避免启动推送 / 大量
 * pending_create 把槽占满导致任务页 / 财务页 GET 永远排不上、骨架屏卡死。
 */

export type ApiRequestKind = 'read' | 'write';

export type EnqueueApiRequestOptions = {
  kind?: ApiRequestKind;
};

export class ApiRequestQueueFullError extends Error {
  readonly code = 'API_REQUEST_QUEUE_FULL';
  constructor(message = 'API 请求排队已满，请稍后重试') {
    super(message);
    this.name = 'ApiRequestQueueFullError';
  }
}

/** 同时进行的 HTTP 上限（低于后端 apiMax≈50，留余量给其它客户端） */
const MAX_IN_FLIGHT = 6;
/**
 * 有读在排队或飞行中时，至少留这么多槽给读。
 * 例：6 槽、保留 2 → 写最多占 4，读不会被推送流饿死。
 */
const RESERVED_READ_SLOTS = 2;
/** 排队上限：超出时挤掉最旧的读，避免内存与延迟无限增长 */
const MAX_WAITING = 64;

type QueueEntry = {
  kind: ApiRequestKind;
  start: () => void;
  reject: (err: unknown) => void;
  /** 被挤出队列时用于吞掉 Uncaught (in promise) */
  promise: Promise<unknown>;
};

let inFlight = 0;
let inFlightReads = 0;
let inFlightWrites = 0;
const waitingReads: QueueEntry[] = [];
const waitingWrites: QueueEntry[] = [];

function waitingCount(): number {
  return waitingReads.length + waitingWrites.length;
}

function beginInFlight(kind: ApiRequestKind): void {
  inFlight += 1;
  if (kind === 'write') inFlightWrites += 1;
  else inFlightReads += 1;
}

function endInFlight(kind: ApiRequestKind): void {
  inFlight = Math.max(0, inFlight - 1);
  if (kind === 'write') inFlightWrites = Math.max(0, inFlightWrites - 1);
  else inFlightReads = Math.max(0, inFlightReads - 1);
}

/** 有读需求时限制写占用，保证读能拿到 RESERVED_READ_SLOTS */
function maxWritesAllowed(): number {
  if (waitingReads.length > 0 || inFlightReads > 0) {
    return Math.max(0, MAX_IN_FLIGHT - RESERVED_READ_SLOTS);
  }
  return MAX_IN_FLIGHT;
}

function takeNext(): QueueEntry | null {
  if (inFlight >= MAX_IN_FLIGHT) return null;

  const writeCap = maxWritesAllowed();
  // 写优先，但不得超过写上限（有读等待/飞行时强制留槽，禁止偷吃保留位）
  if (waitingWrites.length > 0 && inFlightWrites < writeCap) {
    return waitingWrites.shift() ?? null;
  }
  if (waitingReads.length > 0) {
    return waitingReads.shift() ?? null;
  }
  return null;
}

function pump(): void {
  for (;;) {
    const next = takeNext();
    if (!next) break;
    beginInFlight(next.kind);
    next.start();
  }
}

function dropOldestWaitingRead(reason: string): boolean {
  const dropped = waitingReads.shift();
  if (!dropped) return false;
  const err = new ApiRequestQueueFullError(reason);
  dropped.reject(err);
  // 挤掉的过期读常常是 fire-and-forget，避免 Uncaught (in promise) 刷屏
  void dropped.promise.catch(() => undefined);
  return true;
}

export function enqueueApiRequest<T>(
  fn: () => Promise<T>,
  options?: EnqueueApiRequestOptions,
): Promise<T> {
  const kind: ApiRequestKind = options?.kind === 'write' ? 'write' : 'read';

  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const start = () => {
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        endInFlight(kind);
        pump();
      });
  };

  if (waitingCount() >= MAX_WAITING) {
    // 读/写都优先挤掉最旧的读：新读更新、写要保证脏数据仍能推送
    if (!dropOldestWaitingRead('API 请求排队已满，请稍后重试')) {
      reject(new ApiRequestQueueFullError());
      return promise;
    }
  }

  const entry: QueueEntry = { kind, start, reject, promise };
  if (kind === 'write') waitingWrites.push(entry);
  else waitingReads.push(entry);
  pump();
  return promise;
}

/** @internal 仅供自测 */
export function __resetApiRequestQueueForTest(): void {
  inFlight = 0;
  inFlightReads = 0;
  inFlightWrites = 0;
  waitingReads.length = 0;
  waitingWrites.length = 0;
}

/** @internal 仅供自测 */
export function __getApiRequestQueueStatsForTest(): {
  inFlight: number;
  waiting: number;
  inFlightReads: number;
  inFlightWrites: number;
  waitingReads: number;
  waitingWrites: number;
  maxInFlight: number | null;
  reservedReadSlots: number;
} {
  return {
    inFlight,
    waiting: waitingCount(),
    inFlightReads,
    inFlightWrites,
    waitingReads: waitingReads.length,
    waitingWrites: waitingWrites.length,
    maxInFlight: MAX_IN_FLIGHT,
    reservedReadSlots: RESERVED_READ_SLOTS,
  };
}
