import { readApiRecord, readApiTable } from '@/lib/api-read';
import { sortBySortOrderAsc, sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import { INBOX_PROJECT_CATEGORY_ID } from './constants';
import type {
  CreateProjectCategoryInput,
  CreateProjectInput,
  ProjectCategoryRow,
  ProjectRow,
  UpdateProjectCategoryInput,
  UpdateProjectInput,
} from './project.types';

export async function createProject(input: CreateProjectInput) {
  const db = await getDatabase();
  const inStrictInbox = input.category_id === INBOX_PROJECT_CATEGORY_ID;
  const inboxAtSql = inStrictInbox ? `datetime('now')` : 'NULL';
  await db.runAsync(
    `INSERT INTO projects (
      id, category_id, name, status, note, due_date, created_at, updated_at, sync_status, extra_data, inbox_entered_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?, ${inboxAtSql})`,
    [input.id, input.category_id ?? null, input.name, input.status ?? 'active', input.note ?? null, input.due_date ?? null, input.extra_data ?? null]
  );
}

export async function getProjectById(id: string) {
  return readApiRecord<ProjectRow>('projects', id, { offlineFallback: true });
}

export async function getProjects() {
  const rows = await readApiTable<ProjectRow>('projects', { offlineFallback: true });
  return sortByUpdatedDesc(rows);
}

export async function isProjectNameDuplicate(name: string, excludeId?: string) {
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName) return false;

  const rows = await readApiTable<ProjectRow>('projects', { offlineFallback: false });
  return rows.some(
    p =>
      p.id !== excludeId &&
      String(p.name ?? '')
        .trim()
        .toLowerCase() === normalizedName,
  );
}

export async function updateProject(id: string, input: UpdateProjectInput) {
  const db = await getDatabase();
  const current = await getProjectById(id);
  if (!current) return;

  const nextCategoryId = input.category_id !== undefined ? input.category_id : current.category_id;
  const wasStrictInbox = current.category_id === INBOX_PROJECT_CATEGORY_ID;
  const willStrictInbox = nextCategoryId === INBOX_PROJECT_CATEGORY_ID;

  let nextInboxEnteredAt: string | null;
  if (!willStrictInbox) {
    nextInboxEnteredAt = null;
  } else if (!wasStrictInbox && willStrictInbox) {
    const stamp = await db.getFirstAsync<{ s: string }>("SELECT datetime('now') as s");
    nextInboxEnteredAt = stamp?.s ?? null;
  } else {
    nextInboxEnteredAt = current.inbox_entered_at ?? null;
  }

  await db.runAsync(
    `UPDATE projects
     SET category_id = ?, name = ?, status = ?, note = ?, due_date = ?, extra_data = ?, inbox_entered_at = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      nextCategoryId,
      input.name ?? current.name,
      input.status ?? current.status,
      input.note !== undefined ? input.note : current.note,
      input.due_date !== undefined ? input.due_date : current.due_date,
      input.extra_data !== undefined ? input.extra_data : current.extra_data,
      nextInboxEnteredAt,
      id,
    ]
  );
}

export async function deleteProject(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE tasks
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE project_id = ?`,
    [id]
  );
  await db.runAsync(
    `UPDATE projects
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id]
  );
}

/** 收集箱内（`category_id` 为内置收集箱）且 `inbox_entered_at` 超过 `retentionDays` 的项目删除（含下属任务）。 */
export async function deleteInboxProjectsPastRetentionDays(retentionDays: number): Promise<number> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM projects
     WHERE category_id = ?
       AND inbox_entered_at IS NOT NULL
       AND datetime(inbox_entered_at) <= datetime('now', ?)`,
    [INBOX_PROJECT_CATEGORY_ID, `-${retentionDays} days`],
  );
  for (const r of rows) {
    await deleteProject(r.id);
  }
  return rows.length;
}

export async function createProjectCategory(input: CreateProjectCategoryInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO project_categories (
      id, name, sort_order, created_at, updated_at, sync_status, extra_data
    ) VALUES (
      ?, ?,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM project_categories),
      datetime('now'), datetime('now'), 'pending_create', ?
    )`,
    [input.id, input.name, input.extra_data ?? null]
  );
}

export async function getProjectCategories() {
  const rows = await readApiTable<ProjectCategoryRow>('project_categories', { offlineFallback: true });
  return sortBySortOrderAsc(rows);
}

export async function reorderProjectCategories(orderedIds: string[]) {
  const db = await getDatabase();
  const ids = orderedIds.filter((id) => id && id !== INBOX_PROJECT_CATEGORY_ID);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    await db.runAsync(
      `UPDATE project_categories
       SET sort_order = ?, updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [i + 1, id]
    );
  }
  await db.runAsync(
    `UPDATE project_categories
     SET sort_order = 0, updated_at = datetime('now')
     WHERE id = ?`,
    [INBOX_PROJECT_CATEGORY_ID]
  );
}

export async function updateProjectCategory(id: string, input: UpdateProjectCategoryInput) {
  if (id === INBOX_PROJECT_CATEGORY_ID) return;
  const db = await getDatabase();
  const current = await db.getFirstAsync<ProjectCategoryRow>('SELECT * FROM project_categories WHERE id = ? LIMIT 1', [id]);
  if (!current) return;
  await db.runAsync(
    `UPDATE project_categories
     SET name = ?, extra_data = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [input.name ?? current.name, input.extra_data ?? current.extra_data, id]
  );
}

export async function deleteProjectCategory(id: string) {
  if (id === INBOX_PROJECT_CATEGORY_ID) return;
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE project_categories
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id]
  );
}
