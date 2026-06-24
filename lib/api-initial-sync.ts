import { Platform } from 'react-native';

import { clearLocalUserDataTables } from '@/lib/api-local-clear';
import {
  PREFER_LOCAL_READS_META_KEY,
  REST_INITIAL_SYNC_META_KEY,
  localDbHasSubstantialUserData,
  readAppMeta,
  writeAppMeta,
} from '@/lib/api-local-bootstrap';
import { listAllTabPageKeys } from '@/lib/page-api-scope';
import { enablePreferLocalReads, markPageSyncedWithApi } from '@/lib/page-api-session';

export { REST_INITIAL_SYNC_META_KEY, PREFER_LOCAL_READS_META_KEY } from '@/lib/api-local-bootstrap';

export type InitialSyncProgress = {
  phase: 'preparing' | 'clearing' | 'done';
  tableIndex: number;
  tableCount: number;
  tableLabel?: string;
};

export type InitialSyncResult = {
  ran: boolean;
  ok: boolean;
  skippedReason?: 'web' | 'already_done' | 'has_local_data';
  error?: string;
};

async function yieldToUi(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

export async function hasCompletedInitialRestSync(): Promise<boolean> {
  return (await readAppMeta(REST_INITIAL_SYNC_META_KEY)) === '1';
}

async function markBootstrapCompleted(): Promise<void> {
  await writeAppMeta(REST_INITIAL_SYNC_META_KEY, '1');
  await writeAppMeta(PREFER_LOCAL_READS_META_KEY, '1');
  enablePreferLocalReads();
}

/** 升级用户本机已有业务数据：各 Tab 直接读本地，无需再逐页 REST */
function markAllTabPagesSyncedWithApi(): void {
  for (const key of listAllTabPageKeys()) {
    markPageSyncedWithApi(key);
  }
}

/**
 * 首启引导：清空本地业务数据并标记完成（不再阻塞全表 REST）。
 * 已有本地数据的升级用户仅标记完成，各 Tab 视为已同步。
 * 具体数据由各页面首次访问时按需从服务器拉取并覆盖本地。
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

  if (await hasCompletedInitialRestSync()) {
    enablePreferLocalReads();
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: false, ok: true, skippedReason: 'already_done' };
  }

  if (await localDbHasSubstantialUserData()) {
    await markBootstrapCompleted();
    markAllTabPagesSyncedWithApi();
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: false, ok: true, skippedReason: 'has_local_data' };
  }

  report({ phase: 'clearing', tableIndex: 0, tableCount: 0 });
  await yieldToUi();

  try {
    await clearLocalUserDataTables();
    await markBootstrapCompleted();
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: true, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[api-initial-sync] 首启清库失败', e);
    return { ran: true, ok: false, error: msg };
  }
}
