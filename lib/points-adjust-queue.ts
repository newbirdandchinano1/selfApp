/** 积分钱包调整串行队列，避免完成/取消连点时 earn/undo 乱序。 */
let pointsAdjustChain: Promise<void> = Promise.resolve();

export function enqueuePointsAdjust<T>(fn: () => Promise<T>): Promise<T> {
  const run = pointsAdjustChain.then(fn, fn);
  pointsAdjustChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
