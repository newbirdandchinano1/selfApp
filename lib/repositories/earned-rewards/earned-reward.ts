import { getDatabase } from '../../database.native';
import type { CompletionReward } from '@/lib/completion-reward/completion-reward.types';
import { parseCompletionRewardFromExtraData } from '@/lib/completion-reward/completion-reward-extra';
import { getWishItemById } from '../wish-list/wish-list';
import { setWishItemFulfilled } from '../wish-list/wish-list';
import type { EarnedRewardRow } from './earned-reward.types';

export function createEarnedRewardId(): string {
  return `erwd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
  sourceType: 'task' | 'project',
  sourceId: string,
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(1) AS c FROM earned_rewards
     WHERE source_type = ? AND source_id = ? AND deleted_at IS NULL`,
    [sourceType, sourceId],
  );
  return (row?.c ?? 0) > 0;
}

export async function grantEarnedRewardFromExtraData(input: {
  sourceType: 'task' | 'project';
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
      earned_at, redeemed_at, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
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

  return db.getFirstAsync<EarnedRewardRow>(
    'SELECT * FROM earned_rewards WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id],
  );
}

export async function listEarnedRewards(): Promise<EarnedRewardRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<EarnedRewardRow>(
    `SELECT * FROM earned_rewards
     WHERE deleted_at IS NULL
     ORDER BY redeemed_at IS NOT NULL ASC, datetime(earned_at) DESC`,
  );
}

export async function redeemEarnedReward(id: string): Promise<void> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<EarnedRewardRow>(
    'SELECT * FROM earned_rewards WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id],
  );
  if (!row || row.redeemed_at) return;

  await db.runAsync(
    `UPDATE earned_rewards SET
      redeemed_at = datetime('now'),
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
      version = version + 1
    WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );

  if (row.wish_item_id) {
    await setWishItemFulfilled(row.wish_item_id, true);
  }
}

export async function unredeemEarnedReward(id: string): Promise<void> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<EarnedRewardRow>(
    'SELECT * FROM earned_rewards WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id],
  );
  if (!row || !row.redeemed_at) return;

  await db.runAsync(
    `UPDATE earned_rewards SET
      redeemed_at = NULL,
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
      version = version + 1
    WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );

  if (row.wish_item_id) {
    await setWishItemFulfilled(row.wish_item_id, false);
  }
}
