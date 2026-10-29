import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { sortBySortOrderAsc } from '@/lib/api-read-helpers';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '../../database.native';
import {
  BUILTIN_REVIEW_CUSTOM_SORT_START,
  isBuiltinReviewColumnId,
  isBuiltinReviewDimensionId,
  LEGACY_MONTHLY_DEFAULT_DIMENSION_IDS,
  LEGACY_WEEKLY_DEFAULT_DIMENSION_IDS,
  pinBuiltinReviewDimensions,
  REVIEW_TEMPLATE_DEFAULTS,
} from './review-template-defaults';
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
  return makeTimestampEntityId(`${prefix}_`, 7);
}

export function createReviewDimensionId(): string {
  return newReviewId('rd');
}

export function createReviewColumnId(): string {
  return newReviewId('rc');
}

/** 读路径已改走 `/api/pages/review/*`；仓库层只读 SQLite，禁止 List。 */
async function readReviewDimensionsLocalVisible(scope?: ReviewTemplateScope): Promise<ReviewDimensionRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  if (scope) {
    const rows = await db.getAllAsync<ReviewDimensionRow>(
      `SELECT * FROM review_dimensions WHERE scope = ? AND sync_status != 'pending_delete'`,
      [scope],
    );
    return rows ?? [];
  }
  const rows = await db.getAllAsync<ReviewDimensionRow>(
    `SELECT * FROM review_dimensions WHERE sync_status != 'pending_delete'`,
  );
  return rows ?? [];
}

async function readReviewColumnsLocalVisible(dimensionId?: string): Promise<ReviewColumnRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  if (dimensionId) {
    const rows = await db.getAllAsync<ReviewColumnRow>(
      `SELECT * FROM review_columns WHERE dimension_id = ? AND sync_status != 'pending_delete'`,
      [dimensionId],
    );
    return rows ?? [];
  }
  const rows = await db.getAllAsync<ReviewColumnRow>(
    `SELECT * FROM review_columns WHERE sync_status != 'pending_delete'`,
  );
  return rows ?? [];
}

export async function countReviewDimensions(scope: ReviewTemplateScope): Promise<number> {
  const rows = await readReviewDimensionsLocalVisible(scope);
  return rows.length;
}

export async function listReviewDimensions(scope: ReviewTemplateScope): Promise<ReviewDimensionRow[]> {
  const rows = sortBySortOrderAsc(await readReviewDimensionsLocalVisible(scope));
  return pinBuiltinReviewDimensions(scope, rows, d => d.sort_order ?? 0);
}

export async function listReviewColumnsForDimension(dimensionId: string): Promise<ReviewColumnRow[]> {
  return sortBySortOrderAsc(await readReviewColumnsLocalVisible(dimensionId));
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
    `SELECT * FROM review_dimensions WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
    [id],
  );
}

export async function getReviewColumnById(id: string): Promise<ReviewColumnRow | null> {
  const db = await getDatabase();
  if (!db) return null;
  return db.getFirstAsync<ReviewColumnRow>(
    `SELECT * FROM review_columns WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
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
      id, scope, title, sort_order, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', NULL)`,
    [input.id, input.scope, title, input.sort_order ?? 1000],
  );
}

export async function updateReviewDimension(id: string, input: UpdateReviewDimensionInput): Promise<boolean> {
  const current = await ensureLocalRowForWrite<ReviewDimensionRow>('review_dimensions', id);
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
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [title, sort_order, id],
  );
  return true;
}

export async function deleteReviewDimension(id: string): Promise<void> {
  if (isBuiltinReviewDimensionId(id)) {
    throw new Error('内置维度不可删除');
  }
  await ensureLocalRowForWrite('review_dimensions', id);
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await db.runAsync(
    `UPDATE review_dimensions SET
       updated_at = datetime('now'),
       sync_status = 'pending_delete'
     WHERE id = ?`,
    [id],
  );
  await db.runAsync(
    `UPDATE review_columns SET
       updated_at = datetime('now'),
       sync_status = 'pending_delete'
     WHERE dimension_id = ?`,
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
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', NULL)`,
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
  const current = await ensureLocalRowForWrite<ReviewColumnRow>('review_columns', id);
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
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [title, placeholder, sort_order, id],
  );
  return true;
}

export async function deleteReviewColumn(id: string): Promise<void> {
  if (isBuiltinReviewColumnId(id)) {
    throw new Error('内置栏目不可删除');
  }
  await ensureLocalRowForWrite('review_columns', id);
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await db.runAsync(
    `UPDATE review_columns SET
       updated_at = datetime('now'),
       sync_status = 'pending_delete'
     WHERE id = ?`,
    [id],
  );
}

