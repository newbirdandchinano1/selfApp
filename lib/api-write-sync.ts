/**
 * 本地 SQLite 写入后尽快推送到 REST 后端（串行队列，避免并发推送竞态）。
 * 由 markApiTableDirty 全局触发；关键流程可 awaitSync 等待完成。
 */
let pushChain: Promise<void> = Promise.resolve();

export async function pushLocalChangesToApi(opts?: {
  /** 为 true 时等待推送完成；默认后台执行不阻塞 UI */
  awaitSync?: boolean;
  rethrow?: boolean;
}): Promise<void> {
  const run = async () => {
    const { flushApiDirtyTablesNow } = await import('@/lib/api-incremental-sync');
    await flushApiDirtyTablesNow({ rethrow: opts?.rethrow ?? false });
  };

  const task = pushChain.then(run);
  pushChain = task.catch(() => {});

  if (opts?.awaitSync) {
    await task;
    return;
  }

  void task.catch(e => {
    if (__DEV__) console.warn('[api-write-sync] 后台推送失败', e);
  });
}
