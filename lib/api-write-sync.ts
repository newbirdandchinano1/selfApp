/**
 * 本地 SQLite 写入后尽快推送到 REST 后端（串行队列 + 防抖，避免并发推送竞态）。
 * 由 markApiTableDirty 全局触发；关键流程可 awaitSync 等待完成。
 */
import { withApiWriteLoading } from '@/lib/api-loading-tracker';
import { isSkeletonLoadingTabActive } from '@/lib/page-api-health-ui';

const WRITE_PUSH_DEBOUNCE_MS = 300;

let pushChain: Promise<void> = Promise.resolve();
let writePushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function clearWritePushDebounce(): void {
  if (writePushDebounceTimer) {
    clearTimeout(writePushDebounceTimer);
    writePushDebounceTimer = null;
  }
}

async function runFlush(opts?: { rethrow?: boolean; awaitSync?: boolean; quiet?: boolean }): Promise<void> {
  const flush = async () => {
    const { flushApiDirtyTablesNow } = await import('@/lib/api-incremental-sync');
    await flushApiDirtyTablesNow({ rethrow: opts?.rethrow ?? false });
  };

  const showGlobalLoading =
    opts?.awaitSync === true && !opts?.quiet && !isSkeletonLoadingTabActive();
  if (showGlobalLoading) {
    await withApiWriteLoading(flush);
    return;
  }

  await flush();
}

export async function pushLocalChangesToApi(opts?: {
  /** 为 true 时等待推送完成；默认后台执行不阻塞 UI */
  awaitSync?: boolean;
  /** 等待推送但不挂全局加载蒙层（后台静默同步等） */
  quiet?: boolean;
  rethrow?: boolean;
}): Promise<void> {
  const run = () =>
    runFlush({ rethrow: opts?.rethrow, awaitSync: opts?.awaitSync, quiet: opts?.quiet });

  if (opts?.awaitSync) {
    clearWritePushDebounce();
    const task = pushChain.then(run);
    pushChain = task.catch(() => {});
    await task;
    return;
  }

  clearWritePushDebounce();
  writePushDebounceTimer = setTimeout(() => {
    writePushDebounceTimer = null;
    const task = pushChain.then(run);
    pushChain = task.catch(() => {});
    void task.catch(e => {
      if (__DEV__) console.warn('[api-write-sync] 后台推送失败', e);
    });
  }, WRITE_PUSH_DEBOUNCE_MS);
}
