export type CompletionReward =
  | { kind: 'none' }
  | { kind: 'wish'; wish_item_id: string }
  | { kind: 'custom'; label: string };

export const DEFAULT_COMPLETION_REWARD: CompletionReward = { kind: 'none' };
