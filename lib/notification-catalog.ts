/**
 * App 内本地通知类型目录：用于通知管理页展示来源与跳转。
 * 设置 UI 按「页面频道」分组（健康 / 财务 / 任务 / 复盘），底层仍按具体类别登记。
 */

import { stripReminderAccessorySuffix } from './notification-strong-reminder';

export type NotificationCategoryId =
  | 'health-intake-reminder'
  | 'schedule-slot-reminder'
  | 'task-deadline-reminder'
  | 'project-progress-reminder'
  | 'habit-reminder'
  | 'daily-review-reminder'
  | 'weekly-review-reminder'
  | 'auto-ledger'
  | 'finance-scheduled-expense-reminder'
  | 'finance-budget-threshold-reminder'
  | 'finance-savings-nudge-reminder'
  | 'finance-ledger-wrap-reminder';

/** 提醒设置列表上的页面级频道 */
export type NotificationPageChannelId = 'health' | 'finance' | 'tasks' | 'review';

export type NotificationCategoryMeta = {
  id: NotificationCategoryId;
  /** 所属页面频道 */
  pageId: NotificationPageChannelId;
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

export type NotificationPageChannelMeta = {
  id: NotificationPageChannelId;
  emoji: string;
  title: string;
  hint: string;
  /** 该页下的通知类别（并入详情） */
  categoryIds: readonly NotificationCategoryId[];
  customizeHref: string;
};

export const NOTIFICATION_PAGE_CHANNELS: readonly NotificationPageChannelMeta[] = [
  {
    id: 'health',
    emoji: '💧',
    title: '健康页',
    hint: '餐次 / 收口 / 水分提醒',
    categoryIds: ['health-intake-reminder'],
    customizeHref: '/notification-channel/health',
  },
  {
    id: 'finance',
    emoji: '💰',
    title: '财务页',
    hint: '截图记账 · 定时支出 · 预算',
    categoryIds: [
      'auto-ledger',
      'finance-scheduled-expense-reminder',
      'finance-budget-threshold-reminder',
      'finance-savings-nudge-reminder',
      'finance-ledger-wrap-reminder',
    ],
    customizeHref: '/notification-channel/finance',
  },
  {
    id: 'tasks',
    emoji: '✅',
    title: '任务页',
    hint: '入格 · 截止 · 项目推进 · 习惯',
    categoryIds: [
      'schedule-slot-reminder',
      'task-deadline-reminder',
      'project-progress-reminder',
      'habit-reminder',
    ],
    customizeHref: '/notification-channel/tasks',
  },
  {
    id: 'review',
    emoji: '📖',
    title: '复盘页',
    hint: '日 / 周复盘提醒',
    categoryIds: ['daily-review-reminder', 'weekly-review-reminder'],
    customizeHref: '/notification-channel/review',
  },
] as const;

export const NOTIFICATION_CATEGORIES: readonly NotificationCategoryMeta[] = [
  {
    id: 'health-intake-reminder',
    pageId: 'health',
    title: '健康摄入提醒',
    sourceLabel: '健康',
    description:
      '按餐次窗口 / 傍晚收口 / 水分间隔催关注项缺口（每日最多 2 条）；可稍后再说或今日不催。',
    customizeLabel: '设置模式、关注项与免打扰',
    customizeHref: '/notification-channel/health',
    identifierPrefix: 'selfapp-health-intake-reminder:',
  },
  {
    id: 'schedule-slot-reminder',
    pageId: 'tasks',
    title: '日程表提醒',
    sourceLabel: '日程表',
    description:
      '已入格占用在开始前按类型默认提前量提醒（待办 / 项目 / 习惯可分别设置）。未入格任务不走本通道。iOS 默认为强提醒。',
    customizeLabel: '设置分类型提前量',
    customizeHref: '/notification-channel/tasks',
    identifierPrefix: 'selfapp-schedule-reminder:',
  },
  {
    id: 'task-deadline-reminder',
    pageId: 'tasks',
    title: '待办截止提醒',
    sourceLabel: '待办',
    description:
      '默认自动临期（距截止 ≤ N 天）；亦可自定义提前天数。过期未完成可推「今日滞留」。完成 / 搁置 / 取消后取消预约。',
    customizeLabel: '在日程里设截止提醒',
    customizeHref: '/notification-channel/tasks',
    identifierPrefix: 'selfapp-task-deadline-reminder:',
  },
  {
    id: 'project-progress-reminder',
    pageId: 'tasks',
    title: '项目推进提醒',
    sourceLabel: '项目',
    description:
      '活跃项目若多日无入格时段，按滞留节奏催「推进」；暂停 / 归档静默。与入格轻提醒分通道。',
    customizeLabel: '设置滞留天数',
    customizeHref: '/notification-channel/tasks',
    identifierPrefix: 'selfapp-project-progress-reminder:',
  },
  {
    id: 'habit-reminder',
    pageId: 'tasks',
    title: '习惯打卡提醒',
    sourceLabel: '习惯',
    description:
      '轻：到点一次；标准：到点 + 未完成傍晚收口；强：到点强提醒并可再催。养成看日目标，戒除看当日是否已标记。',
    customizeLabel: '设置习惯提醒时间与强度',
    customizeHref: '/notification-channel/tasks',
    identifierPrefix: 'selfapp-habit-reminder:',
  },
  {
    id: 'daily-review-reminder',
    pageId: 'review',
    title: '每日复盘提醒',
    sourceLabel: '复盘',
    description: '每日固定时刻提醒填写日复盘（已填写或周复盘日会跳过）。iOS 为强提醒：Time Sensitive、未确认会再次提醒。',
    customizeLabel: '设置日复盘提醒',
    customizeHref: '/notification-channel/review',
    identifierPrefix: 'selfapp-daily-review-reminder',
  },
  {
    id: 'weekly-review-reminder',
    pageId: 'review',
    title: '周复盘提醒',
    sourceLabel: '复盘',
    description: '在配置的周复盘日固定时刻提醒填写周刊（已填写则跳过）；该日不推日复盘提醒。',
    customizeLabel: '设置周复盘提醒',
    customizeHref: '/notification-channel/review',
    identifierPrefix: 'selfapp-weekly-review-reminder',
  },
  {
    id: 'auto-ledger',
    pageId: 'finance',
    title: '截图记账通知',
    sourceLabel: '财务',
    description: '截图记账成功提示或失败时的即时本地通知（无预约队列）。',
    customizeLabel: '截图记账频道设置',
    customizeHref: '/notification-channel/finance',
    identifierPrefix: null,
  },
  {
    id: 'finance-scheduled-expense-reminder',
    pageId: 'finance',
    title: '定时支出提醒',
    sourceLabel: '定时支出',
    description:
      '应记日按设定时刻前提醒；当日未入账可傍晚再收口一次。自动入账或关闭规则后取消。',
    customizeLabel: '设置提前量与收口',
    customizeHref: '/notification-channel/finance',
    identifierPrefix: 'selfapp-finance-scheduled-expense:',
  },
  {
    id: 'finance-budget-threshold-reminder',
    pageId: 'finance',
    title: '预算阈值提醒',
    sourceLabel: '预算',
    description: '本周期预算越过 50% / 80% / 超支时各推一次（可关档），不每日吵。',
    customizeLabel: '设置阈值档位',
    customizeHref: '/notification-channel/finance',
    identifierPrefix: 'selfapp-finance-budget-threshold:',
  },
  {
    id: 'finance-savings-nudge-reminder',
    pageId: 'finance',
    title: '储蓄目标轻催',
    sourceLabel: '储蓄目标',
    description: '按每周设定时刻轻催存款进度；已达标或未设目标则跳过。',
    customizeLabel: '设置每周轻催时刻',
    customizeHref: '/notification-channel/finance',
    identifierPrefix: 'selfapp-finance-savings-nudge',
  },
  {
    id: 'finance-ledger-wrap-reminder',
    pageId: 'finance',
    title: '未记账收口',
    sourceLabel: '记账',
    description: '傍晚若当日仍无流水则提醒记一笔；已有流水或今日不催则跳过。',
    customizeLabel: '设置收口时刻',
    customizeHref: '/notification-channel/finance',
    identifierPrefix: 'selfapp-finance-ledger-wrap',
  },
] as const;

export function getNotificationPageChannelMeta(
  id: NotificationPageChannelId,
): NotificationPageChannelMeta {
  const found = NOTIFICATION_PAGE_CHANNELS.find((c) => c.id === id);
  return found ?? NOTIFICATION_PAGE_CHANNELS[0];
}

export function isNotificationPageChannelId(raw: string): raw is NotificationPageChannelId {
  return NOTIFICATION_PAGE_CHANNELS.some((c) => c.id === raw);
}

/** 旧类别深链 / 参数 → 页面频道 */
export function resolveNotificationPageChannelId(
  raw: string,
): NotificationPageChannelId | null {
  if (isNotificationPageChannelId(raw)) return raw;
  const cat = NOTIFICATION_CATEGORIES.find((c) => c.id === raw);
  return cat?.pageId ?? null;
}

export function getCategoriesForPage(
  pageId: NotificationPageChannelId,
): readonly NotificationCategoryId[] {
  return getNotificationPageChannelMeta(pageId).categoryIds;
}

/** 页面频道是否至少有一类开启（列表开关态；可选类默认关时不影响整页显示为开） */
export function isNotificationPageEnabled(
  pageId: NotificationPageChannelId,
  categories: Record<NotificationCategoryId, boolean>,
): boolean {
  const ids = getCategoriesForPage(pageId);
  return ids.some((id) => categories[id] !== false);
}

export function getNotificationCategoryMeta(
  id: NotificationCategoryId,
): NotificationCategoryMeta {
  const found = NOTIFICATION_CATEGORIES.find(c => c.id === id);
  if (!found) {
    return NOTIFICATION_CATEGORIES[0];
  }
  return found;
}

/** 按 catalog 前缀拼 identifier（无前缀的类别返回 null）。 */
export function buildNotificationIdentifier(
  category: NotificationCategoryId,
  entityKey: string,
): string | null {
  const prefix = getNotificationCategoryMeta(category).identifierPrefix;
  if (!prefix) return null;
  const key = entityKey.trim();
  if (!key) return prefix.endsWith(':') ? null : prefix;
  return prefix.endsWith(':') ? `${prefix}${key}` : `${prefix}:${key}`;
}

export function resolveNotificationCategoryFromIdentifier(
  identifier: string,
): NotificationCategoryId | null {
  const id = stripReminderAccessorySuffix(identifier);
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
  if (type === 'health-intake-reminder') return 'health-intake-reminder';
  if (type === 'schedule-slot-reminder') return 'schedule-slot-reminder';
  if (type === 'task-deadline-reminder') return 'task-deadline-reminder';
  if (type === 'project-progress-reminder') return 'project-progress-reminder';
  if (type === 'habit-reminder') return 'habit-reminder';
  if (type === 'daily-review-reminder') return 'daily-review-reminder';
  if (type === 'weekly-review-reminder') return 'weekly-review-reminder';
  if (type === 'auto-ledger' || type === 'auto-ledger-hint' || type === 'auto-ledger-failure') {
    return 'auto-ledger';
  }
  if (type === 'finance-scheduled-expense-reminder') return 'finance-scheduled-expense-reminder';
  if (type === 'finance-budget-threshold-reminder') return 'finance-budget-threshold-reminder';
  if (type === 'finance-savings-nudge-reminder') return 'finance-savings-nudge-reminder';
  if (type === 'finance-ledger-wrap-reminder') return 'finance-ledger-wrap-reminder';
  return null;
}

export function extractEntityIdFromIdentifier(
  category: NotificationCategoryId,
  identifier: string,
): string | null {
  const meta = getNotificationCategoryMeta(category);
  const prefix = meta.identifierPrefix;
  if (!prefix) return null;
  const id = stripReminderAccessorySuffix(identifier);
  if (prefix.endsWith(':')) {
    const rest = id.slice(prefix.length).trim();
    return rest || null;
  }
  return null;
}
