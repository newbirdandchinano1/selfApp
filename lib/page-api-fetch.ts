/**
 * 领域 page-api 统一拉取模板（服务器权威）。
 * 直连服务器：必须打网，成功后灌缓存；失败直接抛错，禁止回退本地当成功。
 */
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';

export type PageFetchOpts = {
  signal?: AbortSignal;
  /** 保留兼容：恒为打网，忽略进行中 inflight 时传 true */
  forceRefresh?: boolean;
};

export type PageFetchResult = { fromApi: boolean };

export function shouldFetchPageFromApi(): boolean {
  return true;
}

export function shouldSkipPageNetwork(): boolean {
  return false;
}

export function asRecordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x),
  );
}

/** 将 page API 返回的行灌入本地 SQLite（带表级锁） */
export async function upsertPageRows(
  table: string,
  rows: Record<string, unknown>[],
  opts?: { reconcileSnapshot?: boolean },
): Promise<void> {
  if (rows.length === 0 && !opts?.reconcileSnapshot) return;
  await withApiTableSyncLock(table, async () => {
    await syncApiReadResultToLocal(table, rows, { reconcileSnapshot: opts?.reconcileSnapshot });
  });
}

export type FetchPageParams<TPayload, TResult extends PageFetchResult> = {
  domain: string;
  op: string;
  opts?: PageFetchOpts;
  fetch: (signal?: AbortSignal) => Promise<TPayload>;
  apply: (payload: TPayload) => Promise<TResult> | TResult;
};

/** 统一 page 拉取：REST -> apply 灌库；失败抛给 wrapLoad 显示错误/重试。 */
export async function fetchPage<TPayload, TResult extends PageFetchResult>(
  params: FetchPageParams<TPayload, TResult>,
): Promise<TResult> {
  const payload = await params.fetch(params.opts?.signal);
  return await params.apply(payload);
}
