/**
 * 我的 / 画像子页专用接口。
 */
import { apiRequest } from '@/lib/api/http';

export type ProfilePageMeta = {
  serverTime?: string;
  catalogComplete?: boolean;
};

/** GET /api/app/pages/profile/memo-list */
export type ProfileMemoListPayload = {
  memos: Record<string, unknown>[];
  tags?: Record<string, unknown>[];
  tagLinks?: Record<string, unknown>[];
  /** @deprecated 维度已下线 */
  dimensions?: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileMemoList(params?: {
  signal?: AbortSignal;
}): Promise<ProfileMemoListPayload> {
  return apiRequest<ProfileMemoListPayload>('/api/app/pages/profile/memo-list', {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/app/pages/profile/recipes */
export type ProfileRecipesPayload = {
  categories: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  recipes?: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileRecipes(params?: {
  signal?: AbortSignal;
}): Promise<ProfileRecipesPayload> {
  return apiRequest<ProfileRecipesPayload>('/api/app/pages/profile/recipes', {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/app/pages/profile/wish-board */
export type ProfileWishBoardPayload = {
  pointsWallet?: Record<string, unknown>[];
  wallet?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  wishBoardItems?: Record<string, unknown>[];
  pointsLedger?: Record<string, unknown>[];
  ledger?: Record<string, unknown>[];
  meta?: ProfilePageMeta;
};

export async function apiGetProfileWishBoard(params?: {
  signal?: AbortSignal;
}): Promise<ProfileWishBoardPayload> {
  return apiRequest<ProfileWishBoardPayload>('/api/app/pages/profile/wish-board', {
    method: 'GET',
    signal: params?.signal,
  });
}

