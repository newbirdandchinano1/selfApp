import { getDatabase } from '../../database.native';
import { REVIEW_TEMPLATE_DEFAULTS } from './review-template-defaults';
import type {
  CreateReviewColumnInput,
  CreateReviewDimensionInput,
  ReviewColumnRow,
  ReviewDimensionRow,
  ReviewDimensionTemplate,
  ReviewTemplateScope,
  UpdateReviewColumnInput,
  UpdateReviewDimensionInput,
} from './review-template.types';

function newReviewId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createReviewDimensionId(): string {
  return newReviewId('rd');
}

export function createReviewColumnId(): string {
  return newReviewId('rc');
}

export async function countReviewDimensions(scope: ReviewTemplateScope): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(1) AS c FROM review_dimensions WHERE scope = ? AND deleted_at IS NULL`,
    [scope],
  );
  return row?.c ?? 0;
}

export async function listReviewDimensions(scope: ReviewTemplateScope): Promise<ReviewDimensionRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  return db.getAllAsync<ReviewDimensionRow>(
    `SELECT * FROM review_dimensions
     WHERE scope = ? AND deleted_at IS NULL
     ORDER BY sort_order ASC, datetime(created_at) ASC`,
    [scope],
  );
}

export async function listReviewColumnsForDimension(dimensionId: string): Promise<ReviewColumnRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  return db.getAllAsync<ReviewColumnRow>(
    `SELECT * FROM review_columns
     WHERE dimension_id = ? AND deleted_at IS NULL
     ORDER BY sort_order ASC, datetime(created_at) ASC`,
    [dimensionId],
  );
}

export async function listReviewTemplate(scope: ReviewTemplateScope): Promise<ReviewDimensionTemplate[]> {
  const dims = await listReviewDimensions(scope);
  const out: ReviewDimensionTemplate[] = [];
  for (const dim of dims) {
    const cols = await listReviewColumnsForDimension(dim.id);
    out.push({
      id: dim.id,
      scope: dim.scope,
      title: dim.title,
      sortOrder: dim.sort_order,
      columns: cols.map(c => ({
        id: c.id,
        dimensionId: c.dimension_id,
        title: c.title,
        placeholder: c.placeholder ?? '',
        sortOrder: c.sort_order,
      })),
    });
  }
  return out;
}

export async function getReviewDimensionById(id: string): Promise<ReviewDimensionRow | null> {
  const db = await getDatabase();
  if (!db) return null;
  return db.getFirstAsync<ReviewDimensionRow>(
    `SELECT * FROM review_dimensions WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
}

export async function getReviewColumnById(id: string): Promise<ReviewColumnRow | null> {
  const db = await getDatabase();
  if (!db) return null;
  return db.getFirstAsync<ReviewColumnRow>(
    `SELECT * FROM review_columns WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
}

export async function createReviewDimension(input: CreateReviewDimensionInput): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const title = input.title.trim();
  if (!title) throw new Error('title required');
  await db.runAsync(
    `INSERT INTO review_dimensions (
      id, scope, title, sort_order, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
    [input.id, input.scope, title, input.sort_order ?? 1000],
  );
}

export async function updateReviewDimension(id: string, input: UpdateReviewDimensionInput): Promise<boolean> {
  const current = await getReviewDimensionById(id);
  if (!current) return false;
  const title = input.title !== undefined ? input.title.trim() : current.title;
  if (!title) throw new Error('title required');
  const sort_order = input.sort_order ?? current.sort_order;
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await db.runAsync(
    `UPDATE review_dimensions SET
       title = ?, sort_order = ?,
       updated_at = datetime('now'),
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
       version = version + 1
     WHERE id = ? AND deleted_at IS NULL`,
    [title, sort_order, id],
  );
  return true;
}

export async function deleteReviewDimension(id: string): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await db.runAsync(
    `UPDATE review_dimensions SET
       deleted_at = datetime('now'),
       updated_at = datetime('now'),
       sync_status = 'pending_delete',
       version = version + 1
     WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  await db.runAsync(
    `UPDATE review_columns SET
       deleted_at = datetime('now'),
       updated_at = datetime('now'),
       sync_status = 'pending_delete',
       version = version + 1
     WHERE dimension_id = ? AND deleted_at IS NULL`,
    [id],
  );
}

export async function createReviewColumn(input: CreateReviewColumnInput): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const dim = await getReviewDimensionById(input.dimension_id);
  if (!dim) throw new Error('dimension not found');
  const title = input.title.trim();
  if (!title) throw new Error('title required');
  await db.runAsync(
    `INSERT INTO review_columns (
      id, dimension_id, title, placeholder, sort_order,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
    [
      input.id,
      input.dimension_id,
      title,
      input.placeholder?.trim() || null,
      input.sort_order ?? 1000,
    ],
  );
}

export async function updateReviewColumn(id: string, input: UpdateReviewColumnInput): Promise<boolean> {
  const current = await getReviewColumnById(id);
  if (!current) return false;
  const title = input.title !== undefined ? input.title.trim() : current.title;
  if (!title) throw new Error('title required');
  const placeholder = input.placeholder !== undefined ? input.placeholder?.trim() || null : current.placeholder;
  const sort_order = input.sort_order ?? current.sort_order;
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await db.runAsync(
    `UPDATE review_columns SET
       title = ?, placeholder = ?, sort_order = ?,
       updated_at = datetime('now'),
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
       version = version + 1
     WHERE id = ? AND deleted_at IS NULL`,
    [title, placeholder, sort_order, id],
  );
  return true;
}

export async function deleteReviewColumn(id: string): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await db.runAsync(
    `UPDATE review_columns SET
       deleted_at = datetime('now'),
       updated_at = datetime('now'),
       sync_status = 'pending_delete',
       version = version + 1
     WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
}

/** 各 scope 无维度时写入内置模板（一次性，按 scope 判断） */
export async function ensureReviewTemplateDefaults(): Promise<void> {
  for (const scope of ['daily', 'weekly'] as const) {
    const count = await countReviewDimensions(scope);
    if (count > 0) continue;
    const defs = REVIEW_TEMPLATE_DEFAULTS[scope];
    for (const dim of defs) {
      await createReviewDimension({
        id: dim.id,
        scope,
        title: dim.title,
        sort_order: dim.sort_order,
      });
      for (const col of dim.columns) {
        await createReviewColumn({
          id: col.id,
          dimension_id: dim.id,
          title: col.title,
          placeholder: col.placeholder,
          sort_order: col.sort_order,
        });
      }
    }
  }
}
