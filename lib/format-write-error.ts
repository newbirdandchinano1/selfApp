import { toUserMessage } from '@/lib/app-feedback/to-user-message';

/** 写入失败时展示用户可读原因（网络 / 约束 / 同步等），屏蔽底层泄漏 */
export function formatWriteError(error: unknown, fallback = '请稍后重试。'): string {
  return toUserMessage(error, fallback);
}
