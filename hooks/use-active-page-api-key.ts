import { useSyncExternalStore } from 'react';

import { getActivePageApiKey, subscribeActivePageApiKey } from '@/lib/page-api-active';

export function useActivePageApiKey(): string | null {
  return useSyncExternalStore(subscribeActivePageApiKey, getActivePageApiKey, () => null);
}
