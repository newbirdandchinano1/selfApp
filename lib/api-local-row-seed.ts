import { readLocalRowForWrite } from '@/lib/api-local-row';
import { ensureTaskCategoryMirrorLocally } from '@/lib/repositories/tasks/task-category-mirror';

function strId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function ensureFkPresent(table: string, pkValue: string): Promise<boolean> {
  const { ensureLocalRowPresent } = await import('@/lib/api-local-row');
  return ensureLocalRowPresent(table, pkValue);
}

/** 将 REST 行写入本地前，先确保外键目标存在并修正无效引用，避免 FK 约束失败。 */
export async function sanitizeRowForLocalSeed(
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (table === 'tasks') {
    return sanitizeTaskRowForLocalSeed(row);
  }
  if (table === 'projects') {
    return sanitizeProjectRowForLocalSeed(row);
  }
  return row;
}

async function sanitizeTaskRowForLocalSeed(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const next = { ...row };
  const parentId = strId(next.parent_task_id);
  const projectId = strId(next.project_id);
  let categoryId = strId(next.category_id);

  if (parentId) {
    await ensureFkPresent('tasks', parentId);
  } else {
    next.parent_task_id = null;
  }

  if (projectId) {
    const projectReady = await ensureFkPresent('projects', projectId);
    if (!projectReady) {
      next.project_id = null;
    }
  } else {
    next.project_id = null;
  }

  if (categoryId) {
    let categoryReady = await ensureFkPresent('task_categories', categoryId);
    if (!categoryReady) {
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

async function sanitizeProjectRowForLocalSeed(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const next = { ...row };
  const categoryId = strId(next.category_id);

  if (categoryId) {
    const categoryReady = await ensureFkPresent('project_categories', categoryId);
    if (!categoryReady) {
      next.category_id = null;
    }
  } else {
    next.category_id = null;
  }

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
