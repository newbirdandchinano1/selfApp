/** 写入失败时展示底层原因（SQLite / 约束 / 同步等），避免笼统提示 */
export function formatWriteError(error: unknown, fallback = '请稍后重试。'): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  if (typeof error === 'string') {
    const message = error.trim();
    if (message) return message;
  }
  return fallback;
}
