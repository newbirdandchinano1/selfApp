import { Platform } from 'react-native';

import { REST_INITIAL_SYNC_META_KEY, writeAppMeta } from '@/lib/api-local-bootstrap';

export { REST_INITIAL_SYNC_META_KEY } from '@/lib/api-local-bootstrap';

export type InitialSyncProgress = {
  phase: 'preparing' | 'warming' | 'done';
  tableIndex: number;
  tableCount: number;
  tableLabel?: string;
};

export type InitialSyncResult = {
  ran: boolean;
  ok: boolean;
  skippedReason?: 'web';
  error?: string;
};

/**
 * ???????? bootstrap ??????
 * ?????? SQLite ??????????????
 */
export async function runInitialRestSyncIfNeeded(opts?: {
  signal?: AbortSignal;
  onProgress?: (progress: InitialSyncProgress) => void;
}): Promise<InitialSyncResult> {
  const report = (progress: InitialSyncProgress) => opts?.onProgress?.(progress);

  if (Platform.OS === 'web') {
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: false, ok: true, skippedReason: 'web' };
  }

  report({ phase: 'preparing', tableIndex: 0, tableCount: 0 });
  report({ phase: 'warming', tableIndex: 0, tableCount: 0 });

  try {
    const { bootstrapIfNeeded } = await import('@/lib/sync-bootstrap');
    const ok = await bootstrapIfNeeded({ signal: opts?.signal });
    if (ok) {
      await writeAppMeta(REST_INITIAL_SYNC_META_KEY, '1');
    }
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: true, ok };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[api-initial-sync] ??????', e);
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: true, ok: false, error: msg };
  }
}
