/** 与 page-api-session TAB_PAGE_KEYS 保持一致 */
const TAB = {
  health: 'tabs/index',
  tasks: 'tabs/tasks',
  finance: 'tabs/finance',
  review: 'tabs/review',
  profile: 'tabs/profile',
} as const;

/**
 * 子页面 → 直接父页面（可多个）。沿父链向上遍历即得所有祖先。
 * pageKey 与各屏幕 PAGE_API_KEY 一致。
 */
const PAGE_PARENTS: Record<string, string[]> = {
  // —— 健康 ——
  'intake-history': [TAB.health],
  'intake-record-detail': ['intake-history', TAB.health],
  'quick-add-edit': [TAB.health],

  // —— 任务 ——
  'add-task': [TAB.tasks],
  'edit-task': ['task-detail', 'add-task', TAB.tasks],
  'add-project': [TAB.tasks],
  'edit-project': [TAB.tasks],
  'add-frog': [TAB.tasks],
  'task-detail': [TAB.tasks],
  'tasks-calendar': [TAB.tasks],
  'tasks-overview': [TAB.tasks],
  'habit-manage': [TAB.tasks],
  'habit-detail': ['habit-manage', TAB.tasks],
  'add-habit': ['habit-manage', TAB.tasks],
  'habit-context': ['habit-manage', TAB.tasks],
  'category-sort': [TAB.tasks],

  // —— 财务 ——
  'add-account': [TAB.finance],
  'account-detail': [TAB.finance],
  'assets': [TAB.finance],
  'scheduled-expenses': [TAB.finance],
  'add-scheduled-expense': ['scheduled-expenses', TAB.finance],
  'finance-calendar': [TAB.finance],
  'finance-stats': [TAB.finance],
  'cash-flow': [TAB.finance],
  'auto-ledger': [TAB.finance],

  // —— 我的 / 个人 ——
  'vision-wall': [TAB.profile],
  'vision-create': ['vision-wall', TAB.profile],
  'vision-detail': ['vision-wall', TAB.profile],
  'vision-sub-goals-detail': ['vision-detail', 'vision-wall', TAB.profile],
  'memo-list': [TAB.profile],
  'memo-view': ['memo-list', TAB.profile],
  'memo-edit': ['memo-view', 'memo-list', TAB.profile],
  'wish-list': [TAB.profile],
  'add-wish-item': ['wish-list', TAB.profile],
  'edit-wish-item': ['wish-list', TAB.profile],
  'wish-board': [TAB.profile],
  'add-wish-board-item': ['wish-board', TAB.profile],
  'edit-wish-board-item': ['wish-board', TAB.profile],
  'my-recipes': [TAB.profile],
  'recipe-view': ['my-recipes', TAB.profile],
  'recipe-edit': ['recipe-view', 'my-recipes', TAB.profile],
  'edit-profile': [TAB.profile],
  'edit-goal-dimension': ['vision-wall', TAB.profile],

  // —— 复盘 ——
  'daily-review': [TAB.review],
  'daily-review-edit': ['daily-review', TAB.review],
  'daily-review-dimension-detail': [TAB.review],
  'weekly-review-form': [TAB.review],
  'weekly-review': [TAB.review],
  'weekly-review-dimension-detail': [TAB.review],
  'monthly-review-dimension-detail': [TAB.review],
  'review-settings': [TAB.review],
  'review-calendar': [TAB.review],
  'review-template-settings': [TAB.review],
};

/** 自子页面向所有祖先页面传递（去重，近亲在前） */
export function collectAncestorPageKeys(pageKey: string): string[] {
  const key = pageKey.trim();
  if (!key) return [];

  const result: string[] = [];
  const seen = new Set<string>([key]);
  const queue = [...(PAGE_PARENTS[key] ?? [])];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    result.push(cur);
    const parents = PAGE_PARENTS[cur];
    if (parents?.length) queue.push(...parents);
  }

  return result;
}
