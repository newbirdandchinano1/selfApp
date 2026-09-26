/**
 * 我的 Tab / 画像子页专用 REST：灌入本地 SQLite 后供仓库只读。
 * 失败时只回退本地，禁止降级 `/api/data/*` 全表 List。
 */
import {
  apiGetProfileMemoList,
  apiGetProfileRecipes,
  apiGetProfileWishBoard,
} from '@/lib/api-client';
import {
  asRecordArray,
  fetchPage,
  shouldFetchPageFromApi,
  upsertPageRows,
} from '@/lib/page-api-fetch';

/** @deprecated 使用 shouldFetchPageFromApi */
export function shouldFetchProfileFromApi(): boolean {
  return shouldFetchPageFromApi();
}

/** 备忘录列表子页 */
export async function fetchProfileMemoList(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<{ fromApi: boolean }> {
  return fetchPage({
    domain: 'profile',
    op: 'memo-list',
    opts,
    fetch: (signal) => apiGetProfileMemoList({ signal }),
    apply: async (payload) => {
      await Promise.all([
        upsertPageRows('memos', asRecordArray(payload.memos)),
        upsertPageRows('tags', asRecordArray(payload.tags)),
        upsertPageRows('tag_links', asRecordArray(payload.tagLinks)),
      ]);
      return { fromApi: true };
    },
  });
}

/** 心愿板子页 */
export async function fetchProfileWishBoard(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<{ fromApi: boolean }> {
  return fetchPage({
    domain: 'profile',
    op: 'wish-board',
    opts,
    fetch: (signal) => apiGetProfileWishBoard({ signal }),
    apply: async (payload) => {
      await Promise.all([
        upsertPageRows('points_wallet', asRecordArray(payload.pointsWallet ?? payload.wallet)),
        upsertPageRows('wish_board_items', asRecordArray(payload.items ?? payload.wishBoardItems)),
        upsertPageRows('points_ledger', asRecordArray(payload.pointsLedger ?? payload.ledger)),
      ]);
      return { fromApi: true };
    },
  });
}

/** 我的菜谱子页 */
export async function fetchProfileRecipes(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<{ fromApi: boolean }> {
  return fetchPage({
    domain: 'profile',
    op: 'recipes',
    opts,
    fetch: (signal) => apiGetProfileRecipes({ signal }),
    apply: async (payload) => {
      await Promise.all([
        upsertPageRows('recipe_categories', asRecordArray(payload.categories)),
        upsertPageRows('recipe_items', asRecordArray(payload.items ?? payload.recipes)),
      ]);
      return { fromApi: true };
    },
  });
}
