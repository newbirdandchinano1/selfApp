/**
 * 通知来源锚点：收件箱未读 → 业务页入口红点落点。
 * 纯规则（不落库）；聚合见 repositories/notifications/notification-inbox。
 */

import type { NotificationCategoryId } from '@/lib/notification-catalog';

/** 页内功能入口（非底部 Tab） */
export type InboxSourceAnchor =
  | 'health'
  | 'habit'
  | 'schedule'
  | 'task'
  | 'project'
  | 'daily-review'
  | 'weekly-review'
  | 'auto-ledger'
  | 'scheduled-expense'
  | 'budget'
  | 'savings'
  | 'ledger-wrap';

export type InboxEntityKind = 'habit' | 'task' | 'project' | 'scheduledExpense';

export type InboxSourceEntityRef = {
  kind: InboxEntityKind;
  id: string;
};

const CATEGORY_TO_ANCHOR: Record<NotificationCategoryId, InboxSourceAnchor> = {
  'health-intake-reminder': 'health',
  'habit-reminder': 'habit',
  'schedule-slot-reminder': 'schedule',
  'task-deadline-reminder': 'task',
  'project-progress-reminder': 'project',
  'daily-review-reminder': 'daily-review',
  'weekly-review-reminder': 'weekly-review',
  'auto-ledger': 'auto-ledger',
  'finance-scheduled-expense-reminder': 'scheduled-expense',
  'finance-budget-threshold-reminder': 'budget',
  'finance-savings-nudge-reminder': 'savings',
  'finance-ledger-wrap-reminder': 'ledger-wrap',
};

const ANCHOR_CATEGORIES: Record<InboxSourceAnchor, readonly NotificationCategoryId[]> = {
  health: ['health-intake-reminder'],
  habit: ['habit-reminder'],
  schedule: ['schedule-slot-reminder'],
  task: ['task-deadline-reminder'],
  project: ['project-progress-reminder'],
  'daily-review': ['daily-review-reminder'],
  'weekly-review': ['weekly-review-reminder'],
  'auto-ledger': ['auto-ledger'],
  'scheduled-expense': ['finance-scheduled-expense-reminder'],
  budget: ['finance-budget-threshold-reminder'],
  savings: ['finance-savings-nudge-reminder'],
  'ledger-wrap': ['finance-ledger-wrap-reminder'],
};

export const INBOX_SOURCE_ANCHORS = Object.keys(ANCHOR_CATEGORIES) as InboxSourceAnchor[];

export function emptyUnreadByAnchor(): Record<InboxSourceAnchor, number> {
  return {
    health: 0,
    habit: 0,
    schedule: 0,
    task: 0,
    project: 0,
    'daily-review': 0,
    'weekly-review': 0,
    'auto-ledger': 0,
    'scheduled-expense': 0,
    budget: 0,
    savings: 0,
    'ledger-wrap': 0,
  };
}

export function sourceAnchorForCategory(
  category: string | null | undefined,
): InboxSourceAnchor | null {
  const key = String(category ?? '').trim();
  if (!key || !Object.prototype.hasOwnProperty.call(CATEGORY_TO_ANCHOR, key)) return null;
  return CATEGORY_TO_ANCHOR[key as NotificationCategoryId];
}

export function categoriesForSourceAnchors(
  anchors: readonly InboxSourceAnchor[],
): NotificationCategoryId[] {
  const out: NotificationCategoryId[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    for (const cat of ANCHOR_CATEGORIES[anchor] ?? []) {
      if (seen.has(cat)) continue;
      seen.add(cat);
      out.push(cat);
    }
  }
  return out;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

function cleanId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/** 从通知 data / data_json 解析主体实体（供列表行红点）。 */
export function extractInboxSourceEntity(data: unknown): InboxSourceEntityRef | null {
  const record = asRecord(data);
  if (!record) return null;

  const habitId = cleanId(record.habitId);
  if (habitId) return { kind: 'habit', id: habitId };

  const taskId = cleanId(record.taskId);
  if (taskId) return { kind: 'task', id: taskId };

  const projectId = cleanId(record.projectId);
  if (projectId) return { kind: 'project', id: projectId };

  const expenseId = cleanId(record.expenseId);
  if (expenseId) return { kind: 'scheduledExpense', id: expenseId };

  const subjectId = cleanId(record.subjectId);
  const subjectKind = cleanId(record.subjectKind).toLowerCase();
  if (subjectId && subjectKind === 'habit') return { kind: 'habit', id: subjectId };
  if (subjectId && subjectKind === 'task') return { kind: 'task', id: subjectId };
  if (subjectId && subjectKind === 'project') return { kind: 'project', id: subjectId };

  return null;
}

export function parseInboxDataJson(dataJson: string | null | undefined): unknown {
  const raw = String(dataJson ?? '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export type UnreadSourceSnapshot = {
  byAnchor: Record<InboxSourceAnchor, number>;
  entities: {
    habit: string[];
    task: string[];
    project: string[];
    scheduledExpense: string[];
  };
};

export function emptyUnreadSourceSnapshot(): UnreadSourceSnapshot {
  return {
    byAnchor: emptyUnreadByAnchor(),
    entities: {
      habit: [],
      task: [],
      project: [],
      scheduledExpense: [],
    },
  };
}

/**
 * 由未读收件箱行聚合来源锚点与实体 id（纯函数，便于单测）。
 */
export function aggregateUnreadSourceSnapshot(
  rows: ReadonlyArray<{ category: string; dataJson?: string | null; data?: unknown }>,
): UnreadSourceSnapshot {
  const byAnchor = emptyUnreadByAnchor();
  const habit = new Set<string>();
  const task = new Set<string>();
  const project = new Set<string>();
  const scheduledExpense = new Set<string>();

  for (const row of rows) {
    const anchor = sourceAnchorForCategory(row.category);
    if (anchor) byAnchor[anchor] += 1;

    const data = row.data ?? parseInboxDataJson(row.dataJson);
    const entity = extractInboxSourceEntity(data);
    if (!entity) continue;
    if (entity.kind === 'habit') habit.add(entity.id);
    else if (entity.kind === 'task') task.add(entity.id);
    else if (entity.kind === 'project') project.add(entity.id);
    else if (entity.kind === 'scheduledExpense') scheduledExpense.add(entity.id);
  }

  return {
    byAnchor,
    entities: {
      habit: [...habit],
      task: [...task],
      project: [...project],
      scheduledExpense: [...scheduledExpense],
    },
  };
}

/** 行是否匹配「确认已读」条件（锚点 / 实体任一命中）。 */
export function inboxRowMatchesAcknowledge(
  row: { category: string; dataJson?: string | null; data?: unknown },
  opts: {
    anchors?: readonly InboxSourceAnchor[];
    entity?: InboxSourceEntityRef | null;
  },
): boolean {
  const anchors = opts.anchors ?? [];
  if (anchors.length > 0) {
    const anchor = sourceAnchorForCategory(row.category);
    if (anchor && anchors.includes(anchor)) return true;
  }
  const entity = opts.entity;
  if (!entity?.id) return false;
  const data = row.data ?? parseInboxDataJson(row.dataJson);
  const hit = extractInboxSourceEntity(data);
  return !!hit && hit.kind === entity.kind && hit.id === entity.id;
}
