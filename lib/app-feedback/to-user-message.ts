const MAX_FRIENDLY_LEN = 96;

function extractRawMessage(err: unknown): string {
  if (typeof err === 'string') return err.trim();
  if (err instanceof Error) return err.message.trim();
  if (err == null) return '';
  return String(err).trim();
}

function getHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const status = (err as { httpStatus?: unknown }).httpStatus;
  return typeof status === 'number' ? status : undefined;
}

function truncate(message: string): string {
  if (message.length <= MAX_FRIENDLY_LEN) return message;
  return `${message.slice(0, MAX_FRIENDLY_LEN - 1)}…`;
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function looksLikeNativeLeak(message: string): boolean {
  if (/\bat\s+\S+/.test(message)) return true;
  if (/SQLITE_/i.test(message)) return true;
  if (/\bER_[A-Z0-9_]+\b/.test(message)) return true;
  if (/\bECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET\b/i.test(message)) return true;
  if (/^\s*</.test(message)) return true;
  // 长英文驱动原文
  if (message.length > 100 && !hasChinese(message) && /^[\x09\x0A\x0D\x20-\x7E]+$/.test(message)) {
    return true;
  }
  return false;
}

function isAbortLike(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return true;
  }
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * 将任意错误收敛为用户可读中文。展示层兜底；后端 message 友好时原样透出。
 */
export function toUserMessage(err: unknown, errorFallback = '操作失败，请稍后重试'): string {
  const raw = extractRawMessage(err);
  const status = getHttpStatus(err);
  const lower = raw.toLowerCase();

  if (err instanceof Error && err.name === 'ApiUnauthorizedError') {
    return '登录已失效，请重新登录';
  }
  if (status === 401 || /unauthorized|token.*expir|未登录|登录已失效|token 已过期/i.test(raw)) {
    return '登录已失效，请重新登录';
  }

  if (status === 429 || /too many requests|rate limit|请求过于频繁|操作过于频繁/i.test(raw)) {
    return '操作过于频繁，请稍后再试';
  }

  if (
    status === 409 ||
    /tombstone|expected_rev|版本冲突|occ|已被其他设备|数据已被.*更新/i.test(raw)
  ) {
    return '数据已被其他设备更新，请刷新后重试';
  }

  if (/unique|duplicate|已存在|唯一字段冲突|唯一约束/i.test(raw)) {
    return '记录已存在，请勿重复提交';
  }

  if (/foreign key|FOREIGN KEY|外键|关联.*不完整/i.test(raw)) {
    return '关联数据不完整，请先同步或检查依赖';
  }

  if (
    /非 json|html\/网关|json 解析失败|unexpected token|application\/json/i.test(lower) ||
    /^\s*</.test(raw)
  ) {
    return '服务暂时不可用，请稍后重试';
  }

  if (/timeout|timed?\s*out|超时|ETIMEDOUT/i.test(raw)) {
    return '请求超时，请重试';
  }

  if (
    isAbortLike(err) ||
    err instanceof TypeError ||
    /network request failed|failed to fetch|network error|网络异常|网络请求失败/i.test(lower)
  ) {
    return '网络异常，请检查连接后重试';
  }

  if (raw && hasChinese(raw) && !looksLikeNativeLeak(raw) && raw.length <= MAX_FRIENDLY_LEN) {
    return truncate(raw);
  }

  if (raw && hasChinese(raw) && !looksLikeNativeLeak(raw)) {
    return truncate(raw);
  }

  if (looksLikeNativeLeak(raw) || !raw) {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && raw) {
      console.warn('[toUserMessage] suppressed leaky error:', raw);
    }
    return errorFallback;
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[toUserMessage] unmapped error:', raw);
  }
  return errorFallback;
}
