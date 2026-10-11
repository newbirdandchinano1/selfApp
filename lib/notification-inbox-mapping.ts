/**
 * 通知 category → 底部 Tab moduleTab（角标落点）。
 * 与 `notification-catalog` / 构建步骤 §1.3 对齐。
 */

import type { NotificationCategoryId } from './notification-catalog';
import type { NotificationModuleTab } from './repositories/notifications/notification-inbox.types';

const CATEGORY_MODULE_TAB: Record<NotificationCategoryId, NotificationModuleTab> = {
  'health-intake-reminder': 'index',
  'habit-reminder': 'tasks',
  'schedule-slot-reminder': 'tasks',
  'daily-review-reminder': 'review',
  'auto-ledger': 'finance',
};

/** 未知 / remote 默认落 profile（「我的」Tab 本期不打角标，仅参与铃铛聚合）。 */
export function moduleTabForNotificationCategory(
  category: string | null | undefined,
): NotificationModuleTab {
  const key = String(category ?? '').trim();
  if (key && Object.prototype.hasOwnProperty.call(CATEGORY_MODULE_TAB, key)) {
    return CATEGORY_MODULE_TAB[key as NotificationCategoryId];
  }
  return 'profile';
}
