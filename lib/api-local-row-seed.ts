import { readLocalRowForWrite } from '@/lib/api-local-row';
import { ensureTaskCategoryMirrorLocally } from '@/lib/repositories/tasks/task-category-mirror';

function strId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type SanitizeSeedOptions = {
  /**
   * 为 false 时不按需拉父行（同步 apply 用），避免增量风暴打满请求队列。
   * 默认 true，供 REST 落库写路径补齐外键。
   */
  allowNetwork?: boolean;
};

async function ensureFkPresent(
  table: string,
  pkValue: string,
  allowNetwork: boolean,
): Promise<boolean> {
  if (!allowNetwork) {
    const { readLocalRowForWrite } = await import('@/lib/api-local-row');
    return (await readLocalRowForWrite(table, pkValue)) != null;
  }
  const { ensureLocalRowPresent } = await import('@/lib/api-local-row');
  return ensureLocalRowPresent(table, pkValue);
}

/** 将 REST 行写入本地前，先确保外键目标存在并修正无效引用，避免 FK 约束失败。 */
export async function sanitizeRowForLocalSeed(
  table: string,
  row: Record<string, unknown>,
  opts?: SanitizeSeedOptions,
): Promise<Record<string, unknown>> {
  const allowNetwork = opts?.allowNetwork !== false;
  if (table === 'tasks') {
    return sanitizeTaskRowForLocalSeed(row, allowNetwork);
  }
  if (table === 'projects') {
    return sanitizeProjectRowForLocalSeed(row, allowNetwork);
  }
  if (table === 'finance_transactions') {
    return sanitizeFinanceTransactionRowForLocalSeed(row, allowNetwork);
  }
  if (table === 'finance_scheduled_expenses') {
    return sanitizeFinanceScheduledExpenseRowForLocalSeed(row, allowNetwork);
  }
  if (table === 'memos') {
    return sanitizeMemoRowForLocalSeed(row);
  }
  if (table === 'recipe_items') {
    return sanitizeRecipeItemRowForLocalSeed(row, allowNetwork);
  }
  if (table === 'wardrobe_items') {
    return sanitizeWardrobeItemRowForLocalSeed(row);
  }
  if (
    table === 'wardrobe_outfits' ||
    table === 'wardrobe_closets' ||
    table === 'wardrobe_categories' ||
    table === 'wardrobe_occasions' ||
    table === 'wardrobe_outfit_items' ||
    table === 'wardrobe_wear_logs' ||
    table === 'wardrobe_option_values' ||
    table === 'wardrobe_body_profile'
  ) {
    return sanitizeWardrobeGenericRowForLocalSeed(row);
  }
  if (table === 'health_records') {
    return sanitizeHealthRecordRowForLocalSeed(row, allowNetwork);
  }
  if (table === 'habit_check_ins') {
    return sanitizeHabitCheckInRowForLocalSeed(row, allowNetwork);
  }
  if (table === 'wish_board_items') {
    return sanitizeWishBoardItemRowForLocalSeed(row);
  }
  return row;
}

async function sanitizeTaskRowForLocalSeed(
  row: Record<string, unknown>,
  allowNetwork: boolean,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  const parentId = strId(next.parent_task_id);
  const projectId = strId(next.project_id);
  let categoryId = strId(next.category_id);

  if (parentId) {
    await ensureFkPresent('tasks', parentId, allowNetwork);
  } else {
    next.parent_task_id = null;
  }

  if (projectId) {
    const projectReady = await ensureFkPresent('projects', projectId, allowNetwork);
    if (!projectReady) {
      // 项目尚未同步到本地时不应静默清空 project_id
      next.project_id = projectId;
    }
  } else {
    next.project_id = null;
  }

  if (categoryId) {
    let categoryReady = await ensureFkPresent('task_categories', categoryId, allowNetwork);
    if (!categoryReady && allowNetwork) {
      categoryReady = await ensureTaskCategoryMirrorLocally(categoryId);
    }
    if (!categoryReady) {
      next.category_id = categoryId;
    }
  } else {
    next.category_id = null;
  }

  return next;
}

