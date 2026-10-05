/**
 * 缓存灌入与失效门面（服务器权威，SQLite 仅在线缓存，无 TTL）。
 * 预热：登录/启动 bootstrapIfNeeded；失败不得标 bootstrap_done。
 * 失效：SSE / 回前台 / 轮询 pullChanges、用户下拉 refreshFromUser、本机写成功后 UPSERT。
 * 丢弃：登出清 token 时 discard 本地业务表。
 */
import { AppState, type AppStateStatus } from 'react-native';

import { withApiWriteLoading } from '@/lib/api-loading-tracker';
import { isSkeletonLoadingTabActive } from '@/lib/page-api-health-ui';
import { SYNC_PULL_POLL_INTERVAL_MS, type SyncPullResult } from '@/lib/sync-pull';
import { startSyncSse, stopSyncSse } from '@/lib/sync-sse';

const PUSH_COALESCE_MS = 300;
const MAX_PUSH_BACKOFF_MS = 30_000;
const SHORT_BACKGROUND_SKIP_MS = 2_500;
const SSE_PULL_DEBOUNCE_MS = 400;

function envFlagOn(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw == null || raw.trim() === '') return defaultOn;
  const v = raw.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

/** 关 SSE 做验收：EXPO_PUBLIC_SYNC_SSE_ENABLED=0 */
export function isSyncSseEnabled(): boolean {
  return envFlagOn(process.env.EXPO_PUBLIC_SYNC_SSE_ENABLED, true);
}

export type RequestPushOpts = {
  /** 为 true 时等待推送完成；默认后台执行不阻塞 UI */
  awaitSync?: boolean;
  /** 等待推送但不挂全局加载蒙层（后台静默同步等） */
  quiet?: boolean;
  rethrow?: boolean;
  /** 仅推送这些表（及其 FK 父表）；避免项目写操作被无关财务脏表失败污染 */
  onlyTables?: string[];
};

let pushChain: Promise<void> = Promise.resolve();
let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pushBackoffMs = PUSH_COALESCE_MS;

function clearPushDebounce(): void {
  if (pushDebounceTimer) {
    clearTimeout(pushDebounceTimer);
    pushDebounceTimer = null;
  }
}

function armPushTimer(delayMs: number): void {
  clearPushDebounce();
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = null;
    const task = pushChain.then(() => runFlush({}));
    pushChain = task.catch(() => {});
    void task.catch(e => {
      if (__DEV__) console.warn('[sync-manager] 后台推送失败', e);
    });
  }, delayMs);
}

async function runFlush(opts?: RequestPushOpts): Promise<void> {
  const flush = async () => {
    const { flushApiDirtyTablesNow } = await import('@/lib/api-incremental-sync');
    const { withSuppressedApiWriteOverlay } = await import('@/lib/api-loading-tracker');
    await withSuppressedApiWriteOverlay(async () => {
      await flushApiDirtyTablesNow({
        rethrow: opts?.rethrow ?? false,
        onlyTables: opts?.onlyTables,
      });
    });
  };

  const showGlobalLoading =
    opts?.awaitSync === true && !opts?.quiet && !isSkeletonLoadingTabActive();
  if (showGlobalLoading) {
    await withApiWriteLoading(flush);
    return;
  }

  await flush();
}

/**
 * 遗留 pending 冲刷入口（业务写不再依赖）。合并 debounce 后 flush。
 */
export async function requestPush(opts?: RequestPushOpts): Promise<void> {
  if (opts?.awaitSync) {
    clearPushDebounce();
    const task = pushChain.then(() => runFlush(opts));
    pushChain = task.catch(() => {});
    await task;
    return;
  }

  armPushTimer(PUSH_COALESCE_MS);
}

/** 推送失败后的退避重试，仍走同一队列（不另开 timer 体系） */
export function requestRetryAfterFailure(): void {
  pushBackoffMs = Math.min(Math.max(PUSH_COALESCE_MS, pushBackoffMs * 2), MAX_PUSH_BACKOFF_MS);
  armPushTimer(pushBackoffMs);
}

export function resetPushBackoff(): void {
  pushBackoffMs = PUSH_COALESCE_MS;
}

/**
 * 启动后扫描 SQLite pending + 课表 outbox，再挂上同一队列（杀进程 / 超时进 App 仍能推）。
 */
export function startSyncPushScheduler(): void {
  void (async () => {
    try {
      const { markAllPendingTablesDirty } = await import('@/lib/api-incremental-sync');
      await markAllPendingTablesDirty();
    } catch (e) {
      if (__DEV__) console.warn('[sync-manager] 启动扫描 pending 失败', e);
    }
    void requestPush();
  })();
}

export async function pullChanges(opts?: { signal?: AbortSignal }): Promise<SyncPullResult> {
  const m = await import('@/lib/sync-pull');
  return m.pullChanges(opts);
}

export async function bootstrapIfNeeded(opts?: { signal?: AbortSignal }): Promise<boolean> {
  const m = await import('@/lib/sync-bootstrap');
  return m.bootstrapIfNeeded(opts);
}

/** 用户下拉 / 手动重试：先闸门与增量 apply，再由页面读 SQLite */
export async function refreshFromUser(opts?: { signal?: AbortSignal }): Promise<SyncPullResult> {
  await bootstrapIfNeeded(opts);
  return pullChanges(opts);
}

let syncRuntimeStarted = false;
let appStateSub: { remove: () => void } | null = null;
let backgroundedAtMs: number | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let sseDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function onAppStateChange(next: AppStateStatus): void {
  if (next !== 'active') {
    if (backgroundedAtMs == null) backgroundedAtMs = Date.now();
    return;
  }
  const started = backgroundedAtMs;
  backgroundedAtMs = null;
  const backgroundMs = started != null ? Date.now() - started : 0;
  if (backgroundMs > 0 && backgroundMs < SHORT_BACKGROUND_SKIP_MS) return;
  void pullChanges();
}

function schedulePullFromSse(): void {
  if (sseDebounceTimer != null) clearTimeout(sseDebounceTimer);
  sseDebounceTimer = setTimeout(() => {
    sseDebounceTimer = null;
    void pullChanges();
  }, SSE_PULL_DEBOUNCE_MS);
}

function stopNotifyChannels(): void {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (sseDebounceTimer != null) {
    clearTimeout(sseDebounceTimer);
    sseDebounceTimer = null;
  }
  stopSyncSse();
}

function startNotifyChannels(): void {
  stopNotifyChannels();
  void pullChanges();
  pollTimer = setInterval(() => {
    void pullChanges();
  }, SYNC_PULL_POLL_INTERVAL_MS);
  if (!isSyncSseEnabled()) return;
  startSyncSse({
    onChanges: () => schedulePullFromSse(),
    onConnected: () => {
      void pullChanges();
    },
  });
}

/**
 * 进程级同步运行时：pending 扫描 + Push 队列 + 一个 poll + 可选 SSE + 回前台一次 pull。
 */
export function startSyncRuntime(): void {
  if (syncRuntimeStarted) return;
  syncRuntimeStarted = true;
  startSyncPushScheduler();
  startNotifyChannels();
  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', onAppStateChange);
}

export function stopSyncRuntime(): void {
  syncRuntimeStarted = false;
  stopNotifyChannels();
  appStateSub?.remove();
  appStateSub = null;
  backgroundedAtMs = null;
}

export const SyncManager = {
  requestPush,
  requestRetryAfterFailure,
  start: startSyncRuntime,
  stop: stopSyncRuntime,
  startSyncPushScheduler,
  pullChanges,
  bootstrapIfNeeded,
  refreshFromUser,
  isSyncSseEnabled,
};
