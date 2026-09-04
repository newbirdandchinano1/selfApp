/**
 * App 内本地通知类型目录：用于设置侧边栏统一展示来源与跳转。
 */

export type NotificationCategoryId =
  | 'task-reminder'
  | 'habit-reminder'
  | 'daily-review-reminder'
  | 'auto-ledger';

export type NotificationCategoryMeta = {
  id: NotificationCategoryId;
  /** 通知频道/类型标题 */
  title: string;
  /** 来源功能名 */
  sourceLabel: string;
  /** 简短说明 */
  description: string;
  /** 自定义入口文案 */
  customizeLabel: string;
  /** 跳转路径（expo-router） */
  customizeHref: string;
  /** 标识符前缀（即时通知可为空） */
  identifierPrefix: string | null;
};

export const NOTIFICATION_CATEGORIES: readonly NotificationCategoryMeta[] = [
  {
    id: 'task-reminder',
    title: '待办提醒',
    sourceLabel: '任务',
    description: '未完成待办在截止日前按你设置的「当天 / 提前 N 天」触发。',
    customizeLabel: '在任务详情中设置提醒',
    customizeHref: '/tasks',
    identifierPrefix: 'selfapp-task-reminder:',
  },
  {
    id: 'habit-reminder',
    title: '习惯打卡提醒',
    sourceLabel: '习惯',
    description: '已开启提醒的习惯，在打卡日按设定时刻本地推送。',
    customizeLabel: '在习惯详情中设置提醒时间',
    customizeHref: '/habit-manage',
    identifierPrefix: 'selfapp-habit-reminder:',
  },
  {
    id: 'daily-review-reminder',
    title: '每日复盘提醒',
    sourceLabel: '复盘',
    description: '每日固定时刻提醒填写日复盘（已填写或周复盘日会跳过）。',
    customizeLabel: '在复盘设置中开关与改时间',
    customizeHref: '/review-settings',
    identifierPrefix: 'selfapp-daily-review-reminder',
  },
  {
    id: 'auto-ledger',
    title: '截图记账通知',
    sourceLabel: '财务',
    description: '截图记账成功提示或失败时的即时本地通知（无预约队列）。',
    customizeLabel: '前往截图记账',
    customizeHref: '/auto-ledger',
    identifierPrefix: null,
  },
] as const;

export function getNotificationCategoryMeta(
  id: NotificationCategoryId,
): NotificationCategoryMeta {
  const found = NOTIFICATION_CATEGORIES.find(c => c.id === id);
  if (!found) {
    return NOTIFICATION_CATEGORIES[0];
  }
  return found;
}

export function resolveNotificationCategoryFromIdentifier(
  identifier: string,
): NotificationCategoryId | null {
  const id = identifier.trim();
  if (!id) return null;
  for (const cat of NOTIFICATION_CATEGORIES) {
    if (!cat.identifierPrefix) continue;
    if (cat.identifierPrefix.endsWith(':')) {
      if (id.startsWith(cat.identifierPrefix)) return cat.id;
    } else if (id === cat.identifierPrefix || id.startsWith(`${cat.identifierPrefix}:`)) {
      return cat.id;
    }
  }
  return null;
}

export function resolveNotificationCategoryFromData(
  data: unknown,
): NotificationCategoryId | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const type = (data as Record<string, unknown>).type;
  if (type === 'task-reminder') return 'task-reminder';
  if (type === 'habit-reminder') return 'habit-reminder';
  if (type === 'daily-review-reminder') return 'daily-review-reminder';
  if (type === 'auto-ledger' || type === 'auto-ledger-hint' || type === 'auto-ledger-failure') {
    return 'auto-ledger';
  }
  return null;
}

export function extractEntityIdFromIdentifier(
  category: NotificationCategoryId,
  identifier: string,
): string | null {
  const meta = getNotificationCategoryMeta(category);
  const prefix = meta.identifierPrefix;
  if (!prefix) return null;
  if (prefix.endsWith(':')) {
    const rest = identifier.slice(prefix.length).trim();
    return rest || null;
  }
  return null;
}