async function sanitizeProjectRowForLocalSeed(
  row: Record<string, unknown>,
  allowNetwork: boolean,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  const categoryId = strId(next.category_id);

  if (categoryId) {
    let categoryReady = await ensureFkPresent('project_categories', categoryId, allowNetwork);
    if (!categoryReady) {
      // 与任务行一致：分类尚未同步到本地时不应静默清空 category_id
      next.category_id = categoryId;
    }
  } else {
    next.category_id = null;
  }

  const priorityRaw = next.priority;
  const priorityNum =
    typeof priorityRaw === 'number'
      ? priorityRaw
      : typeof priorityRaw === 'string' && priorityRaw.trim() !== ''
        ? Number(priorityRaw)
        : 0;
  next.priority = Number.isFinite(priorityNum) ? Math.max(0, Math.min(4, Math.trunc(priorityNum))) : 0;

  return next;
}

async function preserveFkColumnWhenMissing(
  next: Record<string, unknown>,
  column: string,
  parentTable: string,
  allowNetwork: boolean,
): Promise<void> {
  const id = strId(next[column]);
  if (!id) {
    next[column] = null;
    return;
  }
  const ready = await ensureFkPresent(parentTable, id, allowNetwork);
  if (!ready) {
    next[column] = id;
  }
}

async function sanitizeFinanceTransactionRowForLocalSeed(
  row: Record<string, unknown>,
  allowNetwork: boolean,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  await preserveFkColumnWhenMissing(next, 'flow_category_id', 'finance_flow_categories', allowNetwork);
  await preserveFkColumnWhenMissing(next, 'account_id', 'finance_accounts', allowNetwork);
  return next;
}

async function sanitizeFinanceScheduledExpenseRowForLocalSeed(
  row: Record<string, unknown>,
  allowNetwork: boolean,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  await preserveFkColumnWhenMissing(next, 'flow_category_id', 'finance_flow_categories', allowNetwork);
  await preserveFkColumnWhenMissing(next, 'account_id', 'finance_accounts', allowNetwork);
  return next;
}

async function sanitizeMemoRowForLocalSeed(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const next = { ...row };
  next.dimension_id = null;
  next.dimension = null;
  delete next.dimension_detail;
  return next;
}

async function sanitizeRecipeItemRowForLocalSeed(
  row: Record<string, unknown>,
  allowNetwork: boolean,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  await preserveFkColumnWhenMissing(next, 'category_id', 'recipe_categories', allowNetwork);
  return next;
}

function stringifyJsonField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function sanitizeWardrobeItemRowForLocalSeed(
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  if ('tags_json' in next) next.tags_json = stringifyJsonField(next.tags_json);
  if ('extra_data' in next) next.extra_data = stringifyJsonField(next.extra_data);
  delete next.category;
  delete next.wear_history_28d;
  delete next.version;
  delete next.deleted_at;
  return next;
}

async function sanitizeWardrobeGenericRowForLocalSeed(
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  if ('extra_data' in next) next.extra_data = stringifyJsonField(next.extra_data);
  delete next.occasion;
  delete next.outfit_items;
  delete next.items;
  delete next.version;
  delete next.deleted_at;
  return next;
}

async function sanitizeHealthRecordRowForLocalSeed(
  row: Record<string, unknown>,
  allowNetwork: boolean,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  const userId = strId(next.user_id) || 'default';
  next.user_id = userId;
  await ensureFkPresent('users', userId, allowNetwork);
  if (typeof next.record_date === 'string' && next.record_date.length >= 10) {
    const ymd = next.record_date.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) next.record_date = ymd;
  }
  return next;
}

async function sanitizeHabitCheckInRowForLocalSeed(
  row: Record<string, unknown>,
  allowNetwork: boolean,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  if (typeof next.record_date === 'string' && next.record_date.length >= 10) {
    const ymd = next.record_date.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) next.record_date = ymd;
  }
  const habitId = strId(next.habit_id);
  if (habitId) {
    await ensureFkPresent('habits', habitId, allowNetwork);
  }
  return next;
}

async function sanitizeWishBoardItemRowForLocalSeed(
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = { ...row };
  if ('extra_data' in next) next.extra_data = stringifyJsonField(next.extra_data);
  return next;
}

export async function seedApiRowToLocalForWrite(
  table: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  const pk = strId(row.id);
  if (pk && (await readLocalRowForWrite(table, pk))) {
    return true;
  }

  const { applyApiRowsToLocalTable } = await import('@/lib/api-read-local-sync');
  const sanitized = await sanitizeRowForLocalSeed(table, row);
  await applyApiRowsToLocalTable(table, [sanitized]);

  if (!pk) return true;
  return (await readLocalRowForWrite(table, pk)) != null;
}
