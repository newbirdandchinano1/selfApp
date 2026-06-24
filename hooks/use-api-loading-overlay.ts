import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  clearApiLoadingError,
  getApiLoadingError,
  isApiLoadingActive,
  retryStuckApiLoading,
  subscribeApiLoading,
  type ApiLoadingErrorState,
} from '@/lib/api-loading-tracker';

const DEFAULT_MIN_VISIBLE_MS = 480;
const DEFAULT_TIMEOUT_MS = 30000;

function getLoadingSnapshot(): boolean {
  return isApiLoadingActive();
}

function getLoadingServerSnapshot(): boolean {
  return false;
}

function getErrorSnapshot(): ApiLoadingErrorState | null {
  return getApiLoadingError();
}

function getErrorServerSnapshot(): ApiLoadingErrorState | null {
  return null;
}

function useApiLoadingRaw(): boolean {
  return useSyncExternalStore(subscribeApiLoading, getLoadingSnapshot, getLoadingServerSnapshot);
}

function useApiLoadingError(): ApiLoadingErrorState | null {
  return useSyncExternalStore(subscribeApiLoading, getErrorSnapshot, getErrorServerSnapshot);
}

/**
 * 全局 API 加载蒙层：最短展示时间、全屏阻塞、超时/失败提示与重试。
 */
export function useApiLoadingOverlay(
  minVisibleMs = DEFAULT_MIN_VISIBLE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const raw = useApiLoadingRaw();
  const error = useApiLoadingError();
  const [visible, setVisible] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const shownAtRef = useRef(0);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeoutTimer = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (raw) {
      shownAtRef.current = Date.now();
      setVisible(true);
      setTimedOut(false);
      clearTimeoutTimer();
      timeoutTimerRef.current = setTimeout(() => {
        if (isApiLoadingActive()) setTimedOut(true);
      }, timeoutMs);
      return clearTimeoutTimer;
    }

    clearTimeoutTimer();
    setTimedOut(false);

    if (!visible) return;

    const elapsed = Date.now() - shownAtRef.current;
    const remain = Math.max(0, minVisibleMs - elapsed);
    const timer = setTimeout(() => setVisible(false), remain);
    return () => clearTimeout(timer);
  }, [raw, visible, minVisibleMs, timeoutMs, clearTimeoutTimer]);

  const retry = useCallback(async () => {
    clearTimeoutTimer();
    setTimedOut(false);
    clearApiLoadingError();
    await retryStuckApiLoading();
  }, [clearTimeoutTimer]);

  const dismiss = useCallback(() => {
    clearTimeoutTimer();
    setTimedOut(false);
    clearApiLoadingError();
  }, [clearTimeoutTimer]);

  const blocking = visible || timedOut || Boolean(error);

  return { visible, timedOut, error, blocking, retry, dismiss };
}
