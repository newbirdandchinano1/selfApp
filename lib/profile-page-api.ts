/**
 * 我的 Tab / 画像子页专用 REST：灌入本地 SQLite 后供仓库只读。
 * 失败时只回退本地，禁止降级 `/api/data/*` 全表 List。
 */
import {
  apiGetProfileMemoList,
  apiGetProfileRecipes,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { getActivePageApiReadOpts } from '@/lib/page-api-session';

function asRecordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
}

/** wrapLoad 上下文为 localOnly 时跳过 REST，只读本地 */
export function shouldFetchProfileFromApi(): boolean {
  return getActivePageApiReadOpts()?.localOnly !== true;
}

async function upsertProfileRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  await withApiTableSyncLock(table, async () => {
    await syncApiReadResultToLocal(table, rows);
  });
}

/** 备忘录列表子页 */
export async function fetchProfileMemoList(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<{ fromApi: boolean }> {
  if (!shouldFetchProfileFromApi()) return { fromApi: false };
  try {
    const payload = await apiGetProfileMemoList({ signal: opts?.signal });
    await Promise.all([
      upsertProfileRows('memo_dimensions', asRecordArray(payload.dimensions)),
      upsertProfileRows('memos', asRecordArray(payload.memos)),
    ]);
    return { fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[profile-page-api] memo-list 失败，回退本地', e);
    return { fromApi: false };
  }
}

/** 我的菜谱子页 */
export async function fetchProfileRecipes(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<{ fromApi: boolean }> {
  if (!shouldFetchProfileFromApi()) return { fromApi: false };
  try {
    const payload = await apiGetProfileRecipes({ signal: opts?.signal });
    await Promise.all([
      upsertProfileRows('recipe_categories', asRecordArray(payload.categories)),
      upsertProfileRows('recipe_items', asRecordArray(payload.items ?? payload.recipes)),
    ]);
    return { fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[profile-page-api] recipes 失败，回退本地', e);
    return { fromApi: false };
  }
}
