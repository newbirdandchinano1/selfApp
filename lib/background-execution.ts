import {
  beginBackgroundExecution as beginNative,
  endBackgroundExecution as endNative,
} from 'zheng-background';

/** 在息屏/切后台时仍允许完成网络请求等短时任务（与 begin 成对调用）。 */
export async function beginBackgroundExecution(): Promise<void> {
  await beginNative();
}

export async function endBackgroundExecution(): Promise<void> {
  await endNative();
}

/** 包裹异步任务，自动申请/释放原生后台执行时间。 */
export async function withBackgroundExecution<T>(fn: () => Promise<T>): Promise<T> {
  await beginBackgroundExecution();
  try {
    return await fn();
  } finally {
    await endBackgroundExecution();
  }
}
