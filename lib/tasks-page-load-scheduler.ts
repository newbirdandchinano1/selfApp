/**
 * 阶段 D2：任务页请求调度 —— 有限并发、复用 in-flight、AbortSignal 合并。
 */
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import { TASKS_PAGE_MAX_CONCURRENCY } from '@/lib/tasks-page-module-loading';

export function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const source of signals) {
    if (!source) continue;
    if (source.aborted) {
      controller.abort();
      return controller.signal;
    }
    source.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export type ConcurrencyGate = {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  /** 当前占用槽位数（调试用） */
  active: () => number;
};

/** 最大并发 gate；超出排队，保证 core 批次不会打爆连接池 */
export function createConcurrencyGate(max = TASKS_PAGE_MAX_CONCURRENCY): ConcurrencyGate {
  const limit = Math.max(1, Math.floor(max));
  let activeCount = 0;
  const waiters: Array<() => void> = [];

  const release = () => {
    activeCount = Math.max(0, activeCount - 1);
    const next = waiters.shift();
    if (next) next();
  };

  const acquire = async (): Promise<void> => {
    if (activeCount < limit) {
      activeCount += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(() => {
        activeCount += 1;
        resolve();
      });
    });
  };

  return {
    active: () => activeCount,
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

type InflightEntry<T> = { promise: Promise<T>; key: string };

/**
 * 同 key 合并 in-flight Promise；abort 只影响当前等待方（不取消共享请求本体）。
 */
export function createInflightMerger<T>() {
  let current: InflightEntry<T> | null = null;

  return {
    run(key: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      throwIfAborted(signal);
      if (current && current.key === key) {
        return current.promise.then((value) => {
          throwIfAborted(signal);
          return value;
        });
      }
      const promise = (async () => {
        try {
          return await fn();
        } finally {
          if (current?.promise === promise) current = null;
        }
      })();
      current = { key, promise };
      return promise.then((value) => {
        throwIfAborted(signal);
        return value;
      });
    },
  };
}
