/**
 * 局部 PATCH、全量 reconcile、上传 bundle 等路径中，分类/维度外键容易被误清空。
 * 在此集中定义需保留的外键规则，供 api-read-local-sync / api-row-upsert / cloud-sql-sync 共用。
 */

export type ForeignKeyRef = { fromColumn: string; parentTable: string };

/** API 返回 null/空 且本地有值时，保留本地外键（避免 PATCH extra_data 等局部同步误清空） */
export const PRESERVE_ON_EMPTY_API: Record<string, readonly string[]> = {
  tasks: ['category_id', 'project_id', 'parent_task_id'],
  projects: ['category_id'],
  finance_transactions: ['flow_category_id', 'account_id'],
  memos: ['dimension_id'],
  wish_items: ['category_id'],
  recipe_items: ['category_id'],
};

/** REST 上传时：父表尚未进 bundle 也不应置空的外键（由 upsert*Referenced* 或 ensure*Refs 补传） */
export const UPLOAD_PRESERVE_FK: ReadonlyArray<{ table: string } & ForeignKeyRef> = [
  { table: 'projects', fromColumn: 'category_id', parentTable: 'project_categories' },
  { table: 'tasks', fromColumn: 'category_id', parentTable: 'task_categories' },
  /** 局部更新 status 时父项目/父任务通常已存在于服务端，不应因本批未上传而置空 */
  { table: 'tasks', fromColumn: 'project_id', parentTable: 'projects' },
  { table: 'tasks', fromColumn: 'parent_task_id', parentTable: 'tasks' },
  { table: 'memos', fromColumn: 'dimension_id', parentTable: 'memo_dimensions' },
  { table: 'finance_transactions', fromColumn: 'flow_category_id', parentTable: 'finance_flow_categories' },
  { table: 'recipe_items', fromColumn: 'category_id', parentTable: 'recipe_categories' },
  { table: 'habit_check_ins', fromColumn: 'habit_id', parentTable: 'habits' },
];

export function preserveLocalForeignKeysOnEmptyApi(
  table: string,
  obj: Record<string, unknown>,
  existing: Record<string, unknown>,
  colNames: string[],
): void {
  const columns = PRESERVE_ON_EMPTY_API[table];
  if (!columns) return;
  for (const col of columns) {
    if (!colNames.includes(col)) continue;
    const apiVal = obj[col];
    const localVal = existing[col];
    if ((apiVal == null || apiVal === '') && localVal != null && localVal !== '') {
      obj[col] = localVal;
    }
  }
}

function nonEmptyFkId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 将已知外键并入 PATCH，避免服务端局部更新误清空 project_id / parent_task_id 等 */
export function mergePreservedForeignKeysIntoPatch(
  table: string,
  patch: Record<string, unknown>,
  sources: Array<Record<string, unknown> | null | undefined>,
): Record<string, unknown> {
  const columns = PRESERVE_ON_EMPTY_API[table];
  if (!columns?.length) return patch;

  const out = { ...patch };
  for (const col of columns) {
    if (nonEmptyFkId(out[col])) continue;
    for (const source of sources) {
      const id = nonEmptyFkId(source?.[col]);
      if (id) {
        out[col] = id;
        break;
      }
    }
  }
  return out;
}

export function shouldPreserveForeignKeyOnUpload(table: string, fk: ForeignKeyRef): boolean {
  return UPLOAD_PRESERVE_FK.some(
    r => r.table === table && r.fromColumn === fk.fromColumn && r.parentTable === fk.parentTable,
  );
}

type SqliteDb = {
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
};

function distinctNonEmptyIds(rows: Array<Record<string, unknown>>, column: string): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const raw = row[column];
    if (raw == null || raw === '') continue;
    const id = String(raw).trim();
    if (id) out.add(id);
  }
  return out;
}

/**
 * reconcile 物理删除前：仍被本地子表引用的父表行 id 不应删除，
 * 否则 SQLite ON DELETE SET NULL / CASCADE 会连带清空或删除业务数据。
 */
export async function readReferencedParentIdsForReconcile(
  db: SqliteDb,
  table: string,
): Promise<Set<string> | null> {
  switch (table) {
    case 'project_categories': {
      const rows = await db.getAllAsync<{ category_id: string | null }>(
        `SELECT DISTINCT category_id FROM projects
         WHERE category_id IS NOT NULL AND TRIM(category_id) != ''`,
      );
      return distinctNonEmptyIds(rows, 'category_id');
    }
    case 'task_categories': {
      const [fromTasks, fromProjects] = await Promise.all([
        db.getAllAsync<{ category_id: string | null }>(
          `SELECT DISTINCT category_id FROM tasks
           WHERE category_id IS NOT NULL AND TRIM(category_id) != ''`,
        ),
        db.getAllAsync<{ category_id: string | null }>(
          `SELECT DISTINCT category_id FROM projects
           WHERE category_id IS NOT NULL AND TRIM(category_id) != ''`,
        ),
      ]);
      return new Set([
        ...distinctNonEmptyIds(fromTasks, 'category_id'),
        ...distinctNonEmptyIds(fromProjects, 'category_id'),
      ]);
    }
    case 'finance_flow_categories': {
      const [fromTxns, fromParents] = await Promise.all([
        db.getAllAsync<{ flow_category_id: string | null }>(
          `SELECT DISTINCT flow_category_id FROM finance_transactions
           WHERE flow_category_id IS NOT NULL AND TRIM(flow_category_id) != ''`,
        ),
        db.getAllAsync<{ parent_id: string | null }>(
          `SELECT DISTINCT parent_id FROM finance_flow_categories
           WHERE parent_id IS NOT NULL AND TRIM(parent_id) != ''`,
        ),
      ]);
      return new Set([
        ...distinctNonEmptyIds(fromTxns, 'flow_category_id'),
        ...distinctNonEmptyIds(fromParents, 'parent_id'),
      ]);
    }
    case 'memo_dimensions': {
      const rows = await db.getAllAsync<{ dimension_id: string | null }>(
        `SELECT DISTINCT dimension_id FROM memos
         WHERE dimension_id IS NOT NULL AND TRIM(dimension_id) != ''`,
      );
      return distinctNonEmptyIds(rows, 'dimension_id');
    }
    case 'recipe_categories': {
      const rows = await db.getAllAsync<{ category_id: string | null }>(
        `SELECT DISTINCT category_id FROM recipe_items
         WHERE category_id IS NOT NULL AND TRIM(category_id) != ''`,
      );
      return distinctNonEmptyIds(rows, 'category_id');
    }
    case 'review_dimensions': {
      const rows = await db.getAllAsync<{ dimension_id: string | null }>(
        `SELECT DISTINCT dimension_id FROM review_columns
         WHERE dimension_id IS NOT NULL AND TRIM(dimension_id) != ''`,
      );
      return distinctNonEmptyIds(rows, 'dimension_id');
    }
    case 'tasks': {
      const rows = await db.getAllAsync<{ parent_task_id: string | null }>(
        `SELECT DISTINCT parent_task_id FROM tasks
         WHERE parent_task_id IS NOT NULL AND TRIM(parent_task_id) != ''`,
      );
      return distinctNonEmptyIds(rows, 'parent_task_id');
    }
    default:
      return null;
  }
}

/** GET 单条 404 时：父表行仍被引用则不应物理删除 */
export async function isLocalParentRowStillReferenced(db: SqliteDb, table: string, pkValue: string): Promise<boolean> {
  const referenced = await readReferencedParentIdsForReconcile(db, table);
  if (!referenced) return false;
  return referenced.has(pkValue.trim());
}
