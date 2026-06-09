import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isApiLoadingActive,
  retryStuckApiLoading,
  subscribeApiLoading,
} from '@/lib/api-loading-tracker';
import { useSyncExternalStore } from 'react';

const DEFAULT_MIN_VISIBLE_MS = 480;
const DEFAULT_TIMEOUT_MS = 10000;

function getSnapshot(): boolean {
  return isApiLoadingActive();
}

function getServerSnapshot(): boolean {
  return false;
}

function useApiLoadingRaw(): boolean {
  return useSyncExternalStore(subscribeApiLoading, getSnapshot, getServerSnapshot);
}

/**
 * 全局 API 加载蒙层：最短展示时间、全屏阻塞、超时提示与重试。
 */
export function useApiLoadingOverlay(
  minVisibleMs = DEFAULT_MIN_VISIBLE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const raw = useApiLoadingRaw();
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
    await retryStuckApiLoading();
  }, [clearTimeoutTimer]);

  const blocking = visible || timedOut;

  return { visible, timedOut, blocking, retry };
}