async function getReviewDimensionRowAny(id: string): Promise<ReviewDimensionRow | null> {
  const db = await getDatabase();
  if (!db) return null;
  return db.getFirstAsync<ReviewDimensionRow>(`SELECT * FROM review_dimensions WHERE id = ? LIMIT 1`, [id]);
}

async function getReviewColumnRowAny(id: string): Promise<ReviewColumnRow | null> {
  const db = await getDatabase();
  if (!db) return null;
  return db.getFirstAsync<ReviewColumnRow>(`SELECT * FROM review_columns WHERE id = ? LIMIT 1`, [id]);
}

type DefaultReviewDimensionDef =
  | (typeof REVIEW_TEMPLATE_DEFAULTS)['daily'][number]
  | (typeof REVIEW_TEMPLATE_DEFAULTS)['weekly'][number]
  | (typeof REVIEW_TEMPLATE_DEFAULTS)['monthly'][number];

type DefaultReviewColumnDef = DefaultReviewDimensionDef['columns'][number];

async function ensureDefaultReviewDimension(
  scope: ReviewTemplateScope,
  dim: DefaultReviewDimensionDef,
): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const existing = await getReviewDimensionRowAny(dim.id);
  if (!existing) {
    await createReviewDimension({
      id: dim.id,
      scope,
      title: dim.title,
      sort_order: dim.sort_order,
    });
    return;
  }
  const title = dim.title.trim();
  const sortOrder = dim.sort_order ?? 1000;
  const needsRestore = existing.sync_status === 'pending_delete';
  const changed =
    existing.scope !== scope || existing.title !== title || existing.sort_order !== sortOrder;
  if (!needsRestore && !changed) return;
  await db.runAsync(
    `UPDATE review_dimensions SET
       scope = ?,
       title = ?,
       sort_order = ?,
       updated_at = datetime('now'),
       sync_status = CASE
         WHEN sync_status = 'pending_delete' THEN 'pending_update'
         WHEN sync_status = 'synced' THEN 'pending_update'
         ELSE sync_status
       END
     WHERE id = ?`,
    [scope, title, sortOrder, dim.id],
  );
}

async function ensureDefaultReviewColumn(
  dim: DefaultReviewDimensionDef,
  col: DefaultReviewColumnDef,
): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const existing = await getReviewColumnRowAny(col.id);
  if (!existing) {
    await createReviewColumn({
      id: col.id,
      dimension_id: dim.id,
      title: col.title,
      placeholder: col.placeholder,
      sort_order: col.sort_order,
    });
    return;
  }
  const title = col.title.trim();
  const placeholder = col.placeholder ?? '';
  const sortOrder = col.sort_order ?? 1000;
  const needsRestore = existing.sync_status === 'pending_delete';
  const changed =
    existing.dimension_id !== dim.id ||
    existing.title !== title ||
    (existing.placeholder ?? '') !== placeholder ||
    existing.sort_order !== sortOrder;
  if (!needsRestore && !changed) return;
  await db.runAsync(
    `UPDATE review_columns SET
       dimension_id = ?,
       title = ?,
       placeholder = ?,
       sort_order = ?,
       updated_at = datetime('now'),
       sync_status = CASE
         WHEN sync_status = 'pending_delete' THEN 'pending_update'
         WHEN sync_status = 'synced' THEN 'pending_update'
         ELSE sync_status
       END
     WHERE id = ?`,
    [dim.id, title, placeholder, sortOrder, col.id],
  );
}

/** 各 scope 无活跃维度时写入内置模板（含云恢复后仅软删除占位行的场景） */
export async function ensureReviewTemplateDefaults(): Promise<void> {
  for (const scope of ['daily', 'weekly', 'monthly'] as const) {
    const count = await countReviewDimensions(scope);
    if (count > 0) continue;
    const defs = REVIEW_TEMPLATE_DEFAULTS[scope];
    for (const dim of defs) {
      await ensureDefaultReviewDimension(scope, dim);
      for (const col of dim.columns) {
        await ensureDefaultReviewColumn(dim, col);
      }
    }
  }
}

const LEGACY_DAILY_DIM_IDS = ['rd_daily_audit', 'rd_daily_insight', 'rd_daily_iter'] as const;

/**
 * 一次性：若日复盘仍是旧版三块 Audit/Insight/Iteration 默认结构，则替换为极简两问。
 * 用户已自定义维度（ID 集合不同）则跳过，避免覆盖。
 */
