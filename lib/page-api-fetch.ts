/**
 * 领域 page-api 的统一拉取模板：localOnly 跳过 / REST / 灌本地 / 离线回退。
 * 各域 *-page-api 只负责 DTO 映射与表字段，不再复制 try/catch 脚手架。
 */
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { getActivePageApiReadOpts } from '@/lib/page-api-session';

export type PageFetchOpts = {
  signal?: AbortSignal;
  offlineFallback?: boolean;
};

export type PageFetchResult = { fromApi: boolean };

/** wrapLoad 上下文为 localOnly 时跳过 REST，只读本地 */
export function shouldFetchPageFromApi(): boolean {
  return getActivePageApiReadOpts()?.localOnly !== true;
}

export function asRecordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x),
  );
}

/** 将 page API 返回的行灌入本地 SQLite（带表级锁） */
export async function upsertPageRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  await withApiTableSyncLock(table, async () => {
    await syncApiReadResultToLocal(table, rows);
  });
}

export type FetchPageParams<TPayload, TResult extends PageFetchResult> = {
  /** 日志前缀，如 profile / review / finance */
  domain: string;
  /** 操作名，如 memo-list / catalog */
  op: string;
  opts?: PageFetchOpts;
  /** 为 false 时即使 localOnly 也强制拉 REST（少数强制刷新场景） */
  respectLocalOnly?: boolean;
  fetch: (signal?: AbortSignal) => Promise<TPayload>;
  apply: (payload: TPayload) => Promise<TResult> | TResult;
  /** 离线回退时的结果；默认 { fromApi: false } */
  fallback?: () => TResult | Promise<TResult>;
};

/**
 * 统一 page 拉取：可选跳过 localOnly → REST → apply 灌库 → 失败时 offlineFallback。
 */
export async function fetchPage<TPayload, TResult extends PageFetchResult>(
  params: FetchPageParams<TPayload, TResult>,
): Promise<TResult> {
  const respectLocalOnly = params.respectLocalOnly !== false;
  if (respectLocalOnly && !shouldFetchPageFromApi()) {
    return (params.fallback ? await params.fallback() : ({ fromApi: false } as TResult));
  }

  try {
    const payload = await params.fetch(params.opts?.signal);
    return await params.apply(payload);
  } catch (e) {
    if (params.opts?.offlineFallback === false) throw e;
    console.warn(`[${params.domain}-page-api] ${params.op} 失败，回退本地`, e);
    return params.fallback ? await params.fallback() : ({ fromApi: false } as TResult);
  }
}
