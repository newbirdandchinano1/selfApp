/**
 * 我的 Tab / 画像子页专用 REST：灌入本地 SQLite 后供仓库只读。
 * 失败时只回退本地，禁止降级 `/api/data/*` 全表 List。
 */
import {
  apiGetProfileHome,
  apiGetProfileMemoList,
  apiGetProfileRecipes,
  apiGetProfileVisionWall,
  apiGetProfileWishBoard,
  apiGetProfileWishList,
  type ProfileHomePayload,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { getActivePageApiReadOpts } from '@/lib/page-api-session';
import type { UserRow } from '@/lib/repositories/users/user.types';
import type { VisionRow } from '@/lib/repositories/visions/vision.types';
import type { WishItemRow } from '@/lib/repositories/wish-list/wish-list.types';

/** 与 ProfileScreen 预览条数一致 */
export const PROFILE_WISH_PREVIEW_LIMIT = 12;

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

export type ProfileHomeData = {
  user: UserRow | null;
  visions: VisionRow[];
  wishPreview: WishItemRow[];
  fromApi: boolean;
};

/** Tab 冷启动 / 下拉：用户 + 愿景轮播 + 心愿预览 */
export async function fetchProfileHome(opts?: {
  wishPreviewLimit?: number;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ProfileHomeData> {
  if (!shouldFetchProfileFromApi()) {
    return { user: null, visions: [], wishPreview: [], fromApi: false };
  }
  try {
    const payload: ProfileHomePayload = await apiGetProfileHome({
      wishPreviewLimit: opts?.wishPreviewLimit ?? PROFILE_WISH_PREVIEW_LIMIT,
      signal: opts?.signal,
    });
    const user =
      payload.user && typeof payload.user === 'object'
        ? (payload.user as UserRow)
        : null;
    const visions = asRecordArray(payload.visions) as VisionRow[];
    const wishPreview = asRecordArray(payload.wishPreview ?? payload.wishItems) as WishItemRow[];

    await Promise.all([
      user ? upsertProfileRows('users', [user as Record<string, unknown>]) : Promise.resolve(),
      upsertProfileRows('visions', visions as Record<string, unknown>[]),
      upsertProfileRows('wish_items', wishPreview as Record<string, unknown>[]),
    ]);

    return { user, visions, wishPreview, fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[profile-page-api] home 失败，回退本地', e);
    return { user: null, visions: [], wishPreview: [], fromApi: false };
  }
}

/** 心愿清单子页 */
export async function fetchProfileWishList(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<{ fromApi: boolean }> {
  if (!shouldFetchProfileFromApi()) return { fromApi: false };
  try {
    const payload = await apiGetProfileWishList({ signal: opts?.signal });
    await Promise.all([
      upsertProfileRows('wish_items', asRecordArray(payload.wishItems)),
      upsertProfileRows('savings_plans', asRecordArray(payload.savingsPlans)),
      upsertProfileRows('savings_plan_deposits', asRecordArray(payload.savingsDeposits)),
    ]);
    return { fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[profile-page-api] wish-list 失败，回退本地', e);
    return { fromApi: false };
  }
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

/** 愿景墙子页 */
export async function fetchProfileVisionWall(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<{ fromApi: boolean }> {
  if (!shouldFetchProfileFromApi()) return { fromApi: false };
  try {
    const payload = await apiGetProfileVisionWall({ signal: opts?.signal });
    const user =
      payload.user && typeof payload.user === 'object'
        ? (payload.user as UserRow)
        : null;
    await Promise.all([
      user ? upsertProfileRows('users', [user as Record<string, unknown>]) : Promise.resolve(),
      upsertProfileRows('visions', asRecordArray(payload.visions)),
      upsertProfileRows('goal_dimensions', asRecordArray(payload.goalDimensions ?? payload.dimensions)),
    ]);
    return { fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[profile-page-api] vision-wall 失败，回退本地', e);
    return { fromApi: false };
  }
}

/** 积分看板子页 */
export async function fetchProfileWishBoard(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<{ fromApi: boolean }> {
  if (!shouldFetchProfileFromApi()) return { fromApi: false };
  try {
    const payload = await apiGetProfileWishBoard({ signal: opts?.signal });
    await Promise.all([
      upsertProfileRows('points_wallet', asRecordArray(payload.pointsWallet ?? payload.wallet)),
      upsertProfileRows('wish_board_items', asRecordArray(payload.items ?? payload.wishBoardItems)),
      upsertProfileRows('points_ledger', asRecordArray(payload.pointsLedger ?? payload.ledger)),
    ]);
    return { fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[profile-page-api] wish-board 失败，回退本地', e);
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