export async function migrateDailyTemplateToMinimalIfNeeded(): Promise<void> {
  const { AppSettingKey, getAppSettingRaw, setAppSetting } = await import('@/lib/app-settings-store');
  const flag = await getAppSettingRaw(AppSettingKey.reviewMinimalDailyTemplateV1);
  if (flag === '1' || flag === 'true') return;

  await ensureReviewTemplateDefaults();

  const dims = await listReviewDimensions('daily');
  const idSet = new Set(dims.map(d => d.id));
  const isLegacyDefault =
    dims.length === LEGACY_DAILY_DIM_IDS.length &&
    LEGACY_DAILY_DIM_IDS.every(id => idSet.has(id));

  if (isLegacyDefault) {
    for (const id of LEGACY_DAILY_DIM_IDS) {
      await deleteReviewDimension(id);
    }
    for (const dim of REVIEW_TEMPLATE_DEFAULTS.daily) {
      await ensureDefaultReviewDimension('daily', dim);
      for (const col of dim.columns) {
        await ensureDefaultReviewColumn(dim, col);
      }
    }
  }

  await setAppSetting(AppSettingKey.reviewMinimalDailyTemplateV1, '1');
}

async function softDeleteLegacyDefaultDimension(id: string): Promise<void> {
  if (isBuiltinReviewDimensionId(id)) return;
  const db = await getDatabase();
  if (!db) return;
  const existing = await getReviewDimensionRowAny(id);
  if (!existing || existing.sync_status === 'pending_delete') return;
  await db.runAsync(
    `UPDATE review_dimensions SET
       updated_at = datetime('now'),
       sync_status = 'pending_delete'
     WHERE id = ?`,
    [id],
  );
  await db.runAsync(
    `UPDATE review_columns SET
       updated_at = datetime('now'),
       sync_status = 'pending_delete'
     WHERE dimension_id = ?`,
    [id],
  );
}

/**
 * 确保指定 scope 始终有六大内置模块（健康/任务/财务/日常/缺陷/新想法）；
 * 自定义维度排在 sort≥100 之后。
 */
export async function ensureBuiltinReviewModules(scope: ReviewTemplateScope): Promise<void> {
  const defs = REVIEW_TEMPLATE_DEFAULTS[scope];
  for (const dim of defs) {
    await ensureDefaultReviewDimension(scope, dim);
    for (const col of dim.columns) {
      await ensureDefaultReviewColumn(dim, col);
    }
  }

  const dims = await listReviewDimensions(scope);
  let nextSort = BUILTIN_REVIEW_CUSTOM_SORT_START;
  for (const dim of dims) {
    if (isBuiltinReviewDimensionId(dim.id)) continue;
    if (dim.sort_order < BUILTIN_REVIEW_CUSTOM_SORT_START) {
      await updateReviewDimension(dim.id, { sort_order: nextSort });
      nextSort += 10;
    }
  }
}

/**
 * 确保日复盘始终有六大内置模块；自定义维度排在其后。
 * 已有自定义维度会保留，仅调整排序。
 */
export async function ensureBuiltinDailyReviewModules(): Promise<void> {
  const { AppSettingKey, getAppSettingRaw, setAppSetting } = await import('@/lib/app-settings-store');
  const migrated = await getAppSettingRaw(AppSettingKey.reviewBuiltinDailyModulesV1);
  await ensureBuiltinReviewModules('daily');
  if (migrated === '1') return;
  await setAppSetting(AppSettingKey.reviewBuiltinDailyModulesV1, '1');
}

/**
 * 日/周/月对齐六大内置模块；软删除旧版周/月默认维度（汇总本周事件等）。
 */
export async function ensureBuiltinCascadeReviewModules(): Promise<void> {
  const { AppSettingKey, getAppSettingRaw, setAppSetting } = await import('@/lib/app-settings-store');
  const cascadeDone = await getAppSettingRaw(AppSettingKey.reviewBuiltinCascadeModulesV1);
  if (cascadeDone === '1') {
    // 标记已完成仍补齐缺失维度，但不重复写 app_settings / 软删旧默认
    await ensureBuiltinReviewModules('daily');
    await ensureBuiltinReviewModules('weekly');
    await ensureBuiltinReviewModules('monthly');
    return;
  }

  for (const id of LEGACY_WEEKLY_DEFAULT_DIMENSION_IDS) {
    await softDeleteLegacyDefaultDimension(id);
  }
  for (const id of LEGACY_MONTHLY_DEFAULT_DIMENSION_IDS) {
    await softDeleteLegacyDefaultDimension(id);
  }

  await ensureBuiltinReviewModules('daily');
  await ensureBuiltinReviewModules('weekly');
  await ensureBuiltinReviewModules('monthly');

  await setAppSetting(AppSettingKey.reviewBuiltinDailyModulesV1, '1');
  await setAppSetting(AppSettingKey.reviewBuiltinCascadeModulesV1, '1');
}
