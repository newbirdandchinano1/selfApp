import { readApiRecord, readApiTable } from '@/lib/api-read';
import { compareDatetimeDesc } from '@/lib/api-read-helpers';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '../../database.native';
import type { CompletionReward } from '@/lib/completion-reward/completion-reward.types';
import { parseCompletionRewardFromExtraData } from '@/lib/completion-reward/completion-reward-extra';
import { getWishItemById } from '../wish-list/wish-list';
import { setWishItemFulfilled } from '../wish-list/wish-list';
import type { EarnedRewardRow, EarnedRewardSourceType } from './earned-reward.types';

export function createEarnedRewardId(): string {
  return makeTimestampEntityId('erwd_', 8);
}

async function resolveRewardLabel(reward: CompletionReward): Promise<{ label: string; wishItemId: string | null; kind: 'wish' | 'custom' } | null> {
  if (reward.kind === 'none') return null;
  if (reward.kind === 'custom') {
    return { label: reward.label, wishItemId: null, kind: 'custom' };
  }
  const wish = await getWishItemById(reward.wish_item_id);
  return {
    label: wish?.name?.trim() || '心愿好物',
    wishItemId: reward.wish_item_id,
    kind: 'wish',
  };
}

export async function hasEarnedRewardForSource(
  sourceType: EarnedRewardSourceType,
  sourceId: string,
): Promise<boolean> {
  const rows = await readApiTable<EarnedRewardRow>('earned_rewards', { offlineFallback: true });
  return rows.some(r => r.source_type === sourceType && r.source_id === sourceId);
}

export async function grantEarnedRewardFromExtraData(input: {
  sourceType: EarnedRewardSourceType;
  sourceId: string;
  sourceTitle: string;
  extraData: string | null;
}): Promise<EarnedRewardRow | null> {
  const reward = parseCompletionRewardFromExtraData(input.extraData);
  if (reward.kind === 'none') return null;

  if (await hasEarnedRewardForSource(input.sourceType, input.sourceId)) return null;

  const resolved = await resolveRewardLabel(reward);
  if (!resolved) return null;

  const db = await getDatabase();
  const id = createEarnedRewardId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO earned_rewards (
      id, source_type, source_id, source_title, reward_kind, wish_item_id, label,
      earned_at, redeemed_at, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'), 'pending_create', NULL)`,
  [
    id,
    input.sourceType,
    input.sourceId,
    input.sourceTitle.trim() || '未命名',
    resolved.kind,
    resolved.wishItemId,
    resolved.label,
    now,
  ],
  );

  return readApiRecord<EarnedRewardRow>('earned_rewards', id, { offlineFallback: true });
}

export async function listEarnedRewards(): Promise<EarnedRewardRow[]> {
  const rows = await readApiTable<EarnedRewardRow>('earned_rewards', { offlineFallback: true });
  return [...rows].sort((a, b) => {
    const aRedeemed = a.redeemed_at != null;
    const bRedeemed = b.redeemed_at != null;
    if (aRedeemed !== bRedeemed) return aRedeemed ? 1 : -1;
    return compareDatetimeDesc(a.earned_at, b.earned_at);
  });
}

export async function redeemEarnedReward(id: string): Promise<void> {
  const db = await getDatabase();
  const row = await readApiRecord<EarnedRewardRow>('earned_rewards', id, { offlineFallback: true });
  if (!row || row.redeemed_at) return;

  await db.runAsync(
    `UPDATE earned_rewards SET
      redeemed_at = datetime('now'),
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
    WHERE id = ?`,
    [id],
  );

  if (row.wish_item_id) {
    await setWishItemFulfilled(row.wish_item_id, true);
  }
}

export async function unredeemEarnedReward(id: string): Promise<void> {
  const db = await getDatabase();
  const row = await readApiRecord<EarnedRewardRow>('earned_rewards', id, { offlineFallback: true });
  if (!row || !row.redeemed_at) return;

  await db.runAsync(
    `UPDATE earned_rewards SET
      redeemed_at = NULL,
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
    WHERE id = ?`,
    [id],
  );

  if (row.wish_item_id) {
    await setWishItemFulfilled(row.wish_item_id, false);
  }
}
