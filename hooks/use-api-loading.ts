import { useSyncExternalStore } from 'react';

import { getApiLoadingPendingCount, subscribeApiLoading } from '@/lib/api-loading-tracker';

function getSnapshot(): boolean {
  return getApiLoadingPendingCount() > 0;
}

function getServerSnapshot(): boolean {
  return false;
}

/** 是否有进行中的 REST 读请求（由 api-read 层上报） */
export function useApiLoading(): boolean {
  return useSyncExternalStore(subscribeApiLoading, getSnapshot, getServerSnapshot);
}
