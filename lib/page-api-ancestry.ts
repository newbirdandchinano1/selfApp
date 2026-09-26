import { TAB_PAGE_KEYS } from '@/lib/page-api-scope';

/**
 * 子页面 → 直接父页面（可多个）。沿父链向上遍历即得所有祖先。
 * pageKey 与各屏幕 PAGE_API_KEY 一致。Tab 常量来自 page-api-scope（唯一来源）。
 */
const PAGE_PARENTS: Record<string, string[]> = {
  // —— 健康 ——
  'intake-history': [TAB_PAGE_KEYS.health],
  'intake-record-detail': ['intake-history', TAB_PAGE_KEYS.health],
  'quick-add-edit': [TAB_PAGE_KEYS.health],

  // —— 任务 ——
  'add-task': [TAB_PAGE_KEYS.tasks],
  'edit-task': ['task-detail', 'add-task', TAB_PAGE_KEYS.tasks],
  'add-project': [TAB_PAGE_KEYS.tasks],
  'edit-project': [TAB_PAGE_KEYS.tasks],
  'task-detail': [TAB_PAGE_KEYS.tasks],
  'tasks-calendar': [TAB_PAGE_KEYS.tasks],
  'tasks-overview': [TAB_PAGE_KEYS.tasks],
  'habit-manage': [TAB_PAGE_KEYS.tasks],
  'habit-detail': ['habit-manage', TAB_PAGE_KEYS.tasks],
  'add-habit': ['habit-manage', TAB_PAGE_KEYS.tasks],
  'habit-context': ['habit-manage', TAB_PAGE_KEYS.tasks],
  'category-sort': [TAB_PAGE_KEYS.tasks],

  // —— 财务 ——
  'add-account': [TAB_PAGE_KEYS.finance],
  'account-detail': [TAB_PAGE_KEYS.finance],
  'assets': [TAB_PAGE_KEYS.finance],
  'scheduled-expenses': [TAB_PAGE_KEYS.finance],
  'add-scheduled-expense': ['scheduled-expenses', TAB_PAGE_KEYS.finance],
  'finance-calendar': [TAB_PAGE_KEYS.finance],
  'finance-stats': [TAB_PAGE_KEYS.finance],
  'cash-flow': [TAB_PAGE_KEYS.finance],
  'auto-ledger': [TAB_PAGE_KEYS.finance],

  // —— 我的 / 个人 ——
  'edit-profile': [TAB_PAGE_KEYS.profile],
  'memo-list': [TAB_PAGE_KEYS.profile],
  'memo-view': ['memo-list', TAB_PAGE_KEYS.profile],
  'memo-edit': ['memo-view', 'memo-list', TAB_PAGE_KEYS.profile],
  'points-ledger': [TAB_PAGE_KEYS.profile],
  'wish-board': [TAB_PAGE_KEYS.profile],
  'edit-wish-board-item': ['wish-board', TAB_PAGE_KEYS.profile],
  'my-recipes': [TAB_PAGE_KEYS.profile],
  'recipe-view': ['my-recipes', TAB_PAGE_KEYS.profile],
  'recipe-edit': ['recipe-view', 'my-recipes', TAB_PAGE_KEYS.profile],

  // —— 复盘 ——
  'daily-review': [TAB_PAGE_KEYS.review],
  'daily-review-edit': ['daily-review', TAB_PAGE_KEYS.review],
  'daily-review-dimension-detail': [TAB_PAGE_KEYS.review],
  'weekly-review-form': [TAB_PAGE_KEYS.review],
  'weekly-review': [TAB_PAGE_KEYS.review],
  'weekly-review-dimension-detail': [TAB_PAGE_KEYS.review],
  'monthly-review-dimension-detail': [TAB_PAGE_KEYS.review],
  'review-settings': [TAB_PAGE_KEYS.review],
  'review-calendar': [TAB_PAGE_KEYS.review],
  'review-template-settings': [TAB_PAGE_KEYS.review],
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
