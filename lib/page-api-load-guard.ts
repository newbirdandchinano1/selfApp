/** 页面首次 REST 全量加载：防抖 + 去重，避免快速切换 Tab 重复请求 */

const PAGE_FOCUS_DEBOUNCE_MS = 350;

const inflightPageLoads = new Map<string, Promise<boolean | void>>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type GuardedPageLoadOpts = {
  /** focus 触发时防抖（默认 true） */
  debounce?: boolean;
  /** 跳过去重，强制新请求（下拉刷新等） */
  force?: boolean;
};

function clearDebounceTimer(pageKey: string): void {
  const timer = debounceTimers.get(pageKey);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(pageKey);
  }
}

/**
 * 同一 pageKey 进行中的加载复用同一 Promise；focus 场景默认 350ms 防抖。
 */
export function runGuardedPageApiLoad(
  pageKey: string,
  fn: () => Promise<boolean | void>,
  opts?: GuardedPageLoadOpts,
): Promise<boolean | void> {
  const key = pageKey.trim();
  if (!key) return fn();

  const debounce = opts?.debounce ?? false;
  const force = opts?.force ?? false;

  if (debounce && !force) {
    return new Promise((resolve, reject) => {
      clearDebounceTimer(key);
      const timer = setTimeout(() => {
        debounceTimers.delete(key);
        void runGuardedPageApiLoad(key, fn, { force: false })
          .then(resolve)
          .catch(reject);
      }, PAGE_FOCUS_DEBOUNCE_MS);
      debounceTimers.set(key, timer);
    });
  }

  if (!force) {
    const existing = inflightPageLoads.get(key);
    if (existing) return existing;
  } else {
    clearDebounceTimer(key);
  }

  const promise = fn().finally(() => {
    if (inflightPageLoads.get(key) === promise) {
      inflightPageLoads.delete(key);
    }
  });
  inflightPageLoads.set(key, promise);
  return promise;
}

export function cancelPendingPageApiLoad(pageKey: string): void {
  clearDebounceTimer(pageKey.trim());
}
