/**
 * 全局 API 请求串行队列：同一时刻只执行一个 HTTP 请求，避免并发压垮服务端。
 */
let chain: Promise<unknown> = Promise.resolve();

export function enqueueApiRequest<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(() => fn());
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
