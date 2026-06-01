import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';

import { isApiLoadingActive, subscribeApiLoading } from '@/lib/api-loading-tracker';

function getSnapshot(): boolean {
  return isApiLoadingActive();
}

function getServerSnapshot(): boolean {
  return false;
}

/** 是否有进行中的 REST 读请求 */
export function useApiLoadingRaw(): boolean {
  return useSyncExternalStore(subscribeApiLoading, getSnapshot, getServerSnapshot);
}

/**
 * 带最短展示时间的加载态，避免指示器一闪而过看不见。
 * 用于顶部进度条与内容过渡动画。
 */
export function useApiLoading(minVisibleMs = 320): boolean {
  const raw = useApiLoadingRaw();
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef(0);

  useEffect(() => {
    if (raw) {
      shownAtRef.current = Date.now();
      setVisible(true);
      return;
    }

    if (!visible) return;

    const elapsed = Date.now() - shownAtRef.current;
    const remain = Math.max(0, minVisibleMs - elapsed);
    const timer = setTimeout(() => setVisible(false), remain);
    return () => clearTimeout(timer);
  }, [raw, visible, minVisibleMs]);

  return visible;
}
