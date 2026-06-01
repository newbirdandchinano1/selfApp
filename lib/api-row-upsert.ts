import { apiCreateRecord, apiUpdateRecord, ApiRequestError } from '@/lib/api-client';
import {
  ensureProjectCategoryRefsForApiUpload,
  ensureTaskCategoryMirrorForApiUpload,
  readLocalForeignKeyRefs,
  sortProjectCategoriesForApiUpload,
} from '@/lib/cloud-sql-sync';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { isAbortError } from '@/lib/cloud-fetch-retry';

function rowPrimaryKeyValue(row: Record<string, unknown>, pkCols: string[]): string | null {
  if (pkCols.length === 0) {
    const id = row.id;
    return id == null || id === '' ? null : String(id);
  }
  const parts = pkCols.map(col => row[col]);
  if (parts.some(v => v == null || v === '')) return null;
  return String(parts[0]);
}

type UploadedPkRegistry = Map<string, Set<string>>;

function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof ApiRequestError && /foreign key constraint fails/i.test(err.message);
}

function isMissingParentRecordApiError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (/请先同步\s*projects/i.test(err.message) ||
      /请先同步\s*project_categories/i.test(err.message) ||
      /请先.*task_categories/i.test(err.message) ||
      /任务分类.*不存在/i.test(err.message) ||
      /项目分类.*不存在/i.test(err.message) ||
      /引用的\s*项目[\s（(]*projects/i.test(err.message) ||
      /projects[\s）)]*不存在/i.test(err.message))
  );
}

/** 单行上传失败可跳过（继续后续行） */
export class ApiRowUploadSkippedError extends Error {
  readonly table: string;
  readonly pk: string | null;

  constructor(table: string, pk: string | null, message: string) {
    super(message);
    this.name = 'ApiRowUploadSkippedError';
    this.table = table;
    this.pk = pk;
  }
}

function isRecoverableParentReferenceError(err: unknown): boolean {
  return isForeignKeyConstraintError(err) || isMissingParentRecordApiError(err);
}

function nullifyRowForeignKeys(
  table: string,
  row: Record<string, unknown>,
  fkRefs: Awaited<ReturnType<typeof readLocalForeignKeyRefs>>,
): Record<string, unknown> {
  const out = { ...row };
  for (const fk of fkRefs) {
    if (fk.parentTable === table) continue;
    if (out[fk.fromColumn] != null && out[fk.fromColumn] !== '') {
      out[fk.fromColumn] = null;
    }
  }
  return out;
}

function sanitizeRowForeignKeysForApiUpload(
  table: string,
  row: Record<string, unknown>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefs: Awaited<ReturnType<typeof readLocalForeignKeyRefs>>,
): Record<string, unknown> {
  const out = { ...row };
  for (const fk of fkRefs) {
    if (fk.parentTable === table) continue;
    const val = out[fk.fromColumn];
    if (val == null || val === '') continue;
    const uploaded = uploadedPkByTable.get(fk.parentTable);
    if (!uploaded || uploaded.size === 0) continue;
    if (!uploaded.has(String(val))) {
      out[fk.fromColumn] = null;
    }
  }
  return out;
}

