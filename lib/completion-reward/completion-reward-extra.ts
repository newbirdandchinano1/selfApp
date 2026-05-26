import type { CompletionReward } from './completion-reward.types';
import { DEFAULT_COMPLETION_REWARD } from './completion-reward.types';

export function parseCompletionReward(raw: unknown): CompletionReward {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_COMPLETION_REWARD;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind === 'wish') {
    const wishItemId = typeof o.wish_item_id === 'string' ? o.wish_item_id.trim() : '';
    if (wishItemId) return { kind: 'wish', wish_item_id: wishItemId };
    return DEFAULT_COMPLETION_REWARD;
  }
  if (kind === 'custom') {
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (label) return { kind: 'custom', label };
    return DEFAULT_COMPLETION_REWARD;
  }
  return DEFAULT_COMPLETION_REWARD;
}

export function parseCompletionRewardFromExtraData(extraData: string | null | undefined): CompletionReward {
  if (!extraData?.trim()) return DEFAULT_COMPLETION_REWARD;
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_COMPLETION_REWARD;
    return parseCompletionReward((parsed as Record<string, unknown>).completion_reward);
  } catch {
    return DEFAULT_COMPLETION_REWARD;
  }
}

export function mergeCompletionRewardIntoExtraData(
  extraData: string | null | undefined,
  reward: CompletionReward,
): string {
  let base: Record<string, unknown> = {};
  if (extraData?.trim()) {
    try {
      const parsed = JSON.parse(extraData) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      /* keep empty base */
    }
  }
  if (reward.kind === 'none') {
    delete base.completion_reward;
  } else {
    base.completion_reward = reward;
  }
  return JSON.stringify(base);
}

export function hasCompletionReward(reward: CompletionReward): boolean {
  return reward.kind !== 'none';
}

export function formatCompletionRewardLabel(
  reward: CompletionReward,
  wishNameById?: ReadonlyMap<string, string> | null,
): string | null {
  if (reward.kind === 'none') return null;
  if (reward.kind === 'custom') return reward.label;
  const name = wishNameById?.get(reward.wish_item_id)?.trim();
  return name || '心愿好物';
}
