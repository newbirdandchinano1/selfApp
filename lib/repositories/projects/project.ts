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
  await db.runAsync(
    `INSERT INTO projects (
      id, category_id, name, status, note, due_date, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?)`,
    [input.id, input.category_id ?? null, input.name, input.status ?? 'active', input.note ?? null, input.due_date ?? null, input.extra_data ?? null]
  );
}

export async function getProjectById(id: string) {
  const db = await getDatabase();
  return db.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
}

export async function getProjects() {
  const db = await getDatabase();
  return db.getAllAsync<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC');
}

export async function updateProject(id: string, input: UpdateProjectInput) {
  const db = await getDatabase();
  const current = await getProjectById(id);
  if (!current) return;
  await db.runAsync(
    `UPDATE projects
     SET category_id = ?, name = ?, status = ?, note = ?, due_date = ?, extra_data = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
     WHERE id = ?`,
    [
      input.category_id ?? current.category_id,
      input.name ?? current.name,
      input.status ?? current.status,
      input.note ?? current.note,
      input.due_date ?? current.due_date,
      input.extra_data ?? current.extra_data,
      id,
    ]
  );
}

export async function deleteProject(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE projects
     SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending_delete', version = version + 1
     WHERE id = ?`,
    [id]
  );
}

export async function createProjectCategory(input: CreateProjectCategoryInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO project_categories (
      id, name, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?)`,
    [input.id, input.name, input.extra_data ?? null]
  );
}

export async function getProjectCategories() {
  const db = await getDatabase();
  return db.getAllAsync<ProjectCategoryRow>(
    `SELECT * FROM project_categories
     WHERE deleted_at IS NULL
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC, created_at DESC`,
    [INBOX_PROJECT_CATEGORY_ID]
  );
}

export async function updateProjectCategory(id: string, input: UpdateProjectCategoryInput) {
  if (id === INBOX_PROJECT_CATEGORY_ID) return;
  const db = await getDatabase();
  const current = await db.getFirstAsync<ProjectCategoryRow>('SELECT * FROM project_categories WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
  if (!current) return;
  await db.runAsync(
    `UPDATE project_categories
     SET name = ?, extra_data = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
     WHERE id = ?`,
    [input.name ?? current.name, input.extra_data ?? current.extra_data, id]
  );
}

export async function deleteProjectCategory(id: string) {
  if (id === INBOX_PROJECT_CATEGORY_ID) return;
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE project_categories
     SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending_delete', version = version + 1
     WHERE id = ?`,
    [id]
  );
}