export async function upsertRowToApi(
  table: string,
  row: Record<string, unknown>,
  pkCols: string[],
  opts?: {
    signal?: AbortSignal;
    uploadedPkByTable?: UploadedPkRegistry;
    fkRefs?: Awaited<ReturnType<typeof readLocalForeignKeyRefs>>;
    rowsByTable?: Map<string, Record<string, unknown>[]>;
    pkColsByTable?: Map<string, string[]>;
    fkRefsByTable?: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>;
  },
): Promise<'created' | 'updated'> {
  let body = row;
  if (opts?.uploadedPkByTable && opts.fkRefs) {
    body = sanitizeRowForeignKeysForApiUpload(table, row, opts.uploadedPkByTable, opts.fkRefs);
  }
  const pk = rowPrimaryKeyValue(body, pkCols);

  const runUpsert = async (payload: Record<string, unknown>): Promise<'created' | 'updated'> => {
    try {
      await apiCreateRecord(table, payload, { signal: opts?.signal });
      return 'created';
    } catch (e) {
      if (e instanceof ApiRequestError && (e.httpStatus === 409 || /已存在|duplicate|冲突/i.test(e.message))) {
        if (!pk) throw e;
        await apiUpdateRecord(table, pk, payload, { signal: opts?.signal });
        return 'updated';
      }
      throw e;
    }
  };

  const tryUpsertReferencedProject = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'tasks' || !opts?.rowsByTable) return;
    const projectId = payload.project_id;
    if (projectId == null || projectId === '') return;

    const pid = String(projectId);
    const projectRow = (opts.rowsByTable.get('projects') ?? []).find(p => String(p.id) === pid);
    if (!projectRow) return;

    const projectPkCols = opts.pkColsByTable?.get('projects') ?? ['id'];
    await upsertRowToApi('projects', projectRow, projectPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('projects') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    opts.uploadedPkByTable?.get('projects')?.add(pid);
  };

  const tryUpsertReferencedProjectCategory = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'projects' || !opts?.rowsByTable) return;
    const categoryId = payload.category_id;
    if (categoryId == null || categoryId === '') return;

    const cid = String(categoryId);
    const categoryRow = (opts.rowsByTable.get('project_categories') ?? []).find(c => String(c.id) === cid);
    if (!categoryRow) return;

    const categoryPkCols = opts.pkColsByTable?.get('project_categories') ?? ['id'];
    await upsertRowToApi('project_categories', categoryRow, categoryPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('project_categories') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    opts.uploadedPkByTable?.get('project_categories')?.add(cid);
  };

  const tryUpsertReferencedTaskCategory = async (payload: Record<string, unknown>): Promise<void> => {
    if (table !== 'tasks' || !opts?.rowsByTable) return;
    const categoryId = payload.category_id;
    if (categoryId == null || categoryId === '') return;

    ensureTaskCategoryMirrorForApiUpload(opts.rowsByTable);

    const cid = String(categoryId);
    const categoryRow = (opts.rowsByTable.get('task_categories') ?? []).find(c => String(c.id) === cid);
    if (!categoryRow) return;

    const categoryPkCols = opts.pkColsByTable?.get('task_categories') ?? ['id'];
    await upsertRowToApi('task_categories', categoryRow, categoryPkCols, {
      signal: opts?.signal,
      uploadedPkByTable: opts.uploadedPkByTable,
      fkRefs: opts.fkRefsByTable?.get('task_categories') ?? [],
      rowsByTable: opts.rowsByTable,
      pkColsByTable: opts.pkColsByTable,
      fkRefsByTable: opts.fkRefsByTable,
    });
    opts.uploadedPkByTable?.get('task_categories')?.add(cid);
  };

  try {
    return await runUpsert(body);
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (e instanceof ApiRequestError && (e.httpStatus === 413 || /entity too large/i.test(e.message))) {
      const idHint = pk ? `（id: ${pk}）` : '';
      throw new ApiRequestError(
        `上传表「${table}」时单行数据过大${idHint}。应用已自动去掉本地图片并截断长文本；若仍失败请让管理员将 Node/nginx 请求体上限调至至少 2MB（当前服务器返回 413）。`,
        e.httpStatus,
        e.apiCode,
      );
    }
    if (isRecoverableParentReferenceError(e)) {
      try {
        if (table === 'tasks') {
          await tryUpsertReferencedTaskCategory(body);
          await tryUpsertReferencedProject(body);
        }
        if (table === 'projects') await tryUpsertReferencedProjectCategory(body);
        return await runUpsert(body);
      } catch {
        /* 补传父表后仍失败，继续去掉外键重试 */
      }
      if (opts?.fkRefs?.length) {
        const retried = nullifyRowForeignKeys(table, body, opts.fkRefs);
        try {
          return await runUpsert(retried);
        } catch (retryErr) {
          if (isRecoverableParentReferenceError(retryErr)) {
            const msg =
              retryErr instanceof ApiRequestError
                ? retryErr.message
                : retryErr instanceof Error
                  ? retryErr.message
                  : String(retryErr);
            throw new ApiRowUploadSkippedError(table, pk, msg);
          }
          throw retryErr;
        }
      }
      if (e instanceof ApiRequestError) {
        throw new ApiRowUploadSkippedError(table, pk, e.message);
      }
    }
    throw e;
  }
}

