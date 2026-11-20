/**
 * S9.3 W2：commit_wish（动态 import）。禁止兑换。
 * W3：commit_wish_delete / commit_points_ledger_delete（须确认卡）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

function asWishType(raw: unknown): 'once' | 'repeat' {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'repeat' || s === '重复' || s === '可重复' || s === 'repeated') return 'repeat';
  return 'once';
}

function hasOwn(draft: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some(k => Object.prototype.hasOwnProperty.call(draft, k));
}

async function resolveWishRef(
  draft: Record<string, unknown>,
): Promise<{ id: string; title: string } | { error: string }> {
  let wishId =
    draftString(draft, 'wish_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'item_id') ||
    draftString(draft, 'wishId');
  const titleHint =
    draftString(draft, 'title') ||
    draftString(draft, 'wish_title') ||
    draftString(draft, 'name') ||
    draftString(draft, 'locate_title') ||
    draftString(draft, 'original_title');

  if (!wishId && titleHint) {
    const { listWishBoardItems } = await import('@/lib/repositories/wish-board/wish-board');
    const rows = await listWishBoardItems();
    const needle = titleHint.toLowerCase();
    const exact = rows.filter(r => r.title.trim().toLowerCase() === needle);
    const partial =
      exact.length > 0
        ? exact
        : rows.filter(r => r.title.trim().toLowerCase().includes(needle));
    if (partial.length === 1) {
      wishId = partial[0].id;
      return { id: wishId, title: partial[0].title || titleHint };
    }
    if (partial.length > 1) {
      return { error: `找到多条「${titleHint}」相关心愿，请先选定一条` };
    }
    return { error: `找不到心愿「${titleHint}」` };
  }

  if (!wishId) return { error: '请指定要删除的心愿' };

  const { getWishBoardItemById } = await import('@/lib/repositories/wish-board/wish-board');
  const row = await getWishBoardItemById(wishId);
  if (!row) return { error: titleHint ? `找不到心愿「${titleHint}」` : '找不到该心愿' };
  return { id: row.id, title: row.title || titleHint || wishId };
}

export async function commitWish(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  // 红线：任何兑换意图直接拒绝
  const actionHint = draftString(draft, 'action') || draftString(draft, 'intent');
  if (/redeem|兑换|兑奖/.test(actionHint)) {
    return fail('forbidden', '心愿兑换不能由助手执行，请打开心愿板手动操作');
  }

  const { createWishBoardItem, updateWishBoardItem, getWishBoardItemById } = await import(
    '@/lib/repositories/wish-board/wish-board'
  );

  let existingId =
    draftString(draft, 'wish_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'item_id');
  const locateTitle =
    draftString(draft, 'locate_title') ||
    draftString(draft, 'original_title') ||
    draftString(draft, 'title') ||
    draftString(draft, 'name');

  if (!existingId && locateTitle) {
    const ref = await resolveWishRef({
      ...draft,
      title: locateTitle,
      wish_id: undefined,
      id: undefined,
      item_id: undefined,
    });
    if (!('error' in ref)) existingId = ref.id;
  }

  const title = draftString(draft, 'title') || draftString(draft, 'name');
  const hasDescription = hasOwn(draft, 'description', 'description_text', 'note');
  const description = hasDescription
    ? draftString(draft, 'description') ||
      draftString(draft, 'description_text') ||
      draftString(draft, 'note') ||
      null
    : undefined;
  const hasCost = hasOwn(draft, 'cost_points', 'cost', 'points', 'price');
  const costRaw = draftNumber(draft, 'cost_points') ?? draftNumber(draft, 'cost');
  const hasIcon = hasOwn(draft, 'icon_key');
  const icon_key = hasIcon ? draftString(draft, 'icon_key') || null : undefined;
  const hasType = hasOwn(draft, 'wish_type', 'type');
  const wish_type = hasType ? asWishType(draft.wish_type ?? draft.type) : undefined;

  const clearCond =
    draft.clear_redeem_conditions === true ||
    draft.clear_redeem_conditions === 'true' ||
    draft.clear_redeem_conditions === 1;
  const hasRedeem = hasOwn(draft, 'redeem_conditions') || clearCond;
  const redeemRaw = draft.redeem_conditions;
  const redeem_conditions = clearCond
    ? {
        project_ids: [],
        task_ids: [],
        todo_ids: [],
        habit_ids: [],
        min_net_worth: null,
        available_from: null,
      }
    : redeemRaw != null && typeof redeemRaw === 'object' && !Array.isArray(redeemRaw)
      ? (redeemRaw as {
          project_ids?: string[];
          task_ids?: string[];
          todo_ids?: string[];
          habit_ids?: string[];
          min_net_worth?: number | null;
          available_from?: string | null;
        })
      : undefined;

  if (existingId) {
    const current = await getWishBoardItemById(existingId);
    const nextTitle = (title || current?.title || '').slice(0, 80);
    if (!nextTitle) return fail('incomplete_draft', '缺少心愿标题');

    await updateWishBoardItem(existingId, {
      ...(title ? { title: nextTitle } : {}),
      ...(hasDescription ? { description: description ?? null } : {}),
      ...(hasCost && costRaw != null && costRaw >= 0
        ? { cost_points: Math.floor(costRaw) }
        : {}),
      ...(hasIcon ? { icon_key: icon_key ?? null } : {}),
      ...(hasType && wish_type ? { wish_type } : {}),
      ...(hasRedeem ? { redeem_conditions: redeem_conditions ?? null } : {}),
    });
    await requestPushPending();
    return ok(existingId, `已更新心愿「${nextTitle.slice(0, 40)}」`);
  }

  if (!title) {
    return fail('incomplete_draft', '缺少心愿标题');
  }
  const cost_points = costRaw != null && costRaw >= 0 ? Math.floor(costRaw) : 0;
  const id = await createWishBoardItem({
    title: title.slice(0, 80),
    description: description ?? null,
    cost_points,
    icon_key: icon_key ?? null,
    wish_type: wish_type ?? 'once',
    ...(hasRedeem && redeem_conditions !== undefined ? { redeem_conditions } : {}),
  });
  await requestPushPending();
  return ok(id, `已保存心愿「${title.slice(0, 40)}」`);
}

export async function commitWishDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveWishRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);

  const { deleteWishBoardItem } = await import('@/lib/repositories/wish-board/wish-board');
  try {
    await deleteWishBoardItem(ref.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除心愿失败';
    return fail('wish_delete_failed', msg);
  }
  await requestPushPending();
  return ok(ref.id, `已删除心愿「${ref.title.slice(0, 40)}」`);
}

export async function commitPointsLedgerDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ledgerId =
    draftString(draft, 'ledger_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'footprint_id');
  if (!ledgerId) return fail('incomplete_draft', '缺少足迹 ledger_id');

  const { deletePointsLedgerRecord } = await import('@/lib/repositories/points/points');
  try {
    const result = await deletePointsLedgerRecord(ledgerId);
    await requestPushPending();
    const label =
      draftString(draft, 'title') ||
      draftString(draft, 'reason') ||
      ledgerId.slice(0, 12);
    const rb = result.rollback_delta;
    const rbText =
      typeof rb === 'number' && rb !== 0
        ? `，余额回退 ${rb > 0 ? '+' : ''}${rb}`
        : '';
    return ok(ledgerId, `已删除足迹「${label.slice(0, 40)}」${rbText}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除足迹失败';
    return fail('points_ledger_delete_failed', msg);
  }
}

export const wishCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_wish: async input => commitWish(input.draft),
  commit_wish_delete: async input => commitWishDelete(input.draft),
  commit_points_ledger_delete: async input => commitPointsLedgerDelete(input.draft),
};
