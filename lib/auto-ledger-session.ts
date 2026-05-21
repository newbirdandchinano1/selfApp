import { beginBackgroundExecution, endBackgroundExecution } from '@/lib/background-execution';

let sessionDepth = 0;

/** 申请原生后台执行（iOS UIBackgroundTask / Android 前台服务），可嵌套引用计数。 */
export async function enterAutoLedgerSession(): Promise<void> {
  sessionDepth += 1;
  if (sessionDepth === 1) {
    await beginBackgroundExecution();
  }
}

export async function leaveAutoLedgerSession(): Promise<void> {
  sessionDepth = Math.max(0, sessionDepth - 1);
  if (sessionDepth === 0) {
    await endBackgroundExecution();
  }
}

/** 包裹单次自动记账流程，确保结束时释放后台执行资源。 */
export async function runInAutoLedgerSession<T>(fn: () => Promise<T>): Promise<T> {
  await enterAutoLedgerSession();
  try {
    return await fn();
  } finally {
    await leaveAutoLedgerSession();
  }
}
