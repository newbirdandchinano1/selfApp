import {
  beginApiLoading,
  endApiLoading,
  getApiLoadingError,
} from '@/lib/api-loading-tracker';

import { toast } from './toast-events';
import { toUserMessage } from './to-user-message';

export type RunWithFeedbackOptions = {
  /**
   * 可选：纯本地耗时操作时打开全局加载壳。
   * 已走 apiRequest / withApiWriteLoading 的写请求无需再传。
   */
  loading?: string;
  /** 成功 Toast；省略则不提示成功 */
  success?: string;
  /** 失败兜底文案 */
  errorFallback?: string;
};

/**
 * 包装一次用户主动操作：可选加载壳 + 成功/失败 Toast。
 * 若错误已由 ApiLoadingShell 展示，则跳过 error Toast，避免双弹。
 */
export async function runWithFeedback<T>(
  action: () => Promise<T>,
  opts: RunWithFeedbackOptions = {},
): Promise<T> {
  const useLocalLoading = Boolean(opts.loading);
  if (useLocalLoading) beginApiLoading();

  try {
    const result = await action();
    if (opts.success) toast.success(opts.success);
    return result;
  } catch (err) {
    // 双弹规避：壳内已有失败卡时不再 Toast
    if (!getApiLoadingError()) {
      toast.error(toUserMessage(err, opts.errorFallback ?? '操作失败，请稍后重试'));
    }
    throw err;
  } finally {
    if (useLocalLoading) endApiLoading();
  }
}