export async function upsertProjectCategoriesReferencedByProjects(
  projectRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  ensureProjectCategoryRefsForApiUpload(rowsByTable);
  ensureTaskCategoryMirrorForApiUpload(rowsByTable);

  const categoryIds = new Set<string>();
  for (const project of projectRows) {
    const cid = project.category_id;
    if (cid != null && cid !== '') categoryIds.add(String(cid));
  }
  categoryIds.add(INBOX_PROJECT_CATEGORY_ID);

  const categoryRows = sortProjectCategoriesForApiUpload(rowsByTable.get('project_categories') ?? []);
  const categoryPkCols = pkColsByTable.get('project_categories') ?? ['id'];
  const uploadedCategories = uploadedPkByTable.get('project_categories') ?? new Set<string>();
  uploadedPkByTable.set('project_categories', uploadedCategories);

  for (const cid of categoryIds) {
    const categoryRow = categoryRows.find(c => String(c.id) === cid);
    if (!categoryRow) continue;
    await upsertRowToApi('project_categories', categoryRow, categoryPkCols, {
      signal,
      uploadedPkByTable,
      fkRefs: fkRefsByTable.get('project_categories') ?? [],
      rowsByTable,
      pkColsByTable,
      fkRefsByTable,
    });
    uploadedCategories.add(cid);
  }
}

export async function upsertTaskCategoriesReferencedByTasks(
  taskRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  ensureProjectCategoryRefsForApiUpload(rowsByTable);
  ensureTaskCategoryMirrorForApiUpload(rowsByTable);

  const categoryIds = new Set<string>();
  for (const task of taskRows) {
    const cid = task.category_id;
    if (cid != null && cid !== '') categoryIds.add(String(cid));
  }
  categoryIds.add(INBOX_PROJECT_CATEGORY_ID);

  const categoryRows = rowsByTable.get('task_categories') ?? [];
  const categoryPkCols = pkColsByTable.get('task_categories') ?? ['id'];
  const uploadedCategories = uploadedPkByTable.get('task_categories') ?? new Set<string>();
  uploadedPkByTable.set('task_categories', uploadedCategories);

  for (const cid of categoryIds) {
    const categoryRow = categoryRows.find(c => String(c.id) === cid);
    if (!categoryRow) continue;
    try {
      await upsertRowToApi('task_categories', categoryRow, categoryPkCols, {
        signal,
        uploadedPkByTable,
        fkRefs: fkRefsByTable.get('task_categories') ?? [],
        rowsByTable,
        pkColsByTable,
        fkRefsByTable,
      });
      uploadedCategories.add(cid);
    } catch (e) {
      if (e instanceof ApiRowUploadSkippedError) {
        if (__DEV__) console.warn('[api-sync] 预上传 task_categories 跳过', cid, e.message);
        continue;
      }
      throw e;
    }
  }
}

export async function upsertProjectsReferencedByTasks(
  taskRows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
  uploadedPkByTable: UploadedPkRegistry,
  fkRefsByTable: Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>,
  signal?: AbortSignal,
): Promise<void> {
  const projectIds = new Set<string>();
  for (const task of taskRows) {
    const pid = task.project_id;
    if (pid != null && pid !== '') projectIds.add(String(pid));
  }
  if (projectIds.size === 0) return;

  const projectRows = rowsByTable.get('projects') ?? [];
  const projectPkCols = pkColsByTable.get('projects') ?? ['id'];
  const uploadedProjects = uploadedPkByTable.get('projects') ?? new Set<string>();
  uploadedPkByTable.set('projects', uploadedProjects);

  for (const pid of projectIds) {
    const projectRow = projectRows.find(p => String(p.id) === pid);
    if (!projectRow) continue;
    await upsertRowToApi('projects', projectRow, projectPkCols, {
      signal,
      uploadedPkByTable,
      fkRefs: fkRefsByTable.get('projects') ?? [],
      rowsByTable,
      pkColsByTable,
      fkRefsByTable,
    });
    uploadedProjects.add(pid);
  }
}

export { rowPrimaryKeyValue };
